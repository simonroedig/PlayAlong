import { describe, expect, it } from "vitest";
import { applyPreset, defaultMixer, effectiveGains, matchPreset, normalizeMixer, setVocals, stemIndex, vocalsOn } from "./mixer";

const g = stemIndex("guitar");
const b = stemIndex("bass");
const v = stemIndex("vocals");

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
    const m = applyPreset({ ...defaultMixer(), volumes: [1, 0.5, 1, 1, 1, 1] }, "bass-only", false);
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

  it("switches the vocals on top of any practice mode", () => {
    const noGuitar = setVocals(applyPreset(defaultMixer(), "no-guitar"), false);
    expect(effectiveGains(noGuitar)[v]).toBe(0);
    expect(effectiveGains(noGuitar)[g]).toBe(0);
    expect(matchPreset(noGuitar)).toBe("no-guitar");
    // the switch survives a change of mode
    const bassOnly = applyPreset(noGuitar, "bass-only");
    expect(vocalsOn(bassOnly)).toBe(false);
    expect(effectiveGains(bassOnly).filter((x) => x > 0)).toHaveLength(1);
    const withVoice = setVocals(bassOnly, true);
    expect(effectiveGains(withVoice)[v]).toBe(1);
    expect(effectiveGains(withVoice)[b]).toBe(1);
    expect(matchPreset(withVoice)).toBe("bass-only");
  });

  it("the full mix always brings the vocals back", () => {
    const quiet = setVocals(applyPreset(defaultMixer(), "no-bass"), false);
    const full = applyPreset(quiet, "full");
    expect(effectiveGains(full)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(matchPreset(full)).toBe("full");
    // muting the vocals in the full mix leaves the full-mix mode
    expect(matchPreset(setVocals(full, false))).toBeNull();
    expect(vocalsOn(setVocals(full, false))).toBe(false);
  });

  it("recovers from missing or malformed stored settings", () => {
    expect(normalizeMixer(undefined)).toEqual(defaultMixer());
    expect(normalizeMixer({ volumes: [1], muted: [], solo: [], master: 1 })).toEqual(defaultMixer());
  });
});
