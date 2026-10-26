import { SAMPLE_RATE } from "../separation/model";
import { PCM_SCALE } from "../separation/protocol";
import { bassPitchClasses, type BassFrames } from "./bass";
import { estimateTempo, extendBeats, normalizeOnsets, onsetBands, trackBeatFrames } from "./beats";
import { cqtMagnitude, type CqtResult } from "./cqt";
import {
  STATES,
  estimateKey,
  keyPrior,
  largeToMajMin,
  refineQuality,
  repetitionSmoothing,
  slashBass,
  stateMinor,
  stateRoot,
  viterbi,
} from "./decode";
import { keyChanges, mergeSimilar, splitAtBreaks, type KeyChange, type TimeRange } from "./parts";
import { decimate2 } from "./resample";
import { estimateTuningCents } from "./tuning";
import { LARGE_CLASSES, MAJMIN_CLASSES, MAJMIN_N, type Key, type Quality } from "./vocabulary";

/**
 * Chord detection from separated stems:
 *
 * 1. Harmonic instruments (guitar, keys, other + bass) without drums and
 *    vocals feed the BTC chord recognisers (Park et al., ISMIR 2019) on a
 *    tuning-corrected CQT, in overlapping 10 s windows.
 * 2. Beats come from the drum stem (supported by bass and harmonic onsets);
 *    the bar position from kick/snare patterns and harmonic change.
 * 3. Beat-synchronous probabilities are smoothed across repeated passages,
 *    then decoded with a key- and metre-aware Viterbi (chords change on
 *    beats, mostly on bar lines).
 * 4. Extensions come from the large-vocabulary model, slash basses from the
 *    bass stem — both only when clearly supported.
 */

export const CHORD_ANALYSIS_VERSION = 2;

export type BtcModel = "majmin" | "large";
/** Runs a BTC model on normalized features [108 × 144] and returns logits [108 × classes]. */
export type ChordModelRunner = (model: BtcModel, features: Float32Array) => Promise<Float32Array>;

export const BTC_FRAMES = 108;
export const BTC_BINS = 144;
export const BTC_NORM: Record<BtcModel, { mean: number; std: number; classes: number }> = {
  majmin: { mean: -2.2279364109039306, std: 1.719106559064301, classes: MAJMIN_CLASSES },
  large: { mean: -2.2279878897355596, std: 1.7191329394436938, classes: LARGE_CLASSES },
};

const SR = SAMPLE_RATE / 2;
const CQT_HOP = 2048;
const FRAME_TIME = CQT_HOP / SR;
const C1 = 32.70319566257483;
const STEM = { drums: 0, bass: 1, other: 2, vocals: 3, guitar: 4, piano: 5 } as const;

export interface ChordSegment {
  /** Seconds. */
  start: number;
  end: number;
  /** Beat indices, end exclusive. */
  startBeat: number;
  endBeat: number;
  root: number | null;
  quality: Quality;
  bass: number | null;
  /** Probability of the chosen maj/min chord, averaged over the segment. */
  confidence: number;
}

/**
 * One song of the recording (a live set holds several), with its own tempo,
 * metre and key. A single song is one part covering everything.
 */
export interface SongPart {
  /** Seconds. */
  start: number;
  end: number;
  /** Beat indices, end exclusive. */
  startBeat: number;
  endBeat: number;
  bpm: number;
  beatsPerBar: number;
  /** Index (into `beats`) of a downbeat of this part. */
  downbeat: number;
  key: Key | null;
  /** Modulations within the song. */
  keyChanges: KeyChange[];
}

export interface ChordAnalysis {
  version: number;
  /** Tempo, metre and key of the main (longest) part. */
  bpm: number;
  /** Beat times in seconds, covering the whole song. */
  beats: number[];
  beatsPerBar: number;
  /** Index (into `beats`) of a downbeat; every beatsPerBar-th beat from it starts a bar. */
  downbeat: number;
  key: Key | null;
  tuningCents: number;
  segments: ChordSegment[];
  parts: SongPart[];
}

