import { describe, expect, it } from "vitest";
import type { ChordAnalysis, ChordSegment } from "./analyze";
import { beatInBar, chordBars, chordIndexAt, displayChords, referencePitch, shapeShift } from "./sheet";
import { chordLabel } from "./vocabulary";

/** Consecutive segments; `length` in beats (default one 4/4 bar). */
function analysis(segments: (Partial<ChordSegment> & { length?: number })[], extra: Partial<ChordAnalysis> = {}): ChordAnalysis {
  const beats = Array.from({ length: 16 }, (_, i) => 0.5 + i * 0.5);
  let beat = 0;
  return {
    version: 1,
    bpm: 120,
    beats,
    beatsPerBar: 4,
    downbeat: 0,
    key: { tonic: 7, mode: "major" },
    tuningCents: 0,
    segments: segments.map(({ length = 4, ...s }) => {
      const startBeat = beat;
      const endBeat = beat + length;
      beat = endBeat;
      return {
        root: 7,
        quality: "maj",
        bass: null,
        confidence: 0.9,
        ...s,
        start: beats[startBeat],
        end: endBeat < beats.length ? beats[endBeat] : 8.5,
        startBeat,
        endBeat,
      } as ChordSegment;
    }),
    ...extra,
  };
}

describe("chord labels", () => {
  it("names chords for guitarists", () => {
    expect(chordLabel({ root: 6, quality: "min7", bass: null })).toBe("F♯m7");
    expect(chordLabel({ root: 10, quality: "maj", bass: null }, { spelling: "flat" })).toBe("B♭");
    expect(chordLabel({ root: 11, quality: "hdim7", bass: null })).toBe("Bm7♭5");
    expect(chordLabel({ root: 0, quality: "maj7", bass: 4 }, { simple: true })).toBe("C");
    expect(chordLabel({ root: null, quality: "maj", bass: null })).toBe("N.C.");
  });
});

describe("display chords", () => {
  it("transposes to capo / down-tuned shapes", () => {
    expect(shapeShift({ simple: false, capo: 2, tuneDown: 0 })).toBe(-2);
    expect(shapeShift({ simple: false, capo: 0, tuneDown: 1 })).toBe(1);
    const a = analysis([{ root: 7 }, { root: 2, bass: 6 }]);
    expect(displayChords(a, { simple: false, capo: 0, tuneDown: 0 }).map((c) => c.label)).toEqual(["G", "D/F♯"]);
    // Capo 2: G sounds from an F shape, D/F♯ from C/E.
    expect(displayChords(a, { simple: false, capo: 2, tuneDown: 0 }).map((c) => c.label)).toEqual(["F", "C/E"]);
  });

  it("merges chords that look the same in simple mode and flags uncertain ones", () => {
    const a = analysis([
      { root: 0, quality: "maj", confidence: 0.9 },
      { root: 0, quality: "maj7", confidence: 0.3 },
      { root: 9, quality: "min", confidence: 0.3 },
    ]);
    const simple = displayChords(a, { simple: true, capo: 0, tuneDown: 0 });
    expect(simple.map((c) => c.label)).toEqual(["C", "Am"]);
    expect(simple[0].endBeat).toBe(8);
    expect(simple[0].uncertain).toBe(false);
    expect(simple[1].uncertain).toBe(true);
    expect(displayChords(a, { simple: false, capo: 0, tuneDown: 0 }).map((c) => c.label)).toEqual(["C", "Cmaj7", "Am"]);
  });

  it("finds the chord and beat under the playhead", () => {
    const a = analysis([{ root: 7 }, { root: 0 }, { root: 2 }]);
    const chords = displayChords(a, { simple: false, capo: 0, tuneDown: 0 });
    expect(chordIndexAt(chords, 0.2)).toBe(-1);
    expect(chordIndexAt(chords, 0.5)).toBe(0);
    expect(chordIndexAt(chords, 2.6)).toBe(1);
    expect(chordIndexAt(chords, 99)).toBe(2);
    expect(beatInBar(a, 5)).toBe(1);
  });
});

describe("chordBars", () => {
  it("lays chords out in bars, with a pick-up bar before the first downbeat", () => {
    const a = analysis(
      [
        { root: null, length: 1 },
        { root: 7, length: 4 },
        { root: 0, length: 2 },
        { root: 2, length: 2 },
      ],
      { downbeat: 1 },
    );
    const chords = displayChords(a, { simple: false, capo: 0, tuneDown: 0 });
    const bars = chordBars(a, chords, 8.5);
    expect(bars[0]).toMatchObject({ number: 0, beats: 1 });
    expect(bars[0].cells.map((c) => c.label)).toEqual(["N.C."]);
    expect(bars[1]).toMatchObject({ number: 1, beats: 4, start: 1 });
    expect(bars[1].cells.map((c) => c.label)).toEqual(["G"]);
    expect(bars[2].cells.map((c) => [c.label, c.offset, c.beats])).toEqual([
      ["C", 0, 2],
      ["D", 2, 2],
    ]);
  });
});

describe("referencePitch", () => {
  it("converts the detected tuning to an A4 reference", () => {
    expect(referencePitch(0)).toBe(440);
    expect(referencePitch(-43)).toBe(429);
    expect(referencePitch(38)).toBe(450);
  });
});
