import { describe, expect, it } from "vitest";
import { dtw, mergePunctuations, medianFilterRows, type WordTiming } from "./alignment";
import { N_FRAMES, logMelChunk, melFilters, resample } from "./audio";
import { LogitFilters, splitSegments, timestampBegin } from "./decoding";
import { b64, testConfig, testTokenizer } from "./test-fixtures";
import { WhisperTokenizer } from "./tokenizer";

describe("Whisper audio front end", () => {
  it("builds Slaney Mel filters covering 0–8 kHz", () => {
    const filters = melFilters(128);
    expect(filters).toHaveLength(128);
    expect(filters[0].length).toBe(201);
    // each filter is a triangle with a single peak, ascending in frequency
    const peaks = filters.map((f) => f.indexOf(Math.max(...f)));
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]).toBeGreaterThanOrEqual(peaks[i - 1]);
  });

  it("puts a 1 kHz tone into the right Mel band and silence at the floor", () => {
    const sr = 16000;
    const tone = Float32Array.from({ length: sr * 2 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sr));
    const mel = logMelChunk(tone, 80);
    const t = 50;
    let best = 0;
    for (let m = 1; m < 80; m++) if (mel[m * N_FRAMES + t] > mel[best * N_FRAMES + t]) best = m;
    const filters = melFilters(80);
    // the band whose filter peaks closest to 1 kHz (bin 25)
    const expected = filters.reduce((acc, f, m) => (f[25] > filters[acc][25] ? m : acc), 0);
    expect(Math.abs(best - expected)).toBeLessThanOrEqual(1);
    // after the tone ends (2 s → frame 200) only the floor (max − 8, scaled) remains
    let max = -Infinity;
    for (const v of mel) max = Math.max(max, v);
    expect(mel[10 * N_FRAMES + 2500]).toBeCloseTo(max - 2, 5);
    expect(logMelChunk(new Float32Array(1000), 80)[0]).toBeCloseTo(-1.5, 6);
  });

  it("resamples 44.1 kHz to 16 kHz keeping the passband", () => {
    const x = Float32Array.from({ length: 44100 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 44100));
    const y = resample(x, 44100, 16000);
    expect(y.length).toBe(16000);
    let peak = 0;
    for (let i = 1000; i < 15000; i++) peak = Math.max(peak, Math.abs(y[i]));
    expect(peak).toBeGreaterThan(0.98);
    expect(peak).toBeLessThan(1.02);
  });
});

describe("tokenizer", () => {
  const tok = testTokenizer({ 1: " Hallo", 2: " Welt", 3: "!", 4: "\xc3", 5: "\xbc", 6: "ber", 7: " gr" });
  it("decodes byte-level tokens, including characters split across tokens", () => {
    expect(tok.decode([1, 2, 3])).toBe(" Hallo Welt!");
    // "ü" is two bytes in two tokens
    const bytes = new Uint8Array([0xc3, 0xbc]);
    const t2 = new WhisperTokenizer(`${btoa(String.fromCharCode(bytes[0]))} 4\n${btoa(String.fromCharCode(bytes[1]))} 5\n${b64("ber")} 6\n${b64(" gr")} 7`, testConfig.eot);
    expect(t2.decode([7, 4, 5, 6])).toBe(" grüber");
    const { words, tokens } = t2.splitToWordTokens([7, 4, 5, 6, testConfig.eot], "de");
    expect(words).toEqual([" grüber", ""]);
    expect(tokens).toEqual([[7, 4, 5, 6], [testConfig.eot]]);
  });

  it("splits words at spaces and punctuation", () => {
    const { words } = tok.splitToWordTokens([1, 2, 3, testConfig.eot], "de");
    expect(words).toEqual([" Hallo", " Welt", "!", ""]);
  });
});

describe("decoding rules", () => {
  const cfg = testConfig;
  const ts = timestampBegin(cfg);
  const sot = [cfg.sot, cfg.languageTokens[1], cfg.transcribe];
  const fresh = () => new Float32Array(cfg.nVocab);

  it("starts with a timestamp of at most 1 s", () => {
    const logits = fresh();
    logits[100] = 50; // text would win without the rules
    new LogitFilters(cfg, 3).apply(logits, sot);
    expect(logits[100]).toBe(-Infinity);
    expect(logits[ts]).toBe(0);
    expect(logits[ts + 50]).toBe(0);
    expect(logits[ts + 51]).toBe(-Infinity);
    expect(logits[cfg.eot]).toBe(-Infinity);
  });

  it("pairs timestamps and keeps them increasing", () => {
    const filters = new LogitFilters(cfg, 3);
    // after "<|1.00|> text <|2.00|>": a closing timestamp must be followed by another one (or end)
    let logits = fresh();
    logits[100] = 5;
    filters.apply(logits, [...sot, ts + 50, 100, ts + 100]);
    expect(logits[100]).toBe(-Infinity);
    expect(logits[ts + 99]).toBe(-Infinity);
    expect(logits[ts + 100]).not.toBe(-Infinity);
    // after a pair of timestamps, text must follow
    logits = fresh();
    filters.apply(logits, [...sot, ts + 50, 100, ts + 100, ts + 100]);
    expect(logits[ts + 120]).toBe(-Infinity);
    expect(logits[100]).not.toBe(-Infinity);
    // suppressed tokens never appear
    expect(logits[cfg.transcribe]).toBe(-Infinity);
    expect(logits[7]).toBe(-Infinity);
  });

  it("splits a decoded window into segments and reports how far it got", () => {
    const toks = [ts, 1, 2, ts + 75, ts + 75, 3, ts + 150];
    const { segments, consumed } = splitSegments(cfg, toks, 30);
    expect(segments.map((s) => [s.start, s.end])).toEqual([
      [0, 1.5],
      [1.5, 3],
    ]);
    expect(consumed).toBe(30); // ends with a single timestamp: the window is done
    const open = splitSegments(cfg, [ts, 1, ts + 75, ts + 75, 3], 30);
    expect(open.segments).toHaveLength(1);
    expect(open.consumed).toBe(1.5); // unfinished segment: continue from 1.5 s
  });
});

describe("alignment", () => {
  it("finds the diagonal path through a cost matrix", () => {
    const n = 3;
    const m = 6;
    const cost = new Float32Array(n * m).fill(1);
    [
      [0, 0],
      [0, 1],
      [1, 2],
      [1, 3],
      [2, 4],
      [2, 5],
    ].forEach(([i, j]) => (cost[i * m + j] = -1));
    const { textIndices, timeIndices } = dtw(cost, n, m);
    expect(Array.from(textIndices)).toEqual([0, 0, 1, 1, 2, 2]);
    expect(Array.from(timeIndices)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("median-filters rows with reflected edges (as numpy / torch 'reflect')", () => {
    const x = Float32Array.from([1, 9, 1, 1, 1, 5, 5, 5]);
    // index 0 sees [x1, x0, x1] = [9, 1, 9]
    expect(Array.from(medianFilterRows(x, 1, 8, 3))).toEqual([9, 1, 1, 1, 1, 5, 5, 5]);
  });

  it("attaches punctuation to its word", () => {
    const w = (word: string, start: number): WordTiming => ({ word, tokens: [start], start, end: start + 1, probability: 1 });
    const merged = mergePunctuations([w(" Hallo", 0), w(",", 1), w(" Welt", 2), w("!", 3), w(' "', 4), w("Ja", 5)]);
    expect(merged.map((x) => x.word)).toEqual([" Hallo,", " Welt!", ' "Ja']);
  });
});
