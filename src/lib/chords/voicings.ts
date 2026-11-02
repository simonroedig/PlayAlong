import type { Quality } from "./vocabulary";

/**
 * How to finger a chord on the guitar: open chords, the barre shapes with the
 * root on the 6th or 5th string, and the jazz voicings guitarists use for 7th
 * chords (root on the 6th, 5th or 4th string, muted strings in between).
 * Each chord gets a recommended voicing first and the alternatives after it.
 */

/** Frets from the low E to the high e string; null = not played, 0 = open. */
export type Frets = (number | null)[];

export interface Voicing {
  frets: Frets;
  /** e.g. "Open", "Barre, root on 6th string", "Jazz, root on 5th string". */
  name: string;
  /** Fret of a barre across several strings, if the shape uses one. */
  barre: number | null;
}

const OPEN_STRINGS = [4, 9, 2, 7, 11, 4]; // E A D G B E as pitch classes
const STRING_NAMES = ["6th", "5th", "4th"];

interface Shape {
  /** String the root is on (0 = low E, 1 = A, 2 = D). */
  root: 0 | 1 | 2;
  /** Frets relative to the root's fret. */
  frets: Frets;
  kind: "barre" | "jazz" | "triad";
}

const _ = null;

/** Movable shapes. Order within a quality is the order offered. */
const SHAPES: Partial<Record<Quality, Shape[]>> = {
  maj: [
    { root: 0, frets: [0, 2, 2, 1, 0, 0], kind: "barre" },
    { root: 1, frets: [_, 0, 2, 2, 2, 0], kind: "barre" },
    { root: 2, frets: [_, _, 0, 2, 3, 2], kind: "triad" },
  ],
  min: [
    { root: 0, frets: [0, 2, 2, 0, 0, 0], kind: "barre" },
    { root: 1, frets: [_, 0, 2, 2, 1, 0], kind: "barre" },
    { root: 2, frets: [_, _, 0, 2, 3, 1], kind: "triad" },
  ],
  "7": [
    { root: 0, frets: [0, _, 0, 1, 0, _], kind: "jazz" },
    { root: 1, frets: [_, 0, _, 0, 2, 0], kind: "jazz" },
    { root: 2, frets: [_, _, 0, 2, 1, 2], kind: "jazz" },
    { root: 0, frets: [0, 2, 0, 1, 0, 0], kind: "barre" },
    { root: 1, frets: [_, 0, 2, 0, 2, 0], kind: "barre" },
  ],
  maj7: [
    { root: 0, frets: [0, _, 1, 1, 0, _], kind: "jazz" },
    { root: 1, frets: [_, 0, _, 1, 2, 0], kind: "jazz" },
    { root: 2, frets: [_, _, 0, 2, 2, 2], kind: "jazz" },
    { root: 1, frets: [_, 0, 2, 1, 2, 0], kind: "barre" },
  ],
  min7: [
    { root: 0, frets: [0, _, 0, 0, 0, _], kind: "jazz" },
    { root: 1, frets: [_, 0, _, 0, 1, 0], kind: "jazz" },
    { root: 2, frets: [_, _, 0, 2, 1, 1], kind: "jazz" },
    { root: 0, frets: [0, 2, 0, 0, 0, 0], kind: "barre" },
    { root: 1, frets: [_, 0, 2, 0, 1, 0], kind: "barre" },
  ],
  hdim7: [
    { root: 0, frets: [0, _, 0, 0, -1, _], kind: "jazz" },
    { root: 1, frets: [_, 0, 1, 0, 1, _], kind: "jazz" },
    { root: 2, frets: [_, _, 0, 1, 1, 1], kind: "jazz" },
  ],
  dim7: [
    { root: 0, frets: [0, _, -1, 0, -1, _], kind: "jazz" },
    { root: 1, frets: [_, 0, 1, -1, 1, _], kind: "jazz" },
    { root: 2, frets: [_, _, 0, 1, 0, 1], kind: "jazz" },
  ],
  dim: [
    { root: 1, frets: [_, 0, 1, 2, 1, _], kind: "triad" },
    { root: 0, frets: [0, 1, 2, 0, _, _], kind: "triad" },
  ],
  aug: [
    { root: 1, frets: [_, 0, -1, -2, -2, _], kind: "triad" },
    { root: 0, frets: [0, _, 2, 1, 1, _], kind: "triad" },
  ],
  sus4: [
    { root: 1, frets: [_, 0, 2, 2, 3, 0], kind: "barre" },
    { root: 0, frets: [0, 2, 2, 2, 0, 0], kind: "barre" },
  ],
  sus2: [
    { root: 1, frets: [_, 0, 2, 2, 0, 0], kind: "barre" },
    { root: 0, frets: [0, 2, 4, 4, 0, 0], kind: "barre" },
  ],
  maj6: [
    { root: 0, frets: [0, _, -1, 1, 0, _], kind: "jazz" },
    { root: 1, frets: [_, 0, 2, 2, 2, 2], kind: "barre" },
  ],
  min6: [
    { root: 0, frets: [0, _, -1, 0, 0, _], kind: "jazz" },
    { root: 1, frets: [_, 0, _, -1, 1, 0], kind: "jazz" },
  ],
  minmaj7: [
    { root: 0, frets: [0, _, 1, 0, 0, _], kind: "jazz" },
    { root: 1, frets: [_, 0, 2, 1, 1, 0], kind: "barre" },
  ],
};