export type ChordProgress = (phase: "prepare" | "recognise" | "decode", fraction: number) => void;

// ---------------------------------------------------------------------------
// 1. Features

export interface FeatureOptions {
  /** Gain of drums / vocals in the stems view (0 = removed). */
  drumsGain?: number;
  vocalsGain?: number;
  /** Also let the recognisers hear the full mix (the input they were trained on) and average both views. */
  mixView?: boolean;
  correctTuning?: boolean;
}

export interface ChordFeatures {
  duration: number;
  tuningCents: number;
  /** BTC input: |CQT| at 22.05 kHz, hop 2048, 144 bins from C1 (tuned), of the harmonic stems. */
  cqt: CqtResult;
  /** The same for the full mix, if enabled. */
  cqtMix: CqtResult | null;
  /** RMS of the harmonic stems around each CQT frame. */
  frameLevel: Float32Array;
  bass: BassFrames;
  /** Onset envelopes (spectral flux) at `fps` frames per second. */
  onsets: { fps: number; drums: Float32Array; kick: Float32Array; snare: Float32Array; bass: Float32Array; tonal: Float32Array };
  hasDrums: boolean;
}

function monoMix(stems: Int16Array[], frames: number, gains: Partial<Record<keyof typeof STEM, number>>): Float32Array {
  const out = new Float32Array(frames);
  for (const [name, gain] of Object.entries(gains) as [keyof typeof STEM, number][]) {
    if (!gain) continue;
    const stem = stems[STEM[name]];
    const k = (gain * 0.5) / PCM_SCALE;
    for (let i = 0; i < frames; i++) out[i] += (stem[2 * i] + stem[2 * i + 1]) * k;
  }
  return out;
}

/** RMS of `x` in a window of `hop` samples around each frame centre (frame t at t · hop). */
function frameRms(x: Float32Array, hop: number, frames: number): Float32Array {
  const out = new Float32Array(frames);
  for (let t = 0; t < frames; t++) {
    const a = Math.max(0, t * hop - hop / 2);
    const b = Math.min(x.length, t * hop + hop / 2);
    let sum = 0;
    for (let i = a; i < b; i++) sum += x[i] * x[i];
    out[t] = b > a ? Math.sqrt(sum / (b - a)) : 0;
  }
  return out;
}

function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i += 4) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, Math.ceil(x.length / 4)));
}

/** `stems`: interleaved stereo PCM per source in model order (drums, bass, other, vocals, guitar, piano). */
export function extractFeatures(stems: Int16Array[], frames: number, options: FeatureOptions = {}): ChordFeatures {
  const { drumsGain = 0, vocalsGain = 0, mixView = true, correctTuning = true } = options;
  const tonal = decimate2(monoMix(stems, frames, { guitar: 1, piano: 1, other: 1 }));
  const bass = decimate2(monoMix(stems, frames, { bass: 1 }));
  const drums = decimate2(monoMix(stems, frames, { drums: 1 }));
  const harmonic = new Float32Array(tonal.length);
  for (let i = 0; i < harmonic.length; i++) harmonic[i] = tonal[i] + bass[i];
  const tuningCents = correctTuning ? estimateTuningCents(harmonic, SR) : 0;

  const vocals = vocalsGain || mixView ? decimate2(monoMix(stems, frames, { vocals: 1 })) : null;
  const withGains = (d: number, v: number) => {
    if (!d && !v) return harmonic;
    const out = Float32Array.from(harmonic);
    for (let i = 0; i < out.length; i++) out[i] += d * drums[i] + (v ? v * vocals![i] : 0);
    return out;
  };
  const fmin = C1 * 2 ** (tuningCents / 1200);
  const cqtOptions = { sr: SR, hop: CQT_HOP, fmin, nBins: BTC_BINS, binsPerOctave: 24 };
  const cqt = cqtMagnitude(withGains(drumsGain, vocalsGain), cqtOptions);
  const cqtMix = mixView ? cqtMagnitude(withGains(1, 1), cqtOptions) : null;
  // Fundamentals up to C4 (72 bins) plus four harmonics.
  const bassCqt = cqtMagnitude(bass, { sr: SR, hop: CQT_HOP, fmin, nBins: 120, binsPerOctave: 24 });

  const [drumsEnv, kickEnv, snareEnv] = onsetBands(drums, SR, [
    [30, 11025],
    [30, 150],
    [150, 4000],
  ]);
  const [bassEnv] = onsetBands(bass, SR, [[30, 2000]]);
  const [tonalEnv] = onsetBands(tonal, SR, [[100, 8000]]);
  return {
    duration: frames / SAMPLE_RATE,
    tuningCents,
    cqt,
    cqtMix,
    frameLevel: frameRms(harmonic, CQT_HOP, cqt.frames),
    bass: bassPitchClasses(bassCqt, 24, 72),
    onsets: {
      fps: drumsEnv.fps,
      drums: drumsEnv.values,
      kick: kickEnv.values,
      snare: snareEnv.values,
      bass: bassEnv.values,
      tonal: tonalEnv.values,
    },
    hasDrums: rms(drums) > 0.05 * (rms(tonal) + rms(bass)),
  };
}

