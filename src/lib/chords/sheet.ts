import type { ChordAnalysis } from "./analyze";
import { chordLabel, usesFlats, type Key } from "./vocabulary";

/**
 * Turns a chord analysis into what the player shows: labels in the shapes
 * the guitarist fingers (capo, down-tuning), merged chords, bars.
 */

export interface ChordView {
  /** Triads only (no 7ths, sus, slash basses). */
  simple: boolean;
  /** Capo fret, 0 = none. */
  capo: number;
  /** Guitar tuned down by this many semitones (1 = E♭ standard). */
  tuneDown: number;
}

export const DEFAULT_CHORD_VIEW: ChordView = { simple: false, capo: 0, tuneDown: 0 };

/** Chords whose probability is below this are shown as uncertain. */
export const UNCERTAIN_BELOW = 0.6;

const mod = (n: number, m: number) => ((n % m) + m) % m;
const mod12 = (n: number) => mod(n, 12);

/** Semitones from the sounding chord to the shape that is played. */
export function shapeShift(view: ChordView): number {
  return view.tuneDown - view.capo;
}

export function displayKey(key: Key | null, view: ChordView): Key | null {
  return key ? { tonic: mod12(key.tonic + shapeShift(view)), mode: key.mode } : null;
}

export interface DisplayChord {
  start: number;
  end: number;
  startBeat: number;
  endBeat: number;
  label: string;
  /** Sounding root (before capo / tuning), null for no chord. */
  root: number | null;
  confidence: number;
  uncertain: boolean;
}

export function displayChords(analysis: ChordAnalysis, view: ChordView): DisplayChord[] {
  const shift = shapeShift(view);
  const key = displayKey(analysis.key, view);
  const spelling = key ? (usesFlats(key) ? "flat" : "sharp") : "shape";
  const out: DisplayChord[] = [];
  for (const segment of analysis.segments) {
    const label = chordLabel(segment, { simple: view.simple, transpose: shift, spelling });
    const prev = out[out.length - 1];
    if (prev && prev.label === label) {
      // e.g. C and Cmaj7 in simple mode
      const a = prev.end - prev.start;
      const b = segment.end - segment.start;
      prev.confidence = (prev.confidence * a + segment.confidence * b) / (a + b || 1);
      prev.uncertain = prev.root !== null && prev.confidence < UNCERTAIN_BELOW;
      prev.end = segment.end;
      prev.endBeat = segment.endBeat;
      continue;
    }
    out.push({
      start: segment.start,
      end: segment.end,
      startBeat: segment.startBeat,
      endBeat: segment.endBeat,
      label,
      root: segment.root,
      confidence: segment.confidence,
      uncertain: segment.root !== null && segment.confidence < UNCERTAIN_BELOW,
    });
  }
  return out;
}

/** Index of the last element with `key(item) <= value`, or -1. */
function lastAtOrBefore<T>(items: readonly T[], value: number, key: (item: T) => number): number {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(items[mid]) <= value) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Index of the chord sounding at `time` (chords are contiguous), or -1 before the first one. */
export function chordIndexAt(chords: readonly DisplayChord[], time: number): number {
  return lastAtOrBefore(chords, time, (c) => c.start);
}

/** Index of the beat at or before `time`, or -1. */
export function beatIndexAt(beats: readonly number[], time: number): number {
  return lastAtOrBefore(beats, time, (b) => b);
}

/** Position of a beat within its bar (0 = downbeat). */
export function beatInBar(analysis: Pick<ChordAnalysis, "beatsPerBar" | "downbeat">, beat: number): number {
  return mod(beat - analysis.downbeat, analysis.beatsPerBar);
}

export interface BarCell {
  label: string;
  uncertain: boolean;
  /** Beats from the start of the bar. */
  offset: number;
  beats: number;
  /** The chord started in an earlier bar. */
  continued: boolean;
  chordIndex: number;
}

export interface Bar {
  /** 1-based; a pickup bar before the first downbeat is 0. */
  number: number;
  start: number;
  end: number;
  startBeat: number;
  /** Number of beats in this bar. */
  beats: number;
  cells: BarCell[];
}

export function chordBars(analysis: ChordAnalysis, chords: readonly DisplayChord[], duration: number): Bar[] {
  const { beats, beatsPerBar } = analysis;
  if (beats.length === 0) return [];
  const downbeat = mod(analysis.downbeat, beatsPerBar);
  const starts: number[] = [];
  if (downbeat > 0) starts.push(0);
  for (let b = downbeat; b < beats.length; b += beatsPerBar) starts.push(b);
  const bars: Bar[] = [];
  let c = 0;
  starts.forEach((startBeat, k) => {
    const endBeat = k + 1 < starts.length ? starts[k + 1] : beats.length;
    const start = beats[startBeat];
    const end = endBeat < beats.length ? beats[endBeat] : duration;
    const cells: BarCell[] = [];
    while (c < chords.length && chords[c].endBeat <= startBeat) c++;
    for (let i = c; i < chords.length && chords[i].startBeat < endBeat; i++) {
      const from = Math.max(chords[i].startBeat, startBeat);
      const to = Math.min(chords[i].endBeat, endBeat);
      cells.push({
        label: chords[i].label,
        uncertain: chords[i].uncertain,
        offset: from - startBeat,
        beats: to - from,
        continued: chords[i].startBeat < startBeat,
        chordIndex: i,
      });
    }
    bars.push({ number: downbeat > 0 ? k : k + 1, start, end, startBeat, beats: endBeat - startBeat, cells });
  });
  return bars;
}

/** Concert pitch of A4 that matches the recording (for tuning the guitar to it). */
export function referencePitch(tuningCents: number): number {
  return Math.round(440 * 2 ** (tuningCents / 1200));
}
