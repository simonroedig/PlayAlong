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