// ---------------------------------------------------------------------------
// 2. Frame-level chord probabilities

export interface RecogniseOptions {
  models?: BtcModel[];
  /** Window hop in CQT frames (54 = 50 % overlap). */
  windowHop?: number;
}

export interface FrameProbabilities {
  frames: number;
  /** [frame * 25 + state] from the maj/min model. */
  majmin: Float32Array | null;
  /** [frame * 170 + class] from the large-vocabulary model. */
  large: Float32Array | null;
}

function softmaxInto(logits: Float32Array, offset: number, classes: number, out: Float64Array) {
  let max = -Infinity;
  for (let c = 0; c < classes; c++) max = Math.max(max, logits[offset + c]);
  let sum = 0;
  for (let c = 0; c < classes; c++) {
    out[c] = Math.exp(logits[offset + c] - max);
    sum += out[c];
  }
  for (let c = 0; c < classes; c++) out[c] /= sum;
}

/** Window start frames: overlapping windows that cover every frame. */
export function windowStarts(frames: number, hop: number): number[] {
  const starts: number[] = [];
  for (let s = 0; s < frames; s += hop) {
    starts.push(s);
    if (s + BTC_FRAMES >= frames) break;
  }
  return starts;
}

async function recogniseModel(
  cqt: CqtResult,
  model: BtcModel,
  runModel: ChordModelRunner,
  hop: number,
  onWindow: () => void,
): Promise<Float32Array> {
  const { mean, std, classes } = BTC_NORM[model];
  const frames = cqt.frames;
  const out = new Float32Array(frames * classes);
  const weightSum = new Float32Array(frames);
  // Frames near a window edge see less context; weight the centre higher.
  const weight = Float32Array.from({ length: BTC_FRAMES }, (_, t) => 0.1 + 0.9 * Math.sin((Math.PI * (t + 0.5)) / BTC_FRAMES) ** 2);
  const probs = new Float64Array(classes);
  for (const start of windowStarts(frames, hop)) {
    // Padding stays 0, which is the training mean after normalisation (as in BTC).
    const input = new Float32Array(BTC_FRAMES * BTC_BINS);
    for (let t = 0; t < BTC_FRAMES && start + t < frames; t++) {
      for (let b = 0; b < BTC_BINS; b++) {
        input[t * BTC_BINS + b] = (Math.log(cqt.data[(start + t) * BTC_BINS + b] + 1e-6) - mean) / std;
      }
    }
    const logits = await runModel(model, input);
    for (let t = 0; t < BTC_FRAMES && start + t < frames; t++) {
      softmaxInto(logits, t * classes, classes, probs);
      const w = weight[t];
      for (let c = 0; c < classes; c++) out[(start + t) * classes + c] += w * probs[c];
      weightSum[start + t] += w;
    }
    onWindow();
  }
  for (let t = 0; t < frames; t++) {
    const w = weightSum[t] || 1;
    for (let c = 0; c < classes; c++) out[t * classes + c] /= w;
  }
  return out;
}

