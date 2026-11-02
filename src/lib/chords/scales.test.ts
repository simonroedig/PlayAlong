import { describe, expect, it } from "vitest";
import { keyPosition, minorRootPosition, positionSpan, scaleNeck, scalePosition } from "./scales";
import type { Key } from "./vocabulary";

const Am: Key = { tonic: 9, mode: "minor" };
const C: Key = { tonic: 0, mode: "major" };
/** Frets per string, lowest string first. */
const shape = (notes: ReturnType<typeof scalePosition>, strings = 6) =>
  Array.from({ length: strings }, (_, s) => notes.filter((n) => n.string === s).map((n) => n.fret));

describe("scale positions", () => {
  it("builds the five A minor pentatonic boxes", () => {
    expect(shape(scalePosition(Am, "pentatonic", "guitar", 0))).toEqual([[5, 8], [5, 7], [5, 7], [5, 7], [5, 8], [5, 8]]);
    expect(shape(scalePosition(Am, "pentatonic", "guitar", 1))).toEqual([[8, 10], [7, 10], [7, 10], [7, 9], [8, 10], [8, 10]]);
    expect(shape(scalePosition(Am, "pentatonic", "guitar", 2))).toEqual([[10, 12], [10, 12], [10, 12], [9, 12], [10, 13], [10, 12]]);
    expect(shape(scalePosition(Am, "pentatonic", "guitar", 3))).toEqual([[12, 15], [12, 15], [12, 14], [12, 14], [13, 15], [12, 15]]);
    // The fifth box sits below the first one.
    expect(shape(scalePosition(Am, "pentatonic", "guitar", 4))).toEqual([[3, 5], [3, 5], [2, 5], [2, 5], [3, 5], [3, 5]]);
  });

  it("fills in the full scale within the hand position", () => {
    const am = scalePosition(Am, "scale", "guitar", 0);
    expect(shape(am)).toEqual([[5, 7, 8], [5, 7, 8], [5, 7, 9], [5, 7], [5, 6, 8], [5, 7, 8]]);
    expect(positionSpan(am)).toEqual([5, 9]);
    const c = scalePosition(C, "scale", "guitar", 0);
    expect(shape(c)).toEqual([[7, 8, 10], [7, 8, 10], [7, 9, 10], [7, 9, 10], [8, 10], [7, 8, 10]]);
  });

  it("puts a major key's position 5 on its relative minor's position 1", () => {
    const g = { tonic: 7, mode: "major" as const };
    const em = { tonic: 4, mode: "minor" as const };
    expect(shape(scalePosition(g, "pentatonic", "guitar", 4))).toEqual(shape(scalePosition(em, "pentatonic", "guitar", 0)));
    expect(shape(scalePosition(C, "pentatonic", "guitar", 4))).toEqual(shape(scalePosition(Am, "pentatonic", "guitar", 0)));
    expect(keyPosition(0, "major")).toBe(4);
    expect(minorRootPosition(4, "major")).toBe(0);
    expect(keyPosition(2, "minor")).toBe(2);
  });

  it("adds the blue note", () => {
    const blues = scalePosition(Am, "blues", "guitar", 0);
    expect(blues.filter((n) => n.degree === 6).map((n) => [n.string, n.fret])).toEqual([
      [1, 6],
      [3, 8],
    ]);
  });

  it("works on a four-string bass", () => {
    expect(shape(scalePosition(Am, "pentatonic", "bass", 0), 4)).toEqual([[5, 8], [5, 7], [5, 7], [5, 7]]);
  });

  it("lists every scale note on the neck", () => {
    const neck = scaleNeck(Am, "pentatonic", "guitar", 12);
    expect(neck.filter((n) => n.string === 0).map((n) => n.fret)).toEqual([0, 3, 5, 8, 10, 12]);
    expect(neck.every((n) => [0, 3, 5, 7, 10].includes(n.degree))).toBe(true);
  });
});
