import { describe, expect, it } from "vitest";
import { estimateTempo, extendBeats, normalizeOnsets, onsetEnvelope, trackBeatFrames } from "./beats";
import { cqtMagnitude } from "./cqt";
import { decimate2 } from "./resample";
import { estimateTuningCents } from "./tuning";

const C1 = 32.70319566257483;

function tone(sr: number, seconds: number, freqs: number[], amp = 0.2): Float32Array {
  const out = new Float32Array(Math.round(sr * seconds));
  for (const f of freqs) {
    for (let h = 1; h <= 4; h++) {
      const a = amp / h;
      for (let i = 0; i < out.length; i++) out[i] += a * Math.sin((2 * Math.PI * f * h * i) / sr);
    }
  }
  return out;
}

function rms(x: Float32Array, from = 0, to = x.length) {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / (to - from));
}

describe("decimate2", () => {
  it("keeps the passband and timing, and removes what would alias", () => {
    const sr = 44100;
    const n = sr;
    const low = new Float32Array(n);
    const high = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      low[i] = Math.sin((2 * Math.PI * 1000 * i) / sr);
      high[i] = Math.sin((2 * Math.PI * 15000 * i) / sr);
    }
    const lowOut = decimate2(low);
    const highOut = decimate2(high);
    expect(lowOut.length).toBe(n / 2);
    expect(rms(lowOut, 100, n / 2 - 100)).toBeCloseTo(Math.SQRT1_2, 2);
    expect(rms(highOut, 100, n / 2 - 100)).toBeLessThan(1e-3);
    // Zero phase: output sample k sits at input sample 2k.
    for (const k of [1000, 5000, 9000]) expect(lowOut[k]).toBeCloseTo(low[2 * k], 2);
  });
});

describe("cqtMagnitude", () => {
  it("puts a note in its bin (24 bins per octave from C1)", () => {
    const sr = 22050;
    const a4 = tone(sr, 2, [440]);
    const { data, frames, nBins } = cqtMagnitude(a4, { sr, hop: 2048, fmin: C1, nBins: 144, binsPerOctave: 24 });
    expect(nBins).toBe(144);
    expect(frames).toBe(1 + Math.floor(a4.length / 2048));
    const t = Math.floor(frames / 2);
    let best = 0;
    for (let b = 0; b < nBins; b++) if (data[t * nBins + b] > data[t * nBins + best]) best = b;
    // A4 is 45 semitones above C1.
    expect(best).toBe(90);
  });
});

describe("estimateTuningCents", () => {
  it("measures how far a recording is from A = 440 Hz", () => {
    const sr = 22050;
    for (const cents of [0, 30, -25]) {
      const k = 2 ** (cents / 1200);
      const y = tone(sr, 6, [220 * k, 277.18 * k, 329.63 * k]);
      expect(Math.abs(estimateTuningCents(y, sr) - cents)).toBeLessThan(4);
    }
  });
});

describe("beat tracking", () => {
  it("finds tempo and beats of a click track", () => {
    const sr = 22050;
    const bpm = 100;
    const period = 60 / bpm;
    const y = new Float32Array(sr * 20);
    const clicks: number[] = [];
    for (let t = 0.5; t < 19.5; t += period) {
      clicks.push(t);
      const start = Math.round(t * sr);
      for (let i = 0; i < 400; i++) y[start + i] += Math.exp(-i / 60) * Math.sin(i * 0.9) * 0.8;
    }
    const env = onsetEnvelope(y, sr);
    const normalized = normalizeOnsets(env.values, env.fps);
    const tempo = estimateTempo(normalized, env.fps);
    expect(Math.abs(tempo - bpm)).toBeLessThan(2);
    const beats = trackBeatFrames(normalized, env.fps, tempo).map((f) => f / env.fps);
    expect(beats.length).toBeGreaterThan(clicks.length - 4);
    for (const b of beats) {
      const nearest = Math.min(...clicks.map((c) => Math.abs(c - b)));
      expect(nearest).toBeLessThan(0.03);
    }
  });

  it("extends a beat grid to cover the whole song", () => {
    const beats = extendBeats([1, 1.5, 2, 2.5, 3], 4.2, 0.5);
    expect(beats[0]).toBeLessThan(0.5);
    expect(beats[beats.length - 1]).toBeGreaterThan(3.6);
    for (let i = 1; i < beats.length; i++) expect(beats[i] - beats[i - 1]).toBeCloseTo(0.5, 6);
  });
});
