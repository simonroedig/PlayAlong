import { estimateKey, keyPrior } from "./decode";
import type { Key } from "./vocabulary";

/**
 * A recording can hold more than one song (a live set, a medley with
 * applause in between). Songs are told apart by breaks: stretches of
 * several seconds where no chord sounds (silence, applause, talking).
 * Neighbouring parts in the same key and tempo are one song after all
 * (a long a-cappella break), so they are merged again.
 */

export interface TimeRange {
  start: number;
  end: number;
}

export interface BreakOptions {
  /** Shortest break between two songs (seconds). */
  minBreak?: number;
  /** Shortest song (seconds); shorter parts stay with their neighbour. */
  minPart?: number;
}

/**
 * Splits [0, duration] at long breaks. `noChord` is the per-frame
 * probability of "no chord", `level` the per-frame loudness of the
 * harmonic instruments, both every `frameTime` seconds.
 */
export function splitAtBreaks(
  noChord: ArrayLike<number>,
  level: ArrayLike<number>,
  frameTime: number,
  duration: number,
  options: BreakOptions = {},
): TimeRange[] {
  const { minBreak = 5, minPart = 40 } = options;
  const frames = Math.min(noChord.length, level.length);
  if (frames === 0 || duration < 2 * minPart) return [{ start: 0, end: duration }];
  const sorted = Array.from({ length: frames }, (_, f) => level[f]).sort((a, b) => a - b);
  const loud = sorted[Math.floor(frames * 0.9)] || 1e-9;

  // Per second: how much of it has a chord played at a decent level.
  const seconds = Math.ceil(frames * frameTime);
  const music = new Float32Array(seconds);
  const count = new Uint16Array(seconds);
  for (let f = 0; f < frames; f++) {
    const s = Math.min(seconds - 1, Math.floor(f * frameTime));
    music[s] += (1 - noChord[f]) * (level[f] >= 0.03 * loud ? 1 : 0);
    count[s]++;
  }
  const quiet = Array.from(music, (m, s) => (count[s] ? m / count[s] : 0) < 0.3);

  // Breaks inside the recording (not the silence before the first or after the last song).
  const cuts: number[] = [];
  for (let s = 0; s < seconds; ) {
    if (!quiet[s]) {
      s++;
      continue;
    }
    let e = s;
    while (e < seconds && quiet[e]) e++;
    if (s > 0 && e < seconds && e - s >= minBreak) cuts.push(Math.max(s, e - 0.5));
    s = e;
  }

  const ranges: TimeRange[] = [];
  let start = 0;
  for (const cut of cuts) {
    if (cut - start >= minPart && duration - cut >= minPart) {
      ranges.push({ start, end: cut });
      start = cut;
    }
  }
  ranges.push({ start, end: duration });
  return ranges;
}

const sameKey = (a: Key | null, b: Key | null) => (!a && !b) || (!!a && !!b && a.tonic === b.tonic && a.mode === b.mode);

/** Tempi that differ by less than 4 %, also at double or half speed. */
export function sameTempo(a: number, b: number): boolean {
  return [1, 2, 0.5].some((f) => Math.abs(a * f - b) / b < 0.04);
}

/** Merges neighbouring parts that share key and tempo: those are one song with a break. */
export function mergeSimilar<T extends TimeRange & { key: Key | null; bpm: number }>(parts: T[]): T[] {
  const out: T[] = [];
  for (const part of parts) {
    const prev = out[out.length - 1];
    if (prev && sameKey(prev.key, part.key) && sameTempo(prev.bpm, part.bpm)) {
      out[out.length - 1] = { ...prev, end: part.end };
    } else out.push({ ...part });
  }
  return out;
}

export interface KeyChange {
  /** Seconds. */
  start: number;
  /** Index into the beats. */
  startBeat: number;
  key: Key;
}

const keyId = (k: Key | null) => (k ? `${k.tonic}${k.mode}` : "-");

/** Cost of a key change, in nats: about six bars of clear evidence. */
const SWITCH_COST = 16;
const MIN_RUN = 8;

/**
 * Key changes within a song (a modulation for the last chorus, a bridge in
 * another key). Each bar is scored against the 12 major key signatures and
 * a Viterbi path with a switching cost picks where the key changes; stretches
 * shorter than 8 bars stay in the key around them. Each stretch then gets its
 * key (major or relative minor) from all of its chords.
 */
export function keyChanges(beatProbs: readonly Float64Array[], beatsPerBar: number, offset: number, beatTimes: readonly number[]): KeyChange[] {
  const bars = Math.floor(beatProbs.length / beatsPerBar);
  if (bars < 32) return [];
  const states = beatProbs[0].length;
  const logPrior = Array.from({ length: 12 }, (_, tonic) => Array.from(keyPrior({ tonic, mode: "major" }), (p) => Math.log(p + 1e-6)));

  // Viterbi over key signatures, one step per bar.
  let score = new Float64Array(12);
  const back: Uint8Array[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const hist = new Float64Array(states);
    for (let b = bar * beatsPerBar; b < (bar + 1) * beatsPerBar; b++) for (let s = 0; s < states; s++) hist[s] += beatProbs[b][s];
    let best = 0;
    for (let k = 1; k < 12; k++) if (score[k] > score[best]) best = k;
    const next = new Float64Array(12);
    const from = new Uint8Array(12);
    for (let k = 0; k < 12; k++) {
      const stay = score[k];
      const move = score[best] - SWITCH_COST;
      from[k] = bar > 0 && move > stay ? best : k;
      let e = 0;
      for (let s = 0; s < states; s++) e += hist[s] * logPrior[k][s];
      next[k] = Math.max(stay, bar > 0 ? move : stay) + e;
    }
    back.push(from);
    score = next;
  }
  const path = new Uint8Array(bars);
  for (let k = 1; k < 12; k++) if (score[k] > score[path[bars - 1]]) path[bars - 1] = k;
  for (let bar = bars - 1; bar > 0; bar--) path[bar - 1] = back[bar][path[bar]];

  // Runs of one key signature; short ones join the run before (or, at the start, after).
  const runs: { bar: number; length: number; sig: number }[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const last = runs[runs.length - 1];
    if (last && last.sig === path[bar]) last.length++;
    else runs.push({ bar, length: 1, sig: path[bar] });
  }
  const kept: typeof runs = [];
  for (const run of runs) {
    const last = kept[kept.length - 1];
    if (last && (run.length < MIN_RUN || last.sig === run.sig)) last.length += run.length;
    else kept.push({ ...run });
  }
  if (kept.length > 1 && kept[0].length < MIN_RUN) {
    kept[1] = { ...kept[1], bar: 0, length: kept[1].length + kept[0].length };
    kept.shift();
  }

  // The key of each run from its chords, then drop changes to the same key.
  const keyed = kept.map((run) => {
    const hist = new Float64Array(states);
    for (let b = run.bar * beatsPerBar; b < (run.bar + run.length) * beatsPerBar; b++) for (let s = 0; s < states; s++) hist[s] += beatProbs[b][s];
    return { bar: run.bar, key: estimateKey(hist) };
  });
  const changes: KeyChange[] = [];
  for (let i = 1; i < keyed.length; i++) {
    const { bar, key } = keyed[i];
    if (!key || keyId(key) === keyId(keyed[i - 1].key)) continue;
    const startBeat = offset + bar * beatsPerBar;
    changes.push({ start: beatTimes[startBeat], startBeat, key });
  }
  return changes;
}
