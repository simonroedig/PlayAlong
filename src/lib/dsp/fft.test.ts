import { describe, expect, it } from "vitest";
import { FFT } from "./fft";

function naiveDft(re: Float64Array, im: Float64Array, inverse: boolean) {
  const n = re.length;
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  const sign = inverse ? 1 : -1;
  for (let k = 0; k < n; k++) {
    for (let t = 0; t < n; t++) {
      const a = (sign * 2 * Math.PI * k * t) / n;
      outRe[k] += re[t] * Math.cos(a) - im[t] * Math.sin(a);
      outIm[k] += re[t] * Math.sin(a) + im[t] * Math.cos(a);
    }
  }
  return { outRe, outIm };
}

describe("FFT", () => {
  it.each([2, 8, 64, 256])("matches a naive DFT (n = %i)", (n) => {
    const re = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.37) + (i % 3) * 0.1);
    const im = Float64Array.from({ length: n }, (_, i) => Math.cos(i * 1.3) * 0.5);
    for (const inverse of [false, true]) {
      const { outRe, outIm } = naiveDft(re, im, inverse);
      const r = re.slice();
      const i = im.slice();
      new FFT(n).transform(r, i, inverse);
      for (let k = 0; k < n; k++) {
        expect(r[k]).toBeCloseTo(outRe[k], 9);
        expect(i[k]).toBeCloseTo(outIm[k], 9);
      }
    }
  });

  it("round-trips forward + inverse", () => {
    const n = 4096;
    const fft = new FFT(n);
    const re = Float64Array.from({ length: n }, () => Math.random() - 0.5);
    const im = new Float64Array(n);
    const r = re.slice();
    fft.transform(r, im);
    fft.transform(r, im, true);
    for (let k = 0; k < n; k++) expect(r[k] / n).toBeCloseTo(re[k], 10);
  });

  it("rejects sizes that are not powers of two", () => {
    expect(() => new FFT(1000)).toThrow();
  });
});
