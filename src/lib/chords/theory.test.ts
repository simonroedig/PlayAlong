import { describe, expect, it } from "vitest";
import { circleNames, circlePlace, diatonicOnCircle, keySignature, MODES, modeDegrees, modeSteps } from "./theory";

const mode = (name: string) => MODES.find((m) => m.name === name)!;

describe("circle of fifths", () => {
  it("places keys and their signatures", () => {
    expect(circlePlace({ tonic: 7, mode: "major" })).toBe(1);
    expect(circlePlace({ tonic: 9, mode: "minor" })).toBe(0);
    expect(circleNames(3)).toEqual({ major: "A", minor: "F♯m" });
    expect(keySignature(2)).toEqual({ count: 2, accidental: "♯" });
    expect(keySignature(10)).toEqual({ count: 2, accidental: "♭" });
  });

  it("finds a key's chords around it", () => {
    const c = diatonicOnCircle({ tonic: 0, mode: "major" }).map((d) => `${d.numeral}:${d.root}`);
    expect(c).toEqual(["I:0", "IV:5", "V:7", "vi:9", "ii:2", "iii:4", "vii°:11"]);
    const am = diatonicOnCircle({ tonic: 9, mode: "minor" }).map((d) => `${d.numeral}:${d.root}`);
    expect(am).toEqual(["♭III:0", "♭VI:5", "♭VII:7", "i:9", "iv:2", "v:4", "ii°:11"]);
  });
});

describe("modes", () => {
  it("has the steps of each mode", () => {
    const show = (name: string) => modeSteps(mode(name)).map((s) => (s === 2 ? "W" : "H")).join("");
    expect(show("Ionian")).toBe("WWHWWWH");
    expect(show("Dorian")).toBe("WHWWWHW");
    expect(show("Aeolian")).toBe("WHWWHWW");
    expect(show("Lydian")).toBe("WWWHWWH");
  });

  it("names the notes, degrees and chords", () => {
    const d = modeDegrees(2, mode("Dorian")); // D Dorian: the notes of C major
    expect(d.map((x) => x.note)).toEqual(["D", "E", "F", "G", "A", "B", "C"]);
    expect(d.map((x) => x.degree)).toEqual(["1", "2", "♭3", "4", "5", "6", "♭7"]);
    expect(d.map((x) => x.numeral)).toEqual(["i", "ii", "♭III", "IV", "v", "vi°", "♭VII"]);
    const a = modeDegrees(9, mode("Aeolian"));
    expect(a.map((x) => x.chord)).toEqual(["Am", "B°", "C", "Dm", "Em", "F", "G"]);
    expect(modeDegrees(5, mode("Lydian")).map((x) => x.degree)[3]).toBe("♯4");
  });
});