export async function recogniseFrames(
  features: ChordFeatures,
  runModel: ChordModelRunner,
  options: RecogniseOptions = {},
  onProgress?: (fraction: number) => void,
): Promise<FrameProbabilities> {
  const { models = ["majmin", "large"], windowHop = 54 } = options;
  const views = features.cqtMix ? [features.cqt, features.cqtMix] : [features.cqt];
  const frames = Math.min(...views.map((v) => v.frames));
  const total = windowStarts(features.cqt.frames, windowHop).length * models.length * views.length;
  let done = 0;
  const tick = () => onProgress?.(++done / total);
  const result: FrameProbabilities = { frames, majmin: null, large: null };
  for (const model of models) {
    const perView: Float32Array[] = [];
    for (const view of views) perView.push(await recogniseModel(view, model, runModel, windowHop, tick));
    // Average of the views' probabilities.
    const classes = BTC_NORM[model].classes;
    const avg = new Float32Array(frames * classes);
    for (const p of perView) for (let i = 0; i < avg.length; i++) avg[i] += p[i] / perView.length;
    result[model] = avg;
  }
  return result;
}

// ---------------------------------------------------------------------------
// 3. Beats

export interface BeatGrid {
  bpm: number;
  /** Beat times in seconds, extended to cover the whole song. */
  beats: number[];
  /** Songs within the recording, each tracked with its own tempo (absent: one song). */
  parts?: { start: number; end: number; bpm: number; startBeat: number; endBeat: number }[];
}

function onsetEnvelope(features: ChordFeatures): Float32Array {
  const { fps, drums, bass, tonal } = features.onsets;
  const env = new Float32Array(drums.length);
  const parts: [Float32Array, number][] = [
    [normalizeOnsets(bass, fps), 0.5],
    [normalizeOnsets(tonal, fps), features.hasDrums ? 0.35 : 1],
  ];
  if (features.hasDrums) parts.push([normalizeOnsets(drums, fps), 1]);
  for (const [values, w] of parts) for (let t = 0; t < env.length; t++) env[t] += w * values[t];
  return env;
}

/** Tempo of a stretch of the recording. */
function tempoIn(features: ChordFeatures, env: Float32Array, range: TimeRange): number {
  const { fps } = features.onsets;
  const slice = env.subarray(Math.floor(range.start * fps), Math.min(env.length, Math.ceil(range.end * fps)));
  // Without drums, fast arpeggios easily pass for the beat: trust the usual tempo range more.
  return estimateTempo(slice, fps, 120, features.hasDrums ? 1 : 0.7);
}

export function trackBeats(features: ChordFeatures, ranges?: TimeRange[]): BeatGrid {
  const { fps } = features.onsets;
  const env = onsetEnvelope(features);
  if (!ranges || ranges.length <= 1) {
    const bpm = tempoIn(features, env, { start: 0, end: features.duration });
    const beatTimes = trackBeatFrames(env, fps, bpm).map((f) => f / fps);
    return { bpm, beats: extendBeats(beatTimes, features.duration, 60 / bpm) };
  }
  // Several songs: each gets its own tempo and beat grid.
  const beats: number[] = [];
  const parts: NonNullable<BeatGrid["parts"]> = [];
  for (const range of ranges) {
    const f0 = Math.floor(range.start * fps);
    const slice = env.subarray(f0, Math.min(env.length, Math.ceil(range.end * fps)));
    const bpm = tempoIn(features, env, range);
    const times = trackBeatFrames(slice, fps, bpm).map((f) => (f + f0) / fps);
    const own = extendBeats(times, range.end, 60 / bpm, range.start).filter((t) => t >= range.start && t < range.end);
    const startBeat = beats.length;
    for (const t of own) if (!beats.length || t > beats[beats.length - 1] + 0.05) beats.push(t);
    parts.push({ start: range.start, end: range.end, bpm, startBeat, endBeat: beats.length });
  }
  const kept = parts.filter((p) => p.endBeat > p.startBeat);
  if (!kept.length) return trackBeats(features);
  const main = kept.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
  return { bpm: main.bpm, beats, parts: kept };
}

