import { FFT } from "../dsp/fft";

/**
 * Deviation of the recording from A = 440 Hz in cents (−50…+50), from the
 * magnitude-weighted circular histogram of spectral peak positions
 * (like librosa.estimate_tuning).
 */
export function estimateTuningCents(y: Float32Array, sr: number): number {
  const nFft = 8192;
  const hop = Math.max(nFft, Math.floor(sr * 0.25));
  const fft = new FFT(nFft);
  const re = new Float64Array(nFft);
  const im = new Float64Array(nFft);
  const window = new Float64Array(nFft);
  for (let i = 0; i < nFft; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / nFft);
  const hist = new Float64Array(100);
  const kMin = Math.ceil((80 * nFft) / sr);
  const kMax = Math.floor((2000 * nFft) / sr);
  const mag = new Float64Array(kMax + 2);
  for (let start = 0; start + nFft <= y.length; start += hop) {
    for (let i = 0; i < nFft; i++) {
      re[i] = y[start + i] * window[i];
      im[i] = 0;
    }
    fft.transform(re, im);
    let peak = 0;
    for (let k = kMin - 1; k <= kMax + 1; k++) {
      mag[k] = Math.hypot(re[k], im[k]);
      if (mag[k] > peak) peak = mag[k];
    }
    if (peak <= 0) continue;
    const floor = peak * 0.05; // ignore peaks more than 26 dB below the frame maximum
    for (let k = kMin; k <= kMax; k++) {
      const m = mag[k];
      if (m < floor || m < mag[k - 1] || m < mag[k + 1]) continue;
      // Parabolic interpolation on log magnitudes.
      const a = Math.log(mag[k - 1] + 1e-12);
      const b = Math.log(m + 1e-12);
      const c = Math.log(mag[k + 1] + 1e-12);
      const denom = a - 2 * b + c;
      const offset = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
      const freq = ((k + offset) * sr) / nFft;
      const cents = 1200 * Math.log2(freq / 440);
      const dev = ((Math.round(cents) % 100) + 150) % 100; // 0..99, 50 = in tune
      hist[dev] += m;
    }
  }
  // Circular smoothing, then the mode refined by a local circular mean.
  const smooth = new Float64Array(100);
  for (let i = 0; i < 100; i++) {
    for (let d = -3; d <= 3; d++) smooth[i] += hist[(i + d + 100) % 100] * (4 - Math.abs(d));
  }
  let best = 50;
  for (let i = 0; i < 100; i++) if (smooth[i] > smooth[best]) best = i;
  let sx = 0;
  let sy = 0;
  for (let d = -8; d <= 8; d++) {
    const i = (best + d + 100) % 100;
    const angle = (2 * Math.PI * (best + d)) / 100;
    sx += hist[i] * Math.cos(angle);
    sy += hist[i] * Math.sin(angle);
  }
  if (sx === 0 && sy === 0) return 0;
  const mean = (Math.atan2(sy, sx) / (2 * Math.PI)) * 100;
  const cents = ((mean - 50 + 150) % 100) - 50;
  return Math.max(-50, Math.min(50, cents));
}
