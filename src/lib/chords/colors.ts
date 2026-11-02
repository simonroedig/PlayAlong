/**
 * A colour for each chord by its scale degree (I, IV, V …), so a chord keeps
 * its colour through a song and in every key: the chord chart, the chord now
 * and next, and its notes on the fretboard match.
 */

/** By semitones above the tonic. Neighbouring chords in common progressions get clearly different colours. */
const DEGREE_COLORS = [
  "#fb923c", // I     orange
  "#2dd4bf", // ♭II   teal
  "#facc15", // II    yellow
  "#a3e635", // ♭III  lime
  "#4ade80", // III   green
  "#22d3ee", // IV    cyan
  "#818cf8", // ♯IV   indigo
  "#60a5fa", // V     blue
  "#a78bfa", // ♭VI   violet
  "#e879f9", // VI    fuchsia
  "#f472b6", // ♭VII  pink
  "#fb7185", // VII   rose
];

export function degreeColor(degree: number | null | undefined): string | null {
  if (degree === null || degree === undefined) return null;
  return DEGREE_COLORS[((degree % 12) + 12) % 12];
}

/** Grey for chords without a key to relate them to. */
export const NEUTRAL = "#a1a1aa";

/** The chord's colour, or grey without a key. */
export function chordColor(degree: number | null | undefined): string {
  return degreeColor(degree) ?? NEUTRAL;
}

/** A hex colour with transparency, for borders and backgrounds. */
export function alpha(hex: string, opacity: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${opacity})`;
}
