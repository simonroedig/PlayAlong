import { describe, expect, it } from "vitest";
import { STATES, estimateKey, keyPrior, refineQuality, repetitionSmoothing, slashBass, viterbi } from "./decode";
import { LARGE_CLASSES, QUALITIES, chordLabel, keyName, type Quality } from "./vocabulary";

const C = 0;
const F = 5;
const G = 7;
const A = 9;
const maj = (root: number) => 2 * root;
const min = (root: number) => 2 * root + 1;

/** A beat distribution that favours `state` with probability p. */
function beat(state: number, p = 0.7): Float64Array {
  const v = new Float64Array(STATES).fill((1 - p) / (STATES - 1));
  v[state] = p;
  return v;
}

describe("viterbi", () => {
  const options = { changeProbability: [0.5, 0.04, 0.16, 0.04], downbeat: 0, prior: keyPrior(null) };

  it("follows clear chords bar by bar", () => {
    const chords = [maj(C), min(A), maj(F), maj(G)];
    const beats = chords.flatMap((s) => [beat(s), beat(s), beat(s), beat(s)]);
    expect(viterbi(beats, options)).toEqual(chords.flatMap((s) => [s, s, s, s]));
  });

  it("ignores a one-beat blip in the middle of a bar", () => {
    const beats = [beat(maj(C)), beat(maj(C)), beat(maj(G), 0.6), beat(maj(C)), beat(maj(C)), beat(maj(C)), beat(maj(C)), beat(maj(C))];
    expect(new Set(viterbi(beats, options))).toEqual(new Set([maj(C)]));
  });

  it("moves an early change to the bar line", () => {
    // The new chord is pushed an eighth early, so the last beat of the bar is half C, half F.
    const pushed = beat(maj(F), 0.5);
    pushed[maj(C)] = 0.4;
    const beats = [beat(maj(C)), beat(maj(C)), beat(maj(C)), pushed, beat(maj(F)), beat(maj(F)), beat(maj(F)), beat(maj(F))];
    const path = viterbi(beats, options);
    expect(path.slice(0, 4)).toEqual([maj(C), maj(C), maj(C), maj(C)]);
    expect(path.slice(4)).toEqual([maj(F), maj(F), maj(F), maj(F)]);
  });

  it("allows half-bar changes when the evidence is clear", () => {
    const beats = [beat(maj(C), 0.9), beat(maj(C), 0.9), beat(maj(G), 0.9), beat(maj(G), 0.9)];
    expect(viterbi(beats, options)).toEqual([maj(C), maj(C), maj(G), maj(G)]);
  });
});

describe("repetitionSmoothing", () => {
  it("lets repeated passages outvote a wrong chord", () => {
    const pattern = [maj(C), maj(C), maj(C), maj(C), maj(G), maj(G), maj(G), maj(G)];
    const beats: Float64Array[] = [];
    for (let rep = 0; rep < 4; rep++) for (const s of pattern) beats.push(beat(s, 0.8));
    // One repetition hears the G bar wrongly as E minor.
    for (let i = 4; i < 8; i++) {
      beats[8 + i] = beat(min(4), 0.45);
      beats[8 + i][maj(G)] = 0.35;
    }
    const smoothed = repetitionSmoothing(beats, 4, { threshold: 0.5 });
    for (let i = 12; i < 16; i++) {
      const best = smoothed[i].indexOf(Math.max(...smoothed[i]));
      expect(best).toBe(maj(G));
    }
  });
});

describe("keys", () => {
  it("recognises major keys and their relative minor", () => {
    const histogram = (counts: [number, number][]) => {
      const h = new Float64Array(STATES);
      for (const [s, n] of counts) h[s] = n;
      return h;
    };
    expect(estimateKey(histogram([[maj(G), 10], [maj(C), 6], [maj(2), 6], [min(4), 3]]))).toEqual({ tonic: G, mode: "major" });
    expect(estimateKey(histogram([[min(A), 12], [maj(F), 5], [maj(C), 4], [maj(G), 4]]))).toEqual({ tonic: A, mode: "minor" });
    expect(keyName({ tonic: 3, mode: "major" })).toBe("E♭");
    expect(keyName({ tonic: 6, mode: "minor" })).toBe("F♯m");
  });
});

describe("refinements", () => {
  const large = (entries: [number, Quality, number][]) => {
    const v = new Float64Array(LARGE_CLASSES);
    for (const [root, q, p] of entries) v[root * 14 + QUALITIES.indexOf(q)] = p;
    return v;
  };

  it("adds a 7th only when the large model clearly hears it", () => {
    expect(refineQuality(G, false, large([[G, "maj", 0.3], [G, "7", 0.65]]), 0.5, 2)).toBe("7");
    expect(refineQuality(G, false, large([[G, "maj", 0.45], [G, "7", 0.5]]), 0.5, 2)).toBe("maj");
    expect(refineQuality(A, true, large([[A, "min", 0.2], [A, "min7", 0.7]]), 0.5, 2)).toBe("min7");
  });

  it("only writes slash chords for a dominant, sustained chord tone in the bass", () => {
    const hist = (pc: number, share: number) => {
      const h = new Float64Array(12).fill((1 - share) / 11);
      h[pc] = share;
      return h;
    };
    expect(slashBass(C, "maj", hist(4, 0.8))).toBe(4); // C/E
    expect(slashBass(C, "maj", hist(2, 0.8))).toBeNull(); // D is not in C major
    expect(slashBass(C, "maj", hist(4, 0.4))).toBeNull(); // passing note
    expect(slashBass(C, "maj", hist(0, 0.9))).toBeNull(); // root position
    expect(chordLabel({ root: G, quality: "maj", bass: 11 })).toBe("G/B");
  });
});
