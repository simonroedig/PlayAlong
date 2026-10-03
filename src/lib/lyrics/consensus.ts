import type { LyricLine, LyricWord } from "./transcribe";

/**
 * Repeated lines (choruses, hooks) should read the same every time: lines
 * that mostly agree are aligned word by word, and where they disagree the
 * variant Whisper was most confident about wins, unless the word was sung
 * clearly (a deliberate change in the last chorus). Timing stays untouched.
 */

const normalize = (w: string) =>
  w
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, "")
    .replace(/^'+|'+$/g, "");

type Op = { kind: "match" | "sub"; a: number; b: number } | { kind: "del"; a: number } | { kind: "ins"; b: number };

/** Word-level edit alignment (Levenshtein with backtrace). */
export function alignWords(a: string[], b: string[]): { distance: number; ops: Op[] } {
  const n = a.length;
  const m = b.length;
  const d = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      ops.push({ kind: a[i - 1] === b[j - 1] ? "match" : "sub", a: i - 1, b: j - 1 });
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ kind: "del", a: i - 1 });
      i--;
    } else {
      ops.push({ kind: "ins", b: j - 1 });
      j--;
    }
  }
  ops.reverse();
  return { distance: d[n][m], ops };
}

function similarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  return 1 - alignWords(a, b).distance / Math.max(a.length, b.length);
}

/** Keeps the capitalisation / spacing style of the word being replaced. */
function restyle(original: string, replacement: string): string {
  const lead = original.match(/^\s*/)?.[0] ?? "";
  const trailPunct = original.match(/[^\p{L}\p{N}']+$/u)?.[0] ?? "";
  let core = replacement.trim().replace(/[^\p{L}\p{N}']+$/u, "");
  const originalCore = original.trim();
  if (originalCore && originalCore[0] === originalCore[0].toUpperCase() && originalCore[0] !== originalCore[0].toLowerCase()) {
    core = core.charAt(0).toUpperCase() + core.slice(1);
  } else if (core.length > 1 && core !== "I" && !/^I'/.test(core)) {
    core = core.charAt(0).toLowerCase() + core.slice(1);
  }
  return lead + core + trailPunct;
}

export function harmonizeRepeats(lines: LyricLine[], minWords = 4, minSimilarity = 0.7, margin = 0.05, clear = 0.9): LyricLine[] {
  const tokens = lines.map((l) => l.words.map((w) => normalize(w.text)));
  // Union-find groups of similar lines.
  const parent = lines.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < lines.length; i++) {
    if (tokens[i].length < minWords) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (tokens[j].length < minWords || Math.abs(tokens[i].length - tokens[j].length) > 2) continue;
      if (similarity(tokens[i], tokens[j]) >= minSimilarity) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, number[]>();
  lines.forEach((_, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  });

  const out = lines.map((l) => ({ ...l, words: l.words.map((w) => ({ ...w })) }));
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    // Pivot: the most confident rendition.
    const meanP = (i: number) => lines[i].words.reduce((s, w) => s + w.probability, 0) / lines[i].words.length;
    const pivot = members.reduce((best, i) => (meanP(i) > meanP(best) ? i : best), members[0]);
    // For each pivot word: votes per normalised variant (sum of probabilities) and its best spelling.
    const votes = tokens[pivot].map(() => new Map<string, { score: number; word: LyricWord }>());
    const placements = new Map<number, (number | null)[]>(); // member → pivot index per word
    for (const i of members) {
      const place: (number | null)[] = lines[i].words.map(() => null);
      const { ops } = i === pivot ? { ops: tokens[i].map((_, k) => ({ kind: "match" as const, a: k, b: k })) } : alignWords(tokens[pivot], tokens[i]);
      for (const op of ops) {
        if (op.kind !== "match" && op.kind !== "sub") continue;
        place[op.b] = op.a;
        const word = lines[i].words[op.b];
        const key = tokens[i][op.b];
        const entry = votes[op.a].get(key);
        if (!entry) votes[op.a].set(key, { score: word.probability, word });
        else {
          entry.score += word.probability;
          if (word.probability > entry.word.probability) entry.word = word;
        }
      }
      placements.set(i, place);
    }
    for (const i of members) {
      const place = placements.get(i)!;
      out[i].words.forEach((word, k) => {
        const p = place[k];
        if (p === null) return;
        const own = votes[p].get(tokens[i][k]);
        let best: { score: number; word: LyricWord } | null = null;
        for (const v of votes[p].values()) if (!best || v.score > best.score) best = v;
        if (!best || !own || best === own || word.probability >= clear || best.score < own.score + margin) return;
        word.text = restyle(word.text, best.word.text);
        word.probability = Math.max(word.probability, best.score / members.length);
      });
    }
  }
  return out;
}