/**
 * Where one song ends and the next begins: long breaks without chords,
 * then neighbouring parts in the same key and tempo merged back together.
 */
export function findSongs(features: ChordFeatures, probs: FrameProbabilities, ensemble: "both" | "majmin" | "large" = "both"): TimeRange[] {
  const frames = Math.min(probs.frames, features.frameLevel.length);
  const majmin = ensembleFrames(probs, ensemble);
  const noChord = new Float32Array(frames);
  for (let f = 0; f < frames; f++) noChord[f] = majmin[f * STATES + MAJMIN_N];
  const ranges = splitAtBreaks(noChord, features.frameLevel, FRAME_TIME, features.duration);
  if (ranges.length === 1) return ranges;
  const env = onsetEnvelope(features);
  const described = ranges.map((range) => {
    const hist = new Float64Array(STATES);
    const f0 = Math.floor(range.start / FRAME_TIME);
    const f1 = Math.min(frames, Math.ceil(range.end / FRAME_TIME));
    for (let f = f0; f < f1; f++) for (let s = 0; s < STATES; s++) hist[s] += majmin[f * STATES + s];
    return { ...range, key: estimateKey(hist), bpm: tempoIn(features, env, range) };
  });
  return mergeSimilar(described).map(({ start, end }) => ({ start, end }));
}

// ---------------------------------------------------------------------------
// 4. Decoding

export interface DecodeOptions {
  /** Which recognisers to combine for the maj/min decision. */
  ensemble?: "both" | "majmin" | "large";
  repetition?: boolean;
  repetitionThreshold?: number;
  useKey?: boolean;
  /** Exponent of the key prior (1 = as defined, 0 = flat). */
  keyStrength?: number;
  bassWeight?: number;
  /** Chord-change probability per bar position (index 0 = downbeat). */
  changeProbability?: { 3: number[]; 4: number[] };
  extensions?: boolean;
  /** Share of its triad family an extension needs, and its ratio to the plain triad. */
  extensionShare?: number;
  extensionRatio?: number;
  slashBasses?: boolean;
}

/** Strongest value of an onset envelope within ±radius frames of a time. */
function peakNear(env: Float32Array, fps: number, time: number, radius: number): number {
  const center = Math.round(time * fps);
  let best = 0;
  for (let t = Math.max(0, center - radius); t <= Math.min(env.length - 1, center + radius); t++) best = Math.max(best, env[t]);
  return best;
}

function zscore(values: number[]): number[] {
  const n = values.length || 1;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1;
  return values.map((v) => (v - mean) / sd);
}

/**
 * Metre (3 or 4 beats per bar) and downbeat phase: downbeats tend to carry
 * the kick drum, the bass notes and the chord changes, backbeats the snare.
 */
export function estimateMeter(
  beatProbs: Float64Array[],
  kick: number[],
  snare: number[],
  bassOnset: number[],
): { beatsPerBar: number; downbeat: number } {
  const n = beatProbs.length;
  const change: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i < 1 || i + 1 >= n) {
      change.push(0);
      continue;
    }
    // Hellinger distance between the chords before and after the beat.
    let dot = 0;
    for (let s = 0; s < STATES; s++) {
      const a = i >= 2 ? (beatProbs[i - 1][s] + beatProbs[i - 2][s]) / 2 : beatProbs[i - 1][s];
      const b = (beatProbs[i][s] + beatProbs[i + 1][s]) / 2;
      dot += Math.sqrt(a * b);
    }
    change.push(1 - dot);
  }
  const zc = zscore(change);
  const zk = zscore(kick);
  const zs = zscore(snare);
  const zb = zscore(bassOnset);
  const evidence = zc.map((c, i) => c + 0.5 * zk[i] - 0.5 * zs[i] + 0.3 * zb[i]);
  let best = { beatsPerBar: 4, downbeat: 0, score: -Infinity };
  for (const m of [4, 3]) {
    for (let phase = 0; phase < m; phase++) {
      let on = 0;
      let onCount = 0;
      let off = 0;
      let offCount = 0;
      evidence.forEach((e, i) => {
        if ((i - phase) % m === 0) {
          on += e;
          onCount++;
        } else {
          off += e;
          offCount++;
        }
      });
      // 4/4 is far more common; 3/4 has to be clearly better.
      const score = on / Math.max(1, onCount) - off / Math.max(1, offCount) - (m === 3 ? 0.35 : 0);
      if (score > best.score) best = { beatsPerBar: m, downbeat: phase, score };
    }
  }
  return { beatsPerBar: best.beatsPerBar, downbeat: best.downbeat };
}

