import { describe, expect, it } from "vitest";
import { INTERVALS, QUALITIES, type Quality } from "./vocabulary";
import { voicingNotes, voicingsFor } from "./voicings";

describe("chord voicings", () => {
  it("only play notes of the chord, with the root in the bass, for every root and quality", () => {
    for (const quality of QUALITIES) {
      const intervals = INTERVALS[quality as Quality];
      // Four-note chords may leave out the 5th (jazz voicings); triads need all three notes.
      const required = intervals.length > 3 ? intervals.filter((i) => i !== 7) : intervals;
      for (let root = 0; root < 12; root++) {
        const voicings = voicingsFor(root, quality);
        expect(voicings.length, `${root} ${quality}`).toBeGreaterThan(0);
        for (const v of voicings) {
          const where = `${root} ${quality} ${v.name} ${v.frets.join(" ")}`;
          const notes = voicingNotes(v.frets).map((pc) => (pc - root + 12) % 12);
          expect(notes[0], `bass of ${where}`).toBe(0);
          for (const n of notes) expect(intervals, `extra note ${n} in ${where}`).toContain(n);
          for (const r of required) expect(notes, `missing ${r} in ${where}`).toContain(r);
          expect(v.frets).toHaveLength(6);
          const played = v.frets.filter((f): f is number => f !== null);
          expect(Math.min(...played), where).toBeGreaterThanOrEqual(0);
          expect(Math.max(...played) - Math.min(...played.filter((f) => f > 0).concat([Math.max(...played)])), `stretch ${where}`).toBeLessThanOrEqual(4);
        }
      }
    }
  });

  it("recommends open chords for simple chords and jazz voicings for 7th chords", () => {
    expect(voicingsFor(0, "maj")[0]).toMatchObject({ name: "Open", frets: [null, 3, 2, 0, 1, 0] });
    expect(voicingsFor(9, "min")[0]).toMatchObject({ name: "Open", frets: [null, 0, 2, 2, 1, 0] });
    expect(voicingsFor(5, "maj")[0]).toMatchObject({ name: "Barre, root on 6th string", barre: 1 });
    expect(voicingsFor(11, "hdim7")[0].name).toMatch(/^Jazz/);
    expect(voicingsFor(2, "maj7")[0].name).toMatch(/^Jazz/);
  });
});
