/**
 * Chord vocabulary of the BTC models (Park et al., ISMIR 2019) and the
 * helpers to name, simplify and transpose chords.
 */

export const QUALITIES = [
  "min",
  "maj",
  "dim",
  "aug",
  "min6",
  "maj6",
  "min7",
  "minmaj7",
  "maj7",
  "7",
  "dim7",
  "hdim7",
  "sus2",
  "sus4",
] as const;
export type Quality = (typeof QUALITIES)[number];

/** Large-vocabulary model: index = root * 14 + quality, 168 = X (unknown), 169 = N (no chord). */
export const LARGE_CLASSES = 170;
export const LARGE_X = 168;
export const LARGE_N = 169;
/** Maj/min model: index = 2 * root (+1 for minor), 24 = N. */
export const MAJMIN_CLASSES = 25;
export const MAJMIN_N = 24;

export const INTERVALS: Record<Quality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  min6: [0, 3, 7, 9],
  maj6: [0, 4, 7, 9],
  min7: [0, 3, 7, 10],
  minmaj7: [0, 3, 7, 11],
  maj7: [0, 4, 7, 11],
  "7": [0, 4, 7, 10],
  dim7: [0, 3, 6, 9],
  hdim7: [0, 3, 6, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
};

/** The triad family a quality belongs to (by its third; sus chords count as major). */
export const FAMILY: Record<Quality, "maj" | "min"> = {
  maj: "maj",
  aug: "maj",
  maj6: "maj",
  maj7: "maj",
  "7": "maj",
  sus2: "maj",
  sus4: "maj",
  min: "min",
  dim: "min",
  min6: "min",
  min7: "min",
  minmaj7: "min",
  dim7: "min",
  hdim7: "min",
};

const SUFFIX: Record<Quality, string> = {
  maj: "",
  min: "m",
  dim: "dim",
  aug: "aug",
  min6: "m6",
  maj6: "6",
  min7: "m7",
  minmaj7: "m(maj7)",
  maj7: "maj7",
  "7": "7",
  dim7: "dim7",
  hdim7: "m7♭5",
  sus2: "sus2",
  sus4: "sus4",
};

const SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
/** How guitarists usually name chord shapes. */
const SHAPE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

/** Major keys (by tonic) written with flats. */
const FLAT_MAJOR_KEYS = new Set([5, 10, 3, 8, 1]);

export interface Key {
  /** Tonic pitch class, 0 = C. */
  tonic: number;
  mode: "major" | "minor";
}

export function usesFlats(key: Key | null): boolean {
  if (!key) return false;
  const relativeMajor = key.mode === "major" ? key.tonic : (key.tonic + 3) % 12;
  return FLAT_MAJOR_KEYS.has(relativeMajor);
}

export function noteName(pc: number, spelling: "sharp" | "flat" | "shape"): string {
  const names = spelling === "flat" ? FLAT_NAMES : spelling === "shape" ? SHAPE_NAMES : SHARP_NAMES;
  return names[((pc % 12) + 12) % 12];
}

export function keyName(key: Key): string {
  return `${noteName(key.tonic, usesFlats(key) ? "flat" : "sharp")}${key.mode === "minor" ? "m" : ""}`;
}

export interface ChordSymbol {
  /** Root pitch class, null for "no chord". */
  root: number | null;
  quality: Quality;
  /** Bass pitch class when it differs from the root (slash chord). */
  bass: number | null;
}

export interface LabelOptions {
  /** Triads only, no extensions or slash basses. */
  simple?: boolean;
  /** Semitones to subtract for display (capo) or add (down-tuned guitar). */
  transpose?: number;
  spelling?: "sharp" | "flat" | "shape";
}

export function chordLabel(chord: ChordSymbol, options: LabelOptions = {}): string {
  if (chord.root === null) return "N.C.";
  const shift = options.transpose ?? 0;
  const spelling = options.spelling ?? "sharp";
  const quality: Quality = options.simple ? FAMILY[chord.quality] : chord.quality;
  let label = noteName(chord.root + shift, spelling) + SUFFIX[quality];
  if (!options.simple && chord.bass !== null && chord.bass !== chord.root) {
    label += `/${noteName(chord.bass + shift, spelling)}`;
  }
  return label;
}

/** Pitch classes of a chord. */
export function chordTones(root: number, quality: Quality): number[] {
  return INTERVALS[quality].map((i) => (root + i) % 12);
}