/** Maj/min frame probabilities: geometric mean of the selected recognisers. */
function ensembleFrames(probs: FrameProbabilities, ensemble: "both" | "majmin" | "large"): Float32Array {
  const frames = probs.frames;
  const useMajmin = probs.majmin && ensemble !== "large";
  const useLarge = probs.large && ensemble !== "majmin";
  if (!useMajmin && !useLarge) throw new Error("No chord probabilities to decode");
  const out = new Float32Array(frames * STATES);
  const collapsed = new Float64Array(STATES);
  const logs = new Float64Array(STATES);
  for (let t = 0; t < frames; t++) {
    logs.fill(0);
    let count = 0;
    if (useMajmin) {
      for (let s = 0; s < STATES; s++) logs[s] += Math.log(probs.majmin![t * MAJMIN_CLASSES + s] + 1e-6);
      count++;
    }
    if (useLarge) {
      largeToMajMin(probs.large!, t * LARGE_CLASSES, collapsed);
      for (let s = 0; s < STATES; s++) logs[s] += Math.log(collapsed[s] + 1e-6);
      count++;
    }
    let sum = 0;
    for (let s = 0; s < STATES; s++) {
      logs[s] = Math.exp(logs[s] / count);
      sum += logs[s];
    }
    for (let s = 0; s < STATES; s++) out[t * STATES + s] = logs[s] / sum;
  }
  return out;
}

/** Per-beat bass score: favours chords whose root (or third / fifth) the bass plays. */
function bassScores(hist: Float64Array, weight: number): Float64Array {
  const out = new Float64Array(STATES);
  let total = 0;
  for (const v of hist) total += v;
  if (total <= 1e-6 || weight === 0) return out;
  const compat = new Float64Array(24);
  let mean = 0;
  for (let s = 0; s < 24; s++) {
    const root = s >> 1;
    const third = (root + ((s & 1) === 1 ? 3 : 4)) % 12;
    const fifth = (root + 7) % 12;
    compat[s] = (hist[root] + 0.5 * hist[third] + 0.5 * hist[fifth]) / total;
    mean += compat[s] / 24;
  }
  for (let s = 0; s < 24; s++) out[s] = weight * Math.log((0.2 + compat[s]) / (0.2 + mean));
  return out;
}

