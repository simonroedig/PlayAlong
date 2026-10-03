/**
 * Zero-phase 2:1 decimation with a Kaiser-windowed half-band low-pass
 * (flat to ≈ 0.4·fs_out, stopband ≥ 80 dB beyond ≈ 0.55·fs_out), matching
 * the timing of librosa / soxr resampling (output sample n sits at input
 * sample 2n). Every other tap of a half-band filter is zero and skipped.
 */
const TAPS = 97;
const HALF = (TAPS - 1) / 2;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 50; k++) {
    term *= (x / (2 * k)) * (x / (2 * k));
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

const KERNEL = (() => {
  const cutoff = 0.25; // half-band: fraction of the input sample rate
  const beta = 8;
  const h = new Float64Array(TAPS);
  let sum = 0;
  for (let k = 0; k < TAPS; k++) {
    const n = k - HALF;
    // Even offsets of a half-band sinc are exactly zero (sin(πn/2) = 0); keep them exact.
    const sinc = n === 0 ? 2 * cutoff : n % 2 === 0 ? 0 : Math.sin(2 * Math.PI * cutoff * n) / (Math.PI * n);
    const r = n / HALF;
    const w = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / besselI0(beta);
    h[k] = sinc * w;
    sum += h[k];
  }
  for (let k = 0; k < TAPS; k++) h[k] /= sum;
  return h;
})();

/** Taps with a non-zero coefficient (the centre tap and odd offsets). */
const ACTIVE = Int32Array.from(Array.from({ length: TAPS }, (_, k) => k).filter((k) => KERNEL[k] !== 0));
const ACTIVE_COEF = Float64Array.from(ACTIVE, (k) => KERNEL[k]);

/** Halves the sample rate. `gain` scales the output (librosa's `scale=True` uses √2). */
export function decimate2(x: Float32Array, gain = 1): Float32Array {
  const n = x.length;
  const out = new Float32Array(Math.ceil(n / 2));
  const taps = ACTIVE.length;
  for (let i = 0; i < out.length; i++) {
    const base = 2 * i - HALF;
    let acc = 0;
    if (base >= 0 && base + TAPS <= n) {
      for (let j = 0; j < taps; j++) acc += ACTIVE_COEF[j] * x[base + ACTIVE[j]];
    } else {
      for (let j = 0; j < taps; j++) {
        const idx = base + ACTIVE[j];
        if (idx >= 0 && idx < n) acc += ACTIVE_COEF[j] * x[idx];
      }
    }
    out[i] = acc * gain;
  }
  return out;
}
