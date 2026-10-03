import { PCM_SCALE } from "../separation/protocol";
import { SAMPLE_RATE } from "../separation/model";
import { HOP, WHISPER_SR, logMelChunk, resample } from "./whisper/audio";
import { alignWords, mergePunctuations, type WordTiming } from "./whisper/alignment";
import { harmonizeRepeats } from "./consensus";
import {
  decodeWindow,
  detectLanguage,
  splitSegments,
  type DecodeResult,
  type EncodedAudio,
  type WhisperConfig,
  type WhisperRunner,
} from "./whisper/decoding";
import type { WhisperTokenizer } from "./whisper/tokenizer";
import { textLanguage } from "./language";
import { frameLevels, packWindows, voiceOnset, voiceRegions, voiceThreshold, type Region } from "./vad";

/**
 * Lyrics from the separated vocal stem with Whisper:
 *
 * 1. Find where the singing is (loudness gate on the vocal stem) and pack it
 *    into ≤ 30 s windows, so Whisper never sees long instrumental stretches —
 *    its main source of invented text.
 * 2. Detect the language per window, sticking to the song's main language
 *    unless a window is clearly in another one. Lines written in another
 *    language than their window's (an English hook in a German verse) mark
 *    the window as mixed; its doubtful lines, which Whisper may have
 *    translated, are transcribed again on their own.
 * 3. Decode with Whisper's timestamp rules; on repetitive or improbable
 *    output, retry with sampling (temperature fallback).
 * 4. Word timestamps from the cross-attention of the alignment heads (DTW).
 * 5. Segments become lyric lines; known subtitle hallucinations are dropped,
 *    line starts snap to the vocal onset, and repeated lines (choruses) are
 *    made consistent by letting the most confident rendition win.
 */

export const LYRICS_VERSION = 1;

export interface LyricWord {
  /** Word as written, with its leading space if any. */
  text: string;
  /** Seconds in the song. */
  start: number;
  end: number;
  /** Mean token probability (0…1). */
  probability: number;
}

export interface LyricLine {
  start: number;
  end: number;
  words: LyricWord[];
  language: string;
}

export interface LyricsAnalysis {
  version: number;
  model: string;
  /** Main language (ISO 639-1), detected or chosen. */
  language: string;
  languageProbability: number;
  /** Whether the language was detected (true) or set by the user. */
  detected: boolean;
  lines: LyricLine[];
}

export interface TranscribeOptions {
  /** Force a language (ISO code); detected per window when absent. */
  language?: string | null;
  temperatures?: number[];
  compressionRatioThreshold?: number;
  logprobThreshold?: number;
  noSpeechThreshold?: number;
}

export type LyricsPhase = "prepare" | "transcribe";
export type LyricsProgress = (phase: LyricsPhase, fraction: number) => void;

const STEM_VOCALS = 3;

/** Mono vocal stem at 16 kHz. */
export function vocalsAt16k(stems: Int16Array[], frames: number): Float32Array {
  return vocalStemAt16k(stems[STEM_VOCALS], frames);
}

/** Interleaved stereo PCM → mono at 16 kHz. */
export function vocalStemAt16k(stem: Int16Array, frames: number): Float32Array {
  const mono = new Float32Array(frames);
  const k = 0.5 / PCM_SCALE;
  for (let i = 0; i < frames; i++) mono[i] = (stem[2 * i] + stem[2 * i + 1]) * k;
  return resample(mono, SAMPLE_RATE, WHISPER_SR);
}