/** Open chords that are not just a movable shape at the nut, by "root:quality". */
const OPEN: Record<string, Frets> = {
  "0:maj": [_, 3, 2, 0, 1, 0], // C
  "7:maj": [3, 2, 0, 0, 0, 3], // G
  "0:7": [_, 3, 2, 3, 1, 0], // C7
  "7:7": [3, 2, 0, 0, 0, 1], // G7
  "11:7": [_, 2, 1, 2, 0, 2], // B7
  "0:maj7": [_, 3, 2, 0, 0, 0], // Cmaj7
  "5:maj7": [_, _, 3, 2, 1, 0], // Fmaj7
  "9:min7": [_, 0, 2, 0, 1, 0], // Am7
  "4:min7": [0, 2, 0, 0, 0, 0], // Em7
  "2:min7": [_, _, 0, 2, 1, 1], // Dm7
  "4:7": [0, 2, 0, 1, 0, 0], // E7
  "9:7": [_, 0, 2, 0, 2, 0], // A7
  "2:7": [_, _, 0, 2, 1, 2], // D7
  "2:sus2": [_, _, 0, 2, 3, 0], // Dsus2
  "2:sus4": [_, _, 0, 2, 3, 3], // Dsus4
};

/** Qualities where guitarists usually reach for jazz voicings rather than open or barre chords. */
const JAZZ: ReadonlySet<Quality> = new Set(["maj7", "min7", "hdim7", "dim7", "maj6", "min6", "minmaj7"]);

const mod12 = (n: number) => ((n % 12) + 12) % 12;

function place(shape: Shape, root: number): Frets {
  let fret = mod12(root - OPEN_STRINGS[shape.root]);
  const lowest = Math.min(...shape.frets.filter((f): f is number => f !== null));
  if (fret + lowest < 0) fret += 12;
  // High up the neck the same shape an octave lower is easier, when it fits.
  if (fret >= 10 && fret - 12 + lowest >= 0) fret -= 12;
  return shape.frets.map((f) => (f === null ? null : f + fret));
}

function describe(shape: Shape, frets: Frets): string {
  const open = frets.some((f) => f === 0);
  const string = STRING_NAMES[shape.root];
  if (shape.kind === "jazz") return `Jazz, root on ${string} string`;
  if (shape.kind === "triad") return open ? "Open" : `Root on ${string} string`;
  return open ? "Open" : `Barre, root on ${string} string`;
}

/** A barre where the shape lays a finger across several strings at its lowest fret. */
function barreOf(shape: Shape, frets: Frets): number | null {
  if (shape.kind !== "barre") return null;
  const played = frets.filter((f): f is number => f !== null);
  const low = Math.min(...played);
  return low > 0 && played.filter((f) => f === low).length >= 3 ? low : null;
}

const key = (frets: Frets) => frets.map((f) => (f === null ? "x" : f)).join(",");
const highest = (frets: Frets) => Math.max(...frets.map((f) => f ?? 0));

/** All voicings for a chord, the recommended one first. */
export function voicingsFor(root: number, quality: Quality): Voicing[] {
  const pc = mod12(root);
  const out: Voicing[] = [];
  const seen = new Set<string>();
  const add = (v: Voicing) => {
    if (seen.has(key(v.frets))) return;
    seen.add(key(v.frets));
    out.push(v);
  };
  const shapes = (SHAPES[quality] ?? SHAPES[quality.startsWith("min") ? "min" : "maj"] ?? []).map((shape) => {
    const frets = place(shape, pc);
    return { shape, frets, voicing: { frets, name: describe(shape, frets), barre: barreOf(shape, frets) } };
  });
  const open = OPEN[`${pc}:${quality}`];
  const atNut = shapes.filter((s) => s.frets.some((f) => f === 0) && s.shape.kind !== "jazz");

  // Jazz qualities: the jazz voicings first, lowest on the neck first. Otherwise: open chords first.
  const jazz = shapes.filter((s) => s.shape.kind === "jazz").sort((a, b) => highest(a.frets) - highest(b.frets));
  const rest = shapes.filter((s) => s.shape.kind !== "jazz").sort((a, b) => highest(a.frets) - highest(b.frets));
  if (JAZZ.has(quality)) {
    jazz.forEach((s) => add(s.voicing));
    if (open) add({ frets: open, name: "Open", barre: null });
    rest.forEach((s) => add(s.voicing));
  } else {
    if (open) add({ frets: open, name: "Open", barre: null });
    atNut.forEach((s) => add(s.voicing));
    rest.forEach((s) => add(s.voicing));
    jazz.forEach((s) => add(s.voicing));
  }
  return out;
}

/** Pitch classes a voicing sounds, lowest string first. */
export function voicingNotes(frets: Frets): number[] {
  return frets.flatMap((f, s) => (f === null ? [] : [mod12(OPEN_STRINGS[s] + f)]));
}

/** Key for remembering a chosen voicing per song: the shape played (after capo / tuning) and the quality. */
export const voicingKey = (shapeRoot: number, quality: Quality) => `${mod12(shapeRoot)}:${quality}`;

const cache = new Map<string, Voicing[]>();

/** The voicing chosen for a chord (or the recommended one), with the alternatives. */
export function pickVoicing(
  shapeRoot: number,
  quality: Quality,
  choice: Readonly<Record<string, number>>,
): { voicing: Voicing; index: number; all: Voicing[]; key: string } {
  const key = voicingKey(shapeRoot, quality);
  let all = cache.get(key);
  if (!all) {
    all = voicingsFor(shapeRoot, quality);
    cache.set(key, all);
  }
  const index = Math.min(Math.max(0, choice[key] ?? 0), all.length - 1);
  return { voicing: all[index], index, all, key };
}
