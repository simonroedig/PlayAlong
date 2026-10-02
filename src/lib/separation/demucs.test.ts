import { describe, expect, it } from "vitest";
import { segmentOffsets, separate, transitionWeight, type ModelRunner } from "./demucs";
import { BINS, FRAMES, SEGMENT, SOURCES } from "./model";
import { DemucsSpectrogram } from "./spectrogram";

const S = SOURCES.length;
/** Samples at segment borders that the dropped STFT frames affect. */
const EDGE = 2048;

function signal(length: number, seed: number) {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    left[i] = 0.4 * Math.sin(i * 0.0123 * seed) + 0.2 * Math.sin(i * 0.31) + 0.05;
    right[i] = 0.3 * Math.cos(i * 0.0071 * seed) - 0.1 * Math.sin(i * 0.77);
  }
  return { left, right };
}

describe("DemucsSpectrogram", () => {
  // HTDemucs drops the two outermost STFT frames on each side, so even the
  // reference _ispec(_spec(x)) only reconstructs the inside of a segment.
  // (Parity with PyTorch is checked separately against reference outputs.)
  it("inverse(forward(x)) reconstructs the segment away from its edges", () => {
    const spec = new DemucsSpectrogram(SEGMENT);
    expect(spec.frames).toBe(FRAMES);
    const { left, right } = signal(SEGMENT, 1);
    const z = new Float32Array(4 * BINS * FRAMES);
    spec.forward(left, right, z);
    const outL = new Float32Array(SEGMENT);
    const outR = new Float32Array(SEGMENT);
    spec.inverseAdd(z, 0, outL, outR);
    let maxErr = 0;
    for (let i = EDGE; i < SEGMENT - EDGE; i++) {
      maxErr = Math.max(maxErr, Math.abs(outL[i] - left[i]), Math.abs(outR[i] - right[i]));
    }
    expect(maxErr).toBeLessThan(1e-4);
  });
});

describe("segmenting", () => {
  it("uses apply_model's stride and offsets", () => {
    expect(segmentOffsets(SEGMENT * 2)).toEqual([0, 257985, 515970]);
    expect(segmentOffsets(1000)).toEqual([0]);
  });

  it("builds a symmetric triangular weight peaking at 1", () => {
    const w = Array.from(transitionWeight(10));
    [1, 2, 3, 4, 5, 5, 4, 3, 2, 1].forEach((v, i) => expect(w[i]).toBeCloseTo(v / 5, 6));
  });
});

describe("separate", () => {
  /**
   * A fake model that returns the input mixture as source `target` through the
   * spectral branch and nothing elsewhere: the output must reproduce the
   * input, which exercises normalization, padding, trimming and overlap-add.
   */
  const passthrough =
    (target: number): ModelRunner =>
    async (mix, spec) => {
      const specOut = new Float32Array(S * spec.length);
      specOut.set(spec, target * spec.length);
      const timeOut = new Float32Array(S * mix.length);
      return { specOut, timeOut };
    };

  it.each([
    ["shorter than one segment", 100_000],
    ["several segments with a short tail", SEGMENT * 2 + 12345],
  ])("reconstructs the mix (%s)", async (_label, length) => {
    const { left, right } = signal(length, 3);
    const refL = left.slice();
    const refR = right.slice();
    const out = Array.from({ length: S * 2 }, () => new Float32Array(length));
    let progressCalls = 0;
    await separate(left, right, passthrough(4), {
      onProgress: () => progressCalls++,
      onBlock: (start, count, blocks) => blocks.forEach((b, i) => out[i].set(b.subarray(0, count), start)),
    });
    expect(progressCalls).toBe(segmentOffsets(length).length);
    // Segment borders are slightly attenuated (dropped STFT frames) and leak
    // into the cross-fade with a tiny weight; the very first border is not
    // covered by a neighbour at all. demucs.apply behaves identically.
    let signalPower = 0;
    let errorPower = 0;
    let maxErr = 0;
    for (let i = EDGE; i < length; i++) {
      const eL = out[8][i] - refL[i];
      const eR = out[9][i] - refR[i];
      signalPower += refL[i] ** 2 + refR[i] ** 2;
      errorPower += eL * eL + eR * eR;
      maxErr = Math.max(maxErr, Math.abs(eL), Math.abs(eR));
    }
    expect(10 * Math.log10(signalPower / errorPower)).toBeGreaterThan(60);
    expect(maxErr).toBeLessThan(5e-3);
    // Other sources only carry the de-normalization offset (the mean).
    const mean = refL.reduce((a, v, i) => a + (v + refR[i]) / 2, 0) / length;
    expect(Math.abs(out[0][1234] - mean)).toBeLessThan(1e-5);
  });

  it("emits every sample exactly once, in order", async () => {
    const length = SEGMENT + 5000;
    const { left, right } = signal(length, 2);
    const seen: [number, number][] = [];
    await separate(left, right, passthrough(0), {
      onBlock: (start, count) => seen.push([start, count]),
    });
    let next = 0;
    for (const [start, count] of seen) {
      expect(start).toBe(next);
      next += count;
    }
    expect(next).toBe(length);
  });

  it("stops when aborted", async () => {
    const { left, right } = signal(SEGMENT * 3, 1);
    const controller = new AbortController();
    const run = separate(left, right, passthrough(0), {
      signal: controller.signal,
      onProgress: () => controller.abort(),
      onBlock: () => {},
    });
    await expect(run).rejects.toThrow(/cancelled/);
  });
});
