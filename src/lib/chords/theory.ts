import { noteName, usesFlats, type Key } from "./vocabulary";

/**
 * Music theory for the Theory tab: the circle of fifths and the seven modes
 * of the major scale, with their steps and the chords on each degree.
 */

const mod12 = (n: number) => ((n % 12) + 12) % 12;

/** Semitones of the major scale. */
export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

// ---------------------------------------------------------------------------
// Circle of fifths

/** Major key tonic at each of the 12 places, clockwise from the top (C, G, D …). */
export const circleTonic = (place: number) => mod12(7 * place);
/** Place of a key on the circle (a minor key sits with its relative major). */
export function circlePlace(key: Key): number {
  const major = key.mode === "major" ? key.tonic : mod12(key.tonic + 3);
  return mod12(7 * major);
}

/** "2 sharps", "3 flats", "no sharps or flats" (F♯ / G♭ major: 6 of either). */
export function keySignature(place: number): { count: number; accidental: "♯" | "♭" | null } {
  const p = mod12(place);
  if (p === 0) return { count: 0, accidental: null };
  return p <= 6 ? { count: p, accidental: "♯" } : { count: 12 - p, accidental: "♭" };
}

const MAJOR_NAMES = ["C", "G", "D", "A", "E", "B", "F♯/G♭", "D♭", "A♭", "E♭", "B♭", "F"];
const MINOR_NAMES = ["Am", "Em", "Bm", "F♯m", "C♯m", "G♯m", "D♯m/E♭m", "B♭m", "Fm", "Cm", "Gm", "Dm"];

/** Name of the major key at a place, and of its relative minor. */
export function circleNames(place: number): { major: string; minor: string } {
  const p = mod12(place);
  return { major: MAJOR_NAMES[p], minor: MINOR_NAMES[p] };
}

/**
 * The chords of a key on the circle: the neighbours of its place. For a
 * major key I, IV, V on the outer ring and ii, iii, vi (and vii°) inside;
 * for a minor key the same chords seen from its tonic (i, iv, v, ♭III …).
 */
export function diatonicOnCircle(key: Key): { place: number; ring: "outer" | "inner"; numeral: string; root: number }[] {
  const center = circlePlace(key);
  const minor = key.mode === "minor";
  const entries: { offset: number; ring: "outer" | "inner"; major: string; minor: string }[] = [
    { offset: 0, ring: "outer", major: "I", minor: "♭III" },
    { offset: -1, ring: "outer", major: "IV", minor: "♭VI" },
    { offset: 1, ring: "outer", major: "V", minor: "♭VII" },
    { offset: 0, ring: "inner", major: "vi", minor: "i" },
    { offset: -1, ring: "inner", major: "ii", minor: "iv" },
    { offset: 1, ring: "inner", major: "iii", minor: "v" },
    { offset: 2, ring: "inner", major: "vii°", minor: "ii°" },
  ];
  return entries.map((e) => {
    const place = mod12(center + e.offset);
    const majorTonic = circleTonic(place);
    const root = e.ring === "outer" ? majorTonic : mod12(majorTonic + 9);
    return { place, ring: e.ring, numeral: minor ? e.minor : e.major, root };
  });
}

// ---------------------------------------------------------------------------
// Modes

export interface Mode {
  name: string;
  /** Other name, if it has one. */
  alias: string | null;
  /** Which degree of the major scale it starts on (0 = Ionian). */
  start: number;
  /** The note that gives it its colour (degree index), compared with major or natural minor. */
  feature: number[];
  /** How that note is named, e.g. "♮6". */
  featureName: string | null;
  mood: string;
}

export const MODES: Mode[] = [
  { name: "Ionian", alias: "Major", start: 0, feature: [], featureName: null, mood: "Bright and settled: the major scale itself." },
  { name: "Dorian", alias: null, start: 1, feature: [5], featureName: "♮6", mood: "Minor, but with a raised 6th that sounds hopeful and cool. Funk, soul, jazz, Santana." },
  { name: "Phrygian", alias: null, start: 2, feature: [1], featureName: "♭2", mood: "Dark minor with a half step above the root. Flamenco and metal." },
  { name: "Lydian", alias: null, start: 3, feature: [3], featureName: "♯4", mood: "Major with a raised 4th: dreamy and floating. Film music." },
  { name: "Mixolydian", alias: "Dominant", start: 4, feature: [6], featureName: "♭7", mood: "Major with a flat 7th: bluesy, rocking. Over dominant 7th chords." },
  { name: "Aeolian", alias: "Natural minor", start: 5, feature: [], featureName: null, mood: "The natural minor scale: sad and serious." },
  { name: "Locrian", alias: null, start: 6, feature: [1, 4], featureName: "♭2 ♭5", mood: "The darkest: a diminished root chord. Over m7♭5 chords." },
];

export type TriadQuality = "maj" | "min" | "dim" | "aug";

export interface ModeDegree {
  /** Semitones above the tonic. */
  semitones: number;
  /** "1", "♭3", "♯4" (compared with the major scale). */
  degree: string;
  note: string;
  /** Roman numeral of the chord on this degree ("ii", "♭VII", "vii°"). */
  numeral: string;
  chord: string;
  quality: TriadQuality;
}

/** Whole (2) and half (1) steps between the notes of a mode, ending back on the octave. */
export function modeSteps(mode: Mode): number[] {
  const steps = MAJOR_SCALE.map((s, i) => (i < 6 ? MAJOR_SCALE[i + 1] : 12) - s);
  return [...steps.slice(mode.start), ...steps.slice(0, mode.start)];
}

/** The notes, degrees and chords of a mode on a tonic. */
export function modeDegrees(tonic: number, mode: Mode): ModeDegree[] {
  const steps = modeSteps(mode);
  const semis = [0];
  for (let i = 0; i < 6; i++) semis.push(semis[i] + steps[i]);
  // Spelled like the major key it shares its notes with.
  const parent: Key = { tonic: mod12(tonic - MAJOR_SCALE[mode.start]), mode: "major" };
  const spelling = usesFlats(parent) ? "flat" : "sharp";
  return semis.map((s, i) => {
    const third = mod12(semis[(i + 2) % 7] - s);
    const fifth = mod12(semis[(i + 4) % 7] - s);
    const quality: TriadQuality = third === 4 ? (fifth === 8 ? "aug" : "maj") : fifth === 6 ? "dim" : "min";
    const diff = s - MAJOR_SCALE[i];
    const accidental = diff < 0 ? "♭".repeat(-diff) : "♯".repeat(diff);
    const roman = ROMAN[i];
    const numeral =
      accidental + (quality === "min" || quality === "dim" ? roman.toLowerCase() : roman) + (quality === "dim" ? "°" : quality === "aug" ? "+" : "");
    const note = noteName(tonic + s, spelling);
    const suffix = quality === "min" ? "m" : quality === "dim" ? "°" : quality === "aug" ? "+" : "";
    return { semitones: s, degree: `${accidental}${i + 1}`, note, numeral, chord: note + suffix, quality };
  });
}