export function decodeChords(
  features: ChordFeatures,
  probs: FrameProbabilities,
  grid: BeatGrid,
  options: DecodeOptions = {},
): ChordAnalysis {
  const {
    ensemble = "both",
    repetition = true,
    repetitionThreshold = 0.9,
    useKey = true,
    keyStrength = 1,
    bassWeight = 1,
    extensions = true,
    extensionShare = 0.5,
    extensionRatio = 2,
    slashBasses = true,
  } = options;
  const changeProbability = options.changeProbability ?? { 4: [0.6, 0.06, 0.2, 0.06], 3: [0.6, 0.06, 0.06] };
  const { duration } = features;
  const { beats } = grid;
  const frameCount = Math.min(probs.frames, features.bass.frames);
  const majmin = ensembleFrames(probs, ensemble);

  // Beat-synchronous averages (frame t is centred at t · hop / sr).
  const nBeats = beats.length;
  const beatProbs: Float64Array[] = [];
  const beatLarge: (Float64Array | null)[] = [];
  const beatBass: Float64Array[] = [];
  const beatLevel: number[] = [];
  for (let i = 0; i < nBeats; i++) {
    const t0 = beats[i];
    const t1 = i + 1 < nBeats ? beats[i + 1] : duration;
    let f0 = Math.ceil(t0 / FRAME_TIME);
    let f1 = Math.ceil(t1 / FRAME_TIME) - 1;
    if (f1 < f0) f0 = f1 = Math.round((t0 + t1) / 2 / FRAME_TIME);
    f0 = Math.max(0, Math.min(frameCount - 1, f0));
    f1 = Math.max(f0, Math.min(frameCount - 1, f1));
    const p = new Float64Array(STATES);
    const l = probs.large ? new Float64Array(LARGE_CLASSES) : null;
    const b = new Float64Array(12);
    const levels: number[] = [];
    for (let f = f0; f <= f1; f++) {
      for (let s = 0; s < STATES; s++) p[s] += majmin[f * STATES + s];
      if (l) for (let c = 0; c < LARGE_CLASSES; c++) l[c] += probs.large![f * LARGE_CLASSES + c];
      for (let pc = 0; pc < 12; pc++) b[pc] += features.bass.salience[f * 12 + pc];
      levels.push(features.frameLevel[f]);
    }
    const count = f1 - f0 + 1;
    for (let s = 0; s < STATES; s++) p[s] /= count;
    if (l) for (let c = 0; c < LARGE_CLASSES; c++) l[c] /= count;
    beatProbs.push(p);
    beatLarge.push(l);
    beatBass.push(b);
    // Median: robust to a frame that already hears the next beat.
    beatLevel.push(levels.sort((x, y) => x - y)[levels.length >> 1]);
  }

  // No harmonic instrument playing (count-in, drum intro, the end): no chord.
  const loud = [...beatLevel].sort((a, b) => a - b)[Math.floor(nBeats * 0.9)] ?? 0;
  for (let i = 0; i < nBeats; i++) {
    if (beatLevel[i] >= 0.01 * loud) continue;
    beatProbs[i].fill(0.03 / (STATES - 1));
    beatProbs[i][MAJMIN_N] = 0.97;
    beatBass[i].fill(0);
  }

  // Each song of the recording on its own: metre, repetition, key, decoding.
  const { fps, kick, snare, bass } = features.onsets;
  const near = (env: Float32Array) => beats.map((t) => peakNear(env, fps, t, 3));
  const zeros = beats.map(() => 0);
  const kickAt = features.hasDrums ? near(kick) : zeros;
  const snareAt = features.hasDrums ? near(snare) : zeros;
  const bassAt = near(bass);
  const ranges = grid.parts ?? [{ start: 0, end: duration, bpm: grid.bpm, startBeat: 0, endBeat: nBeats }];
  const path = new Array<number>(nBeats).fill(MAJMIN_N);
  const smoothed: Float64Array[] = beatProbs.slice();
  const parts: SongPart[] = [];
  for (const range of ranges) {
    const a = range.startBeat;
    const b = range.endBeat;
    if (b <= a) continue;
    const own = beatProbs.slice(a, b);
    const meter = estimateMeter(own, kickAt.slice(a, b), snareAt.slice(a, b), bassAt.slice(a, b));
    const ownSmoothed = repetition ? repetitionSmoothing(own, meter.beatsPerBar, { threshold: repetitionThreshold }) : own;
    const histogram = new Float64Array(STATES);
    for (const p of ownSmoothed) for (let s = 0; s < STATES; s++) histogram[s] += p[s];
    const key = estimateKey(histogram);
    const prior = keyPrior(useKey ? key : null, keyStrength);
    // Songs often start with silence or a count-in: no chord is as likely as the tonic there.
    const initial = Float64Array.from(prior);
    initial[MAJMIN_N] = Math.max(...prior);
    const ownPath = viterbi(ownSmoothed, {
      changeProbability: meter.beatsPerBar === 3 ? changeProbability[3] : changeProbability[4],
      downbeat: meter.downbeat,
      prior,
      initial,
      extra: beatBass.slice(a, b).map((hist) => bassScores(hist, bassWeight)),
    });
    for (let k = a; k < b; k++) {
      path[k] = ownPath[k - a];
      smoothed[k] = ownSmoothed[k - a];
    }
    parts.push({
      start: Math.round(beats[a] * 1000) / 1000,
      end: Math.round((b < nBeats ? beats[b] : duration) * 1000) / 1000,
      startBeat: a,
      endBeat: b,
      bpm: Math.round(range.bpm * 10) / 10,
      beatsPerBar: meter.beatsPerBar,
      downbeat: a + meter.downbeat,
      key,
      keyChanges: keyChanges(ownSmoothed, meter.beatsPerBar, a, beats).map((c) => ({ ...c, start: Math.round(c.start * 1000) / 1000 })),
    });
  }
  if (!parts.length) {
    parts.push({ start: 0, end: duration, startBeat: 0, endBeat: nBeats, bpm: Math.round(grid.bpm * 10) / 10, beatsPerBar: 4, downbeat: 0, key: null, keyChanges: [] });
  }
  parts[0].start = 0;
  const partStarts = new Set(parts.map((p) => p.startBeat));
  const main = parts.reduce((x, y) => (y.end - y.start > x.end - x.start ? y : x));

  // Segments with extensions, slash basses and confidence (never across two songs).
  const segments: ChordSegment[] = [];
  for (let i = 0; i < nBeats; ) {
    let j = i + 1;
    while (j < nBeats && path[j] === path[i] && !partStarts.has(j)) j++;
    const state = path[i];
    const root = stateRoot(state);
    let quality: Quality = stateMinor(state) ? "min" : "maj";
    let bassNote: number | null = null;
    let confidence = 0;
    for (let k = i; k < j; k++) confidence += smoothed[k][state];
    confidence /= j - i;
    if (root !== null) {
      if (extensions && probs.large) {
        const large = new Float64Array(LARGE_CLASSES);
        for (let k = i; k < j; k++) for (let c = 0; c < LARGE_CLASSES; c++) large[c] += beatLarge[k]![c];
        quality = refineQuality(root, quality === "min", large, extensionShare, extensionRatio);
      }
      if (slashBasses && j - i >= 2) {
        const hist = new Float64Array(12);
        for (let k = i; k < j; k++) for (let pc = 0; pc < 12; pc++) hist[pc] += beatBass[k][pc];
        bassNote = slashBass(root, quality, hist);
      }
    }
    segments.push({
      start: Math.round(beats[i] * 1000) / 1000,
      end: Math.round((j < nBeats ? beats[j] : duration) * 1000) / 1000,
      startBeat: i,
      endBeat: j,
      root,
      quality,
      bass: bassNote,
      confidence: Math.round(confidence * 1000) / 1000,
    });
    i = j;
  }

  return {
    version: CHORD_ANALYSIS_VERSION,
    bpm: main.bpm,
    beats: beats.map((t) => Math.round(t * 1000) / 1000),
    beatsPerBar: main.beatsPerBar,
    downbeat: main.downbeat,
    key: main.key,
    tuningCents: Math.round(features.tuningCents),
    segments,
    parts,
  };
}

// ---------------------------------------------------------------------------

export interface ChordAnalysisOptions extends FeatureOptions, RecogniseOptions, DecodeOptions {}

export async function analyzeChords(
  stems: Int16Array[],
  frames: number,
  runModel: ChordModelRunner,
  options: ChordAnalysisOptions = {},
  onProgress?: ChordProgress,
): Promise<ChordAnalysis> {
  onProgress?.("prepare", 0);
  const features = extractFeatures(stems, frames, options);
  onProgress?.("prepare", 1);
  const probs = await recogniseFrames(features, runModel, options, (f) => onProgress?.("recognise", f));
  onProgress?.("decode", 0);
  // A live set or medley: find the songs, then track each one's beat on its own.
  const grid = trackBeats(features, findSongs(features, probs, options.ensemble));
  const analysis = decodeChords(features, probs, grid, options);
  onProgress?.("decode", 1);
  return analysis;
}