/** Subtitle credits and noise tags Whisper invents on music. */
const HALLUCINATIONS = [
  /untertitel/i,
  /amara\.org/i,
  /thanks? (you )?for watching/i,
  /subtitles? by/i,
  /vielen dank (fürs|für's|für das) zuschauen/i,
  /^\s*[\[(]?\s*(music|musik|instrumental|applause|applaus|outro|intro|gesang|singing)\s*[\])]?\s*\.?\s*$/i,
  /^[\s♪♫🎵🎶.…-]*$/,
];

function isHallucination(text: string): boolean {
  return HALLUCINATIONS.some((re) => re.test(text.trim()));
}

async function decodeWithFallback(
  runner: WhisperRunner,
  cfg: WhisperConfig,
  tokenizer: WhisperTokenizer,
  audio: EncodedAudio,
  language: string,
  options: Required<Pick<TranscribeOptions, "temperatures" | "compressionRatioThreshold" | "logprobThreshold" | "noSpeechThreshold">>,
  seed: number,
): Promise<DecodeResult> {
  let best: DecodeResult | null = null;
  for (const temperature of options.temperatures) {
    const result = await decodeWindow(runner, cfg, tokenizer, audio, language, temperature, seed);
    if (!best || result.avgLogprob > best.avgLogprob) best = result;
    const tooRepetitive = result.compressionRatio > options.compressionRatioThreshold;
    const improbable = result.avgLogprob < options.logprobThreshold;
    const silence = result.noSpeechProb > options.noSpeechThreshold && improbable;
    if (silence || (!tooRepetitive && !improbable)) return result;
  }
  return best!;
}

/** Fixes implausible word boundaries at pauses (adapted from whisper's add_word_timestamps). */
function refineWordTimes(words: WordTiming[], segStart: number, segEnd: number, lastSpeech: number, median: number) {
  if (words.length === 0) return;
  // Sung words are long; only clip clearly broken ones.
  const maxDuration = Math.max(1.5, median * 2);
  const first = words[0];
  if (first.end - lastSpeech > median * 4 && first.end - first.start > maxDuration) {
    first.start = Math.max(0, first.end - maxDuration);
  }
  if (segStart < first.end && segStart - 0.5 > first.start) {
    first.start = Math.max(0, Math.min(first.end - median, segStart));
  }
  const last = words[words.length - 1];
  if (segEnd > last.start && segEnd + 0.5 < last.end) {
    last.end = Math.max(last.start + median, segEnd);
  }
}

/** Splits long segments into singable lines at the longest pause. */
function toLines(words: LyricWord[], language: string, maxWords = 14, maxSeconds = 9): LyricLine[] {
  if (words.length === 0) return [];
  const span = words[words.length - 1].end - words[0].start;
  // (one or two long-held words stay together)
  if (words.length <= 2 || (words.length <= maxWords && span <= maxSeconds)) {
    return [{ start: words[0].start, end: words[words.length - 1].end, words, language }];
  }
  // Prefer a pause or a comma near the middle.
  let cut = Math.floor(words.length / 2);
  let bestScore = -Infinity;
  for (let i = 2; i < words.length - 1; i++) {
    const gap = words[i].start - words[i - 1].end;
    const punctuation = /[,;:.!?]$/.test(words[i - 1].text.trim()) ? 0.5 : 0;
    const balance = 1 - Math.abs(i / words.length - 0.5);
    const score = gap + punctuation + 0.2 * balance;
    if (score > bestScore) {
      bestScore = score;
      cut = i;
    }
  }
  return [...toLines(words.slice(0, cut), language, maxWords, maxSeconds), ...toLines(words.slice(cut), language, maxWords, maxSeconds)];
}

const round = (t: number) => Math.round(t * 1000) / 1000;

/** Word-weighted mean word probability. */
function confidence(lines: LyricLine[]): number {
  let sum = 0;
  let count = 0;
  for (const line of lines) {
    for (const w of line.words) sum += w.probability;
    count += line.words.length;
  }
  return count ? sum / count : 0;
}

const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/** Lines of a mixed window below this confidence are transcribed again on their own. */
const RECHECK_BELOW = 0.7;
/** A second language with this many words (and 15 % of all) makes the whole song count as mixed. */
const MIXED_SONG_WORDS = 12;

/**
 * Merges a second transcription of parts of a window into the window's lines:
 * a doubtful line gives way to clearly more confident text sung at the same
 * time, and confident text where nothing had been transcribed is added.
 */
export function mergeRepair(lines: LyricLine[], doubtful: LyricLine[], missing: Region[], repair: LyricLine[]): LyricLine[] {
  const out = [...lines];
  const used = new Set<LyricLine>();
  for (const line of doubtful) {
    const others = repair.filter((r) => !used.has(r) && overlap(r, line) >= 0.5 * Math.min(r.end - r.start, line.end - line.start));
    const cover = others.reduce((sum, r) => sum + overlap(r, line), 0);
    if (others.length && cover >= 0.5 * (line.end - line.start) && confidence(others) >= confidence([line]) + 0.15) {
      out.splice(out.indexOf(line), 1, ...others);
      for (const r of others) used.add(r);
    }
  }
  for (const line of repair) {
    if (used.has(line) || doubtful.some((d) => overlap(d, line) > 0.2)) continue;
    const inside = missing.some((r) => line.start < r.end + 0.4 && line.end > r.start - 0.4);
    // Leftover regions are often breaths or backing vocals: keep only confident text.
    if (inside && line.words.length >= 2 && confidence([line]) >= 0.45) out.push(line);
  }
  return out;
}

export async function transcribeLyrics(
  vocals: Float32Array,
  runner: WhisperRunner,
  cfg: WhisperConfig,
  tokenizer: WhisperTokenizer,
  model: string,
  options: TranscribeOptions = {},
  onProgress?: LyricsProgress,
): Promise<LyricsAnalysis> {
  const settings = {
    temperatures: options.temperatures ?? [0, 0.4, 0.8],
    compressionRatioThreshold: options.compressionRatioThreshold ?? 2.8,
    logprobThreshold: options.logprobThreshold ?? -1,
    noSpeechThreshold: options.noSpeechThreshold ?? 0.6,
  };
  onProgress?.("prepare", 0);
  const regions = voiceRegions(vocals, WHISPER_SR);
  const windows: Region[] = packWindows(regions, vocals, WHISPER_SR);
  const levels = frameLevels(vocals, WHISPER_SR);
  const threshold = voiceThreshold(levels);
  onProgress?.("prepare", 1);
  const total = windows.reduce((s, w) => s + (w.end - w.start), 0);
  let done = 0;

  const fixed = options.language ?? null;
  const languageTotals = new Map<string, number>();
  const wordsPerLanguage = new Map<string, number>();
  const lines: LyricLine[] = [];
  let lastSpeech = 0;
  let seed = 0;

  /** Language for a chunk: the song's main language unless this chunk clearly is in another one. */
  const chooseLanguage = async (audio: EncodedAudio, seconds: number, sticky: boolean): Promise<string> => {
    if (fixed) return fixed;
    const probs = await detectLanguage(runner, cfg, audio);
    let own = "en";
    let ownP = -1;
    for (const [code, p] of probs) {
      if (p > ownP) {
        own = code;
        ownP = p;
      }
      languageTotals.set(code, (languageTotals.get(code) ?? 0) + p * seconds);
    }
    if (!sticky) return own;
    let main = own;
    let mainScore = -1;
    for (const [code, score] of languageTotals) {
      if (score > mainScore) {
        main = code;
        mainScore = score;
      }
    }
    return (probs.get(main) ?? 0) >= 0.15 ? main : own;
  };

  /**
   * Transcribes up to 30 s of audio starting at `offset` seconds (`voiced`
   * seconds of it singing); returns its lines and how far Whisper got
   * (seconds), or null for silence.
   */
  const transcribeChunk = async (chunk: Float32Array, offset: number, language: string | null, sticky: boolean, voiced?: number) => {
    const chunkSeconds = chunk.length / WHISPER_SR;
    const audio = await runner.encode(logMelChunk(chunk, cfg.nMels));
    const lang = language ?? (await chooseLanguage(audio, voiced ?? chunkSeconds, sticky));
    const result: DecodeResult = await decodeWithFallback(runner, cfg, tokenizer, audio, lang, settings, seed++);
    if (result.noSpeechProb > settings.noSpeechThreshold && result.avgLogprob < settings.logprobThreshold) {
      return { consumed: null, language: lang, lines: [] as LyricLine[] };
    }
    const { segments, consumed } = splitSegments(cfg, result.tokens, chunkSeconds);
    const textPerSegment = segments.map((seg) => seg.tokens.filter((t) => t < cfg.eot));
    const timings = mergePunctuations(
      await alignWords(runner, cfg, tokenizer, audio, lang, textPerSegment.flat(), Math.round(chunk.length / HOP)),
    );
    const durations = timings.map((w) => w.end - w.start).filter((d) => d > 0).sort((a, b) => a - b);
    const median = Math.min(0.7, durations.length ? durations[Math.floor(durations.length / 2)] : 0);
    const out: LyricLine[] = [];
    let index = 0;
    segments.forEach((segment, s) => {
      const words: WordTiming[] = [];
      let saved = 0;
      while (index < timings.length && saved < textPerSegment[s].length) {
        words.push(timings[index]);
        saved += timings[index].tokens.length;
        index++;
      }
      const text = tokenizer.decode(textPerSegment[s]);
      if (words.length === 0 || isHallucination(text)) return;
      refineWordTimes(words, segment.start, segment.end, lastSpeech - offset, median);
      const songWords: LyricWord[] = words
        .filter((w) => w.word.trim() !== "")
        .map((w) => ({
          text: w.word,
          start: round(offset + w.start),
          end: round(offset + Math.max(w.end, w.start + 0.05)),
          probability: Math.round(w.probability * 1000) / 1000,
        }));
      const mean = songWords.reduce((a, w) => a + w.probability, 0) / Math.max(1, songWords.length);
      if (songWords.length === 0 || mean < 0.1) return;
      // The first word tends to start where the window does: move it to where the voice starts.
      const first = songWords[0];
      const onset =
        threshold === null ? null : voiceOnset(levels, threshold - 6, first.start, Math.min(first.end - 0.05, first.start + 1));
      if (onset !== null && onset > first.start) first.start = round(onset);
      lastSpeech = songWords[songWords.length - 1].end;
      for (const line of toLines(songWords, lang)) {
        // Whisper often writes a line in another language as it is, under the window's language token.
        const written = fixed ? null : textLanguage(line.words.map((w) => w.text).join(""));
        out.push(written && written !== lang ? { ...line, language: written } : line);
      }
    });
    return { consumed, language: lang, lines: out };
  };

  for (const window of windows) {
    let windowLines: LyricLine[] = [];
    let seek = window.start;
    let language: string | null = null;
    for (let pass = 0; pass < 4 && seek < window.end - 0.3; pass++) {
      const from = Math.round(seek * WHISPER_SR);
      const to = Math.min(Math.round(window.end * WHISPER_SR), from + 30 * WHISPER_SR);
      const chunkSeconds = (to - from) / WHISPER_SR;
      const chunk = await transcribeChunk(vocals.subarray(from, to), seek, language, true);
      language = chunk.language;
      windowLines.push(...chunk.lines);
      if (chunk.consumed === null) break;
      // Whisper stopped early: continue from its last complete segment.
      const step = chunk.consumed >= 1 ? chunk.consumed : chunkSeconds;
      seek += step;
      done += Math.min(chunkSeconds, step);
      onProgress?.("transcribe", Math.min(1, done / Math.max(total, 1e-6)));
    }

    // Singing that got no text (Whisper skips lines in another language, or
    // sometimes repeats) and, in a window with two languages, doubtful lines
    // (Whisper sometimes translates a line into the window's language):
    // transcribe just those parts again, with their own language.
    const covered = (r: Region) => {
      let sum = 0;
      for (const l of windowLines) sum += overlap(r, { start: l.start - 0.2, end: l.end + 0.2 });
      return sum / (r.end - r.start);
    };
    const missing = regions
      .map((r) => ({ start: Math.max(r.start, window.start), end: Math.min(r.end, window.end) }))
      .filter((r) => r.end - r.start >= 0.6 && covered(r) < 0.3);
    const sung = [...wordsPerLanguage.values()].reduce((a, b) => a + b, 0);
    const mixed =
      !fixed &&
      (windowLines.some((l) => l.language !== language) ||
        [...wordsPerLanguage].some(([code, words]) => code !== language && words >= Math.max(MIXED_SONG_WORDS, 0.15 * sung)));
    const doubtful = mixed ? windowLines.filter((l) => l.language === language && confidence([l]) < RECHECK_BELOW) : [];
    const spans: Region[] = [];
    for (const r of [
      ...missing,
      ...doubtful.map((l) => ({ start: Math.max(window.start, l.start - 0.3), end: Math.min(window.end, l.end + 0.3) })),
    ].sort((a, b) => a.start - b.start)) {
      const last = spans[spans.length - 1];
      if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
      else spans.push({ ...r });
    }
    if (spans.length) {
      const startAt = spans[0].start;
      const from = Math.round(startAt * WHISPER_SR);
      const to = Math.min(vocals.length, from + 30 * WHISPER_SR);
      const chunk = new Float32Array(to - from);
      let voiced = 0;
      for (const r of spans) {
        const a = Math.max(from, Math.round((r.start - 0.1) * WHISPER_SR));
        const b = Math.min(to, Math.round((r.end + 0.1) * WHISPER_SR));
        if (b <= a) continue;
        chunk.set(vocals.subarray(a, b), a - from);
        voiced += (b - a) / WHISPER_SR;
      }
      const repair = await transcribeChunk(chunk, startAt, fixed, false, voiced);
      windowLines = mergeRepair(windowLines, doubtful, missing, repair.lines);
    }
    for (const line of windowLines) wordsPerLanguage.set(line.language, (wordsPerLanguage.get(line.language) ?? 0) + line.words.length);
    lines.push(...windowLines);
  }

  // Main language: the detected one, unless most words are in another (then its share of the words).
  let language = fixed ?? "en";
  let languageProbability = fixed ? 1 : 0;
  if (!fixed && languageTotals.size) {
    let sum = 0;
    for (const v of languageTotals.values()) sum += v;
    for (const [code, v] of languageTotals) {
      if (v / sum > languageProbability) {
        language = code;
        languageProbability = v / sum;
      }
    }
    const sung = [...wordsPerLanguage.values()].reduce((a, b) => a + b, 0);
    for (const [code, words] of wordsPerLanguage) {
      if (code !== language && words > (wordsPerLanguage.get(language) ?? 0)) {
        language = code;
        languageProbability = words / sung;
      }
    }
  }
  lines.sort((a, b) => a.start - b.start);
  for (const line of lines) line.start = line.words[0].start;
  onProgress?.("transcribe", 1);
  return {
    version: LYRICS_VERSION,
    model,
    language,
    languageProbability: Math.round(languageProbability * 1000) / 1000,
    detected: !fixed,
    lines: harmonizeRepeats(lines),
  };
}
