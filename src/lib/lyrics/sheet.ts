import type { DisplayChord } from "../chords/sheet";
import type { LyricLine } from "./transcribe";

/**
 * Lyrics with chords above the words, like a chord sheet: each chord change
 * sits on the word being sung when it happens; chords between sung lines
 * form instrumental rows.
 */

export interface SheetChord {
  label: string;
  uncertain: boolean;
  /** Index into the display chords. */
  index: number;
  /** The chord started before this line (shown for orientation). */
  carried: boolean;
}

export interface SheetWord {
  text: string;
  start: number;
  end: number;
  uncertain: boolean;
  chords: SheetChord[];
}

export type SheetLine =
  | { kind: "lyrics"; start: number; end: number; words: SheetWord[]; hasChords: boolean }
  | { kind: "instrumental"; start: number; end: number; chords: SheetChord[] };

/** Words below this probability are marked as unsure. */
export const UNSURE_WORD_BELOW = 0.4;

/** The main language followed by any other language with at least 15 % of the words. */
export function lyricsLanguages(lines: readonly LyricLine[], main: string): string[] {
  const words = new Map<string, number>();
  let total = 0;
  for (const line of lines) {
    words.set(line.language, (words.get(line.language) ?? 0) + line.words.length);
    total += line.words.length;
  }
  const others = [...words]
    .filter(([code, count]) => code !== main && count >= 0.15 * total)
    .sort((a, b) => b[1] - a[1])
    .map(([code]) => code);
  return [main, ...others];
}

/** A chord starting this much before a line still belongs to it (pick-up). */
const LEAD_IN = 0.8;

function chordAt(chords: readonly DisplayChord[], time: number): number {
  let lo = 0;
  let hi = chords.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chords[mid].start <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

const sheetChord = (chords: readonly DisplayChord[], index: number, carried: boolean): SheetChord => ({
  label: chords[index].label,
  uncertain: chords[index].uncertain,
  index,
  carried,
});

export function lyricsSheet(lines: readonly LyricLine[], chords: readonly DisplayChord[] | null, duration: number): SheetLine[] {
  const out: SheetLine[] = [];
  const list = chords ?? [];
  // Chord changes already placed (each appears once).
  const used = new Set<number>();
  const instrumental = (from: number, to: number) => {
    const items: SheetChord[] = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (used.has(i) || c.root === null) continue;
      if (c.start >= from - 1e-6 && c.start < to) {
        items.push(sheetChord(list, i, false));
        used.add(i);
      }
    }
    if (items.length) out.push({ kind: "instrumental", start: Math.max(from, list[items[0].index].start), end: to, chords: items });
  };

  let previousEnd = 0;
  lines.forEach((line, n) => {
    const nextStart = n + 1 < lines.length ? lines[n + 1].start : duration;
    const lineStart = Math.max(previousEnd, line.start - LEAD_IN);
    instrumental(previousEnd, lineStart);
    const words: SheetWord[] = line.words.map((w) => ({
      text: w.text.trim(),
      start: w.start,
      end: w.end,
      uncertain: w.probability < UNSURE_WORD_BELOW,
      chords: [],
    }));
    if (words.length === 0) return;
    // The chord sounding as the line starts, for orientation.
    const sounding = chordAt(list, line.start);
    if (sounding >= 0 && list[sounding].root !== null && !used.has(sounding) && list[sounding].start < lineStart) {
      words[0].chords.push(sheetChord(list, sounding, true));
      used.add(sounding);
    }
    // Chord changes until the next line (or shortly after this one ends) go on the word being sung.
    const until = Math.max(line.end, Math.min(nextStart - LEAD_IN, line.end + 1.5));
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (used.has(i) || c.root === null || c.start < lineStart - 1e-6 || c.start >= until) continue;
      let target = 0;
      for (let k = 0; k < words.length; k++) if (words[k].start <= c.start + 0.05) target = k;
      words[target].chords.push(sheetChord(list, i, false));
      used.add(i);
    }
    // Repeat the chord at the line start if nothing marks it yet (the chord carried over from the last line).
    if (words[0].chords.length === 0 && sounding >= 0 && list[sounding].root !== null) {
      words[0].chords.push(sheetChord(list, sounding, true));
    }
    out.push({ kind: "lyrics", start: line.start, end: line.end, words, hasChords: words.some((w) => w.chords.length > 0) });
    previousEnd = until;
  });
  instrumental(previousEnd, duration + 1);
  return out;
}

/** Index of the sheet line and word at `time` (line: last started; word: last started in that line). */
export function sheetPosition(lines: readonly SheetLine[], time: number): { line: number; word: number } {
  let line = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].start <= time) line = i;
    else break;
  }
  if (line < 0) return { line: -1, word: -1 };
  const current = lines[line];
  if (current.kind !== "lyrics") return { line, word: -1 };
  let word = -1;
  for (let k = 0; k < current.words.length; k++) if (current.words[k].start <= time) word = k;
  // After the last word has ended, nothing is being sung.
  if (word === current.words.length - 1 && time > current.words[word].end + 0.4) word = -1;
  return { line, word };
}
