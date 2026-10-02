import { describe, expect, it } from "vitest";
import { applyPreset, defaultMixer, effectiveGains, matchPreset, normalizeMixer, stemIndex } from "./mixer";

const g = stemIndex("guitar");
const b = stemIndex("bass");

describe("mixer", () => {
  it("full mix plays everything at unity", () => {
    expect(effectiveGains(defaultMixer())).toEqual([1, 1, 1, 1, 1, 1]);
    expect(matchPreset(defaultMixer())).toBe("full");
  });

  it("'No guitar' silences only the guitar", () => {
    const m = applyPreset(defaultMixer(), "no-guitar");
    const gains = effectiveGains(m);
    expect(gains[g]).toBe(0);
    expect(gains.filter((v) => v === 0)).toHaveLength(1);
    expect(matchPreset(m)).toBe("no-guitar");
  });

  it("'Bass only' solos the bass and keeps its volume", () => {
    const m = applyPreset({ ...defaultMixer(), volumes: [1, 0.5, 1, 1, 1, 1] }, "bass-only");
    const gains = effectiveGains(m);
    expect(gains[b]).toBe(0.5);
    expect(gains.reduce((a, v) => a + v, 0)).toBe(0.5);
    expect(matchPreset(m)).toBe("bass-only");
  });

  it("applies the master volume", () => {
    const m = { ...defaultMixer(), master: 0.5 };
    expect(effectiveGains(m)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
  });

  it("reports a custom mix when no preset matches", () => {
    const m = applyPreset(defaultMixer(), "no-guitar");
    m.muted[b] = true;
    expect(matchPreset(m)).toBeNull();
  });

  it("recovers from missing or malformed stored settings", () => {
    expect(normalizeMixer(undefined)).toEqual(defaultMixer());
    expect(normalizeMixer({ volumes: [1], muted: [], solo: [], master: 1 })).toEqual(defaultMixer());
  });
});
