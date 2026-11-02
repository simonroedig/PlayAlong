import type { Key } from "./vocabulary";

/**
 * Scales on the fretboard: the five pentatonic boxes, and the full scale
 * or the blues scale filled into the same five positions (the CAGED-style
 * positions guitarists learn).
 */

export type ScaleKind = "pentatonic" | "scale" | "blues";
export type Instrument = "guitar" | "bass";

/** Open strings as MIDI notes, lowest first. */
export const OPEN_STRINGS: Record<Instrument, number[]> = {
  guitar: [40, 45, 50, 55, 59, 64],
  bass: [28, 33, 38, 43],
};

export const MAX_FRET = 17;

/**
 * Positions counted from the minor root position (the relative minor's
 * position 1, where most guitarists start) to the key's own numbering:
 * in minor the same, in major that box is position 5.
 */
export function keyPosition(fromMinorRoot: number, mode: Key["mode"]): number {
  return mode === "minor" ? fromMinorRoot : (fromMinorRoot + 4) % 5;
}
export function minorRootPosition(position: number, mode: Key["mode"]): number {
  return mode === "minor" ? position : (position + 1) % 5;
}
/** Positions reaching above this fret are shown an octave lower. */
const HIGHEST_POSITION_FRET = 15;

/** Semitones above the tonic. */
const TONES: Record<Key["mode"], Record<ScaleKind, number[]>> = {
  major: { pentatonic: [0, 2, 4, 7, 9], scale: [0, 2, 4, 5, 7, 9, 11], blues: [0, 2, 3, 4, 7, 9] },
  minor: { pentatonic: [0, 3, 5, 7, 10], scale: [0, 2, 3, 5, 7, 8, 10], blues: [0, 3, 5, 6, 7, 10] },
};

export function scaleTones(key: Key, kind: ScaleKind): number[] {
  return TONES[key.mode][kind];
}

export function scaleName(key: Key, kind: ScaleKind): string {
  const mode = key.mode === "major" ? "major" : "minor";
  if (kind === "pentatonic") return `${mode} pentatonic`;
  if (kind === "blues") return `${mode} blues scale`;
  return key.mode === "major" ? "major scale" : "natural minor scale";
}

export interface FretNote {
  /** String index, 0 = lowest. */
  string: number;
  fret: number;
  /** Semitones above the tonic. */
  degree: number;
  pc: number;
}

const mod12 = (n: number) => ((n % 12) + 12) % 12;

/** Every note of the scale on the neck, up to `maxFret`. */
export function scaleNeck(key: Key, kind: ScaleKind, instrument: Instrument, maxFret = MAX_FRET): FretNote[] {
  const tones = new Set(scaleTones(key, kind));
  const out: FretNote[] = [];
  OPEN_STRINGS[instrument].forEach((open, string) => {
    for (let fret = 0; fret <= maxFret; fret++) {
      const degree = mod12(open + fret - key.tonic);
      if (tones.has(degree)) out.push({ string, fret, degree, pc: mod12(open + fret) });
    }
  });
  return out;
}

/** Pentatonic box `position` (0 to 4): two notes per string, starting on the lowest string. */
function box(key: Key, instrument: Instrument, position: number): { string: number; pitch: number }[] {
  // A major key's boxes are its relative minor's, one further: major position 5 is minor position 1
  // (from the 6th degree), so the pair always sits on the same frets.
  if (key.mode === "major") return box({ tonic: mod12(key.tonic + 9), mode: "minor" }, instrument, (position + 1) % 5);
  const open = OPEN_STRINGS[instrument];
  const pent = TONES[key.mode].pentatonic;
  const rootFret = mod12(key.tonic - open[0]);
  const build = (startPitch: number) => {
    const notes: { string: number; pitch: number }[] = [];
    for (let p = startPitch; notes.length < 2 * open.length; p++) {
      if (pent.includes(mod12(p - key.tonic))) notes.push({ string: Math.floor(notes.length / 2), pitch: p });
    }
    return notes;
  };
  let notes = build(open[0] + rootFret + pent[position]);
  const frets = notes.map((n) => n.pitch - open[n.string]);
  // High up the neck: the same box an octave lower is easier to reach.
  if (Math.max(...frets) > HIGHEST_POSITION_FRET && Math.min(...frets) >= 12) notes = build(open[0] + rootFret + pent[position] - 12);
  return notes;
}

/**
 * One of the five positions: the pentatonic box, plus (for the full or the
 * blues scale) the other scale notes within reach of the same hand position.
 */
export function scalePosition(key: Key, kind: ScaleKind, instrument: Instrument, position: number): FretNote[] {
  const open = OPEN_STRINGS[instrument];
  const notes = box(key, instrument, position);
  const fretOf = (n: { string: number; pitch: number }) => n.pitch - open[n.string];
  const lo = Math.min(...notes.map(fretOf));
  const hi = Math.max(...notes.map(fretOf));
  const result = notes.map((n) => ({ string: n.string, pitch: n.pitch }));

  const pent = new Set(TONES[key.mode].pentatonic);
  const extra = scaleTones(key, kind).filter((t) => !pent.has(t));
  const first = notes[0].pitch;
  const last = notes[notes.length - 1].pitch;
  const outside = (fret: number) => (fret < lo ? lo - fret : fret > hi ? fret - hi : 0);
  for (let p = first - 12; p <= last + 12; p++) {
    if (!extra.includes(mod12(p - key.tonic))) continue;
    let candidates: number[];
    let tolerance = 1;
    if (p < first) {
      candidates = [0];
      tolerance = 0;
    } else if (p > last) {
      candidates = [open.length - 1];
      tolerance = 0;
    } else {
      const below = notes.filter((n) => n.pitch < p).pop()!;
      const above = notes.find((n) => n.pitch > p)!;
      candidates = below.string === above.string ? [below.string] : [below.string, above.string];
    }
    let best: { string: number; distance: number } | null = null;
    for (const string of candidates) {
      const fret = p - open[string];
      if (fret < 0) continue;
      const distance = outside(fret);
      if (!best || distance < best.distance) best = { string, distance };
    }
    if (best && best.distance <= tolerance) result.push({ string: best.string, pitch: p });
  }
  return result
    .map((n) => ({ string: n.string, fret: n.pitch - open[n.string], degree: mod12(n.pitch - key.tonic), pc: mod12(n.pitch) }))
    .sort((a, b) => a.string - b.string || a.fret - b.fret);
}

/** The frets a position spans. */
export function positionSpan(notes: readonly FretNote[]): [number, number] {
  return [Math.min(...notes.map((n) => n.fret)), Math.max(...notes.map((n) => n.fret))];
}
