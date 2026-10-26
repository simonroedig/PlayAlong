import { describe, expect, it } from "vitest";
import { keyChanges, mergeSimilar, sameTempo, splitAtBreaks } from "./parts";
import { STATES } from "./decode";

const FT = 0.1; // frame time in these tests

/** Per-frame "no chord" probability and level for a recording described in seconds. */
function recording(sections: { seconds: number; music: boolean }[]) {
  const noChord: number[] = [];
  const level: number[] = [];
  for (const s of sections) {
    for (let f = 0; f < s.seconds / FT; f++) {
      noChord.push(s.music ? 0.05 : 0.95);
      level.push(s.music ? 1 : 0.2);
    }
  }
  return { noChord, level, duration: sections.reduce((a, s) => a + s.seconds, 0) };
}

describe("splitting a recording into songs", () => {
  it("splits at long breaks between songs", () => {
    const r = recording([
      { seconds: 3, music: false },
      { seconds: 120, music: true },
      { seconds: 8, music: false },
      { seconds: 90, music: true },
      { seconds: 10, music: false },
      { seconds: 150, music: true },
      { seconds: 4, music: false },
    ]);
    const parts = splitAtBreaks(r.noChord, r.level, FT, r.duration);
    expect(parts.length).toBe(3);
    expect(parts[0].start).toBe(0);
    expect(parts[1].start).toBeCloseTo(130.5, 0);
    expect(parts[2].start).toBeCloseTo(230.5, 0);
    expect(parts[2].end).toBe(r.duration);
  });

  it("keeps short pauses and short parts within the song", () => {
    const r = recording([
      { seconds: 100, music: true },
      { seconds: 3, music: false },
      { seconds: 100, music: true },
      { seconds: 8, music: false },
      { seconds: 20, music: true },
    ]);
    expect(splitAtBreaks(r.noChord, r.level, FT, r.duration)).toHaveLength(1);
  });

  it("merges neighbours in the same key and tempo", () => {
    const key = { tonic: 0, mode: "major" as const };
    const merged = mergeSimilar([
      { start: 0, end: 100, key, bpm: 120 },
      { start: 100, end: 200, key, bpm: 61 },
      { start: 200, end: 300, key: { tonic: 2, mode: "minor" as const }, bpm: 120 },
    ]);
    expect(merged.map((p) => [p.start, p.end])).toEqual([
      [0, 200],
      [200, 300],
    ]);
    expect(sameTempo(120, 124)).toBe(true);
    expect(sameTempo(120, 130)).toBe(false);
  });
});

describe("key changes", () => {
  /** Beat probabilities that strongly say one chord per bar, cycling I IV V I of `tonic` major. */
  const bars = (tonic: number, count: number) => {
    const out: Float64Array[] = [];
    const roots = [0, 5, 7, 0];
    for (let b = 0; b < count; b++) {
      for (let beat = 0; beat < 4; beat++) {
        const p = new Float64Array(STATES).fill(0.001);
        p[2 * ((tonic + roots[b % 4]) % 12)] = 1;
        out.push(p);
      }
    }
    return out;
  };

  it("finds a modulation that lasts", () => {
    const probs = [...bars(0, 40), ...bars(2, 24)];
    const times = probs.map((_, i) => i * 0.5);
    const changes = keyChanges(probs, 4, 0, times);
    expect(changes).toHaveLength(1);
    expect(changes[0].key).toEqual({ tonic: 2, mode: "major" });
    expect(Math.abs(changes[0].startBeat - 160)).toBeLessThanOrEqual(16);
  });

  it("ignores a short excursion", () => {
    const probs = [...bars(0, 24), ...bars(5, 4), ...bars(0, 24)];
    expect(keyChanges(probs, 4, 0, probs.map((_, i) => i * 0.5))).toEqual([]);
  });

  it("reports nothing for a song in one key", () => {
    const probs = bars(7, 64);
    expect(keyChanges(probs, 4, 0, probs.map((_, i) => i * 0.5))).toEqual([]);
  });
});
