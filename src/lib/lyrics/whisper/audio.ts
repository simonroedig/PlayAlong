import { FFT } from "../../dsp/fft";

/**
 * Whisper's audio front end: 16 kHz resampling and the log-Mel spectrogram
 * of openai-whisper (whisper/audio.py): 25 ms Hann windows every 10 ms,
 * Slaney Mel filters, log10, floor at max − 8, scaled to roughly ±1.
 */

export const WHISPER_SR = 16000;
export const N_FFT = 400;
export const HOP = 160;
/** Mel frames in one 30 s window. */
export const N_FRAMES = 3000;
export const CHUNK_SAMPLES = N_FRAMES * HOP;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 60; k++) {
    term *= (x / (2 * k)) * (x / (2 * k));
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

/**
 * Rational polyphase resampler with a Kaiser-windowed sinc (16 zero
 * crossings, cutoff at 95 % of the lower Nyquist frequency).
 */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return Float32Array.from(x);
  const g = gcd(from, to);
  const up = to / g;
  const down = from / g;
  const cutoff = 0.95 * Math.min(1, to / from); // relative to the input Nyquist frequency
  const zeroCrossings = 16;
  const half = Math.ceil(zeroCrossings / cutoff); // kernel half-width in input samples
  const beta = 8.6;
  const i0Beta = besselI0(beta);
  const taps = 2 * half;
  // phase p: output sample at input position base + p / up
  const table = new Float32Array(up * taps);
  for (let p = 0; p < up; p++) {
    const frac = p / up;
    let sum = 0;
    for (let j = 0; j < taps; j++) {
      const d = j - half + 1 - frac; // distance from the output position, in input samples
      const r = d / half;
      const w = Math.abs(r) >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - r * r)) / i0Beta;
      const s = d === 0 ? 1 : Math.sin(Math.PI * cutoff * d) / (Math.PI * cutoff * d);
      table[p * taps + j] = cutoff * s * w;
      sum += cutoff * s * w;
    }
    for (let j = 0; j < taps; j++) table[p * taps + j] /= sum;
  }
  const outLength = Math.floor((x.length * up) / down);
  const out = new Float32Array(outLength);
  for (let n = 0; n < outLength; n++) {
    const pos = n * down; // in units of 1 / up input samples
    const base = Math.floor(pos / up);
    const p = pos - base * up;
    const first = base - half + 1;
    let acc = 0;
    const offset = p * taps;
    if (first >= 0 && first + taps <= x.length) {
      for (let j = 0; j < taps; j++) acc += table[offset + j] * x[first + j];
    } else {
      for (let j = 0; j < taps; j++) {
        const idx = first + j;
        if (idx >= 0 && idx < x.length) acc += table[offset + j] * x[idx];
      }
    }
    out[n] = acc;
  }
  return out;
}

/** librosa.filters.mel(sr, n_fft, n_mels) with Slaney scale and norm (whisper's mel_filters.npz). */
export function melFilters(nMels: number, sr = WHISPER_SR, nFft = N_FFT): Float32Array[] {
  const fSp = 200 / 3;
  const minLogHz = 1000;
  const minLogMel = minLogHz / fSp;
  const logStep = Math.log(6.4) / 27;
  const hzToMel = (f: number) => (f < minLogHz ? f / fSp : minLogMel + Math.log(f / minLogHz) / logStep);
  const melToHz = (m: number) => (m < minLogMel ? fSp * m : minLogHz * Math.exp(logStep * (m - minLogMel)));
  const bins = nFft / 2 + 1;
  const fftFreqs = Array.from({ length: bins }, (_, i) => (i * sr) / nFft);
  const maxMel = hzToMel(sr / 2);
  const melF = Array.from({ length: nMels + 2 }, (_, i) => melToHz((maxMel * i) / (nMels + 1)));
  return Array.from({ length: nMels }, (_, m) => {
    const w = new Float32Array(bins);
    const lower = melF[m];
    const center = melF[m + 1];
    const upper = melF[m + 2];
    const enorm = 2 / (upper - lower);
    for (let k = 0; k < bins; k++) {
      const left = (fftFreqs[k] - lower) / (center - lower);
      const right = (upper - fftFreqs[k]) / (upper - center);
      w[k] = Math.max(0, Math.min(left, right)) * enorm;
    }
    return w;
  });
}

/** Power spectrum of 400-point frames via Bluestein's algorithm on a 1024-point FFT. */
class PowerSpectrum400 {
  private readonly m = 1024;
  private readonly fft = new FFT(1024);
  private readonly chirpRe = new Float64Array(N_FFT);
  private readonly chirpIm = new Float64Array(N_FFT);
  private readonly bRe = new Float64Array(1024);
  private readonly bIm = new Float64Array(1024);
  private readonly aRe = new Float64Array(1024);
  private readonly aIm = new Float64Array(1024);

  constructor() {
    for (let n = 0; n < N_FFT; n++) {
      const angle = (Math.PI * ((n * n) % (2 * N_FFT))) / N_FFT;
      this.chirpRe[n] = Math.cos(angle);
      this.chirpIm[n] = -Math.sin(angle); // e^{-iπn²/N}
    }
    const { bRe, bIm } = this;
    for (let n = 0; n < N_FFT; n++) {
      bRe[n] = this.chirpRe[n];
      bIm[n] = -this.chirpIm[n]; // e^{+iπn²/N}
      if (n > 0) {
        bRe[this.m - n] = bRe[n];
        bIm[this.m - n] = bIm[n];
      }
    }
    this.fft.transform(bRe, bIm);
  }

  /** |DFT(frame)|² for bins 0…200 into `out`. */
  compute(frame: Float64Array, out: Float64Array) {
    const { aRe, aIm, bRe, bIm, chirpRe, chirpIm, m } = this;
    aRe.fill(0);
    aIm.fill(0);
    for (let n = 0; n < N_FFT; n++) {
      aRe[n] = frame[n] * chirpRe[n];
      aIm[n] = frame[n] * chirpIm[n];
    }
    this.fft.transform(aRe, aIm);
    for (let k = 0; k < m; k++) {
      const re = aRe[k] * bRe[k] - aIm[k] * bIm[k];
      const im = aRe[k] * bIm[k] + aIm[k] * bRe[k];
      aRe[k] = re;
      aIm[k] = im;
    }
    this.fft.transform(aRe, aIm, true);
    const bins = N_FFT / 2 + 1;
    for (let k = 0; k < bins; k++) {
      const cr = aRe[k] / m;
      const ci = aIm[k] / m;
      const re = cr * chirpRe[k] - ci * chirpIm[k];
      const im = cr * chirpIm[k] + ci * chirpRe[k];
      out[k] = re * re + im * im;
    }
  }
}

const filterCache = new Map<number, { index: Int32Array[]; weight: Float32Array[] }>();

function sparseFilters(nMels: number) {
  let cached = filterCache.get(nMels);
  if (!cached) {
    const dense = melFilters(nMels);
    const index: Int32Array[] = [];
    const weight: Float32Array[] = [];
    for (const w of dense) {
      const idx: number[] = [];
      w.forEach((v, k) => v > 0 && idx.push(k));
      index.push(Int32Array.from(idx));
      weight.push(Float32Array.from(idx, (k) => w[k]));
    }
    cached = { index, weight };
    filterCache.set(nMels, cached);
  }
  return cached;
}

/**
 * Log-Mel spectrogram of a chunk of ≤ 30 s (16 kHz), zero-padded to 30 s,
 * as whisper's log_mel_spectrogram(audio, padding=N_SAMPLES)[:, :3000].
 * Returns [nMels × 3000], Mel-band major.
 */
export function logMelChunk(audio: Float32Array, nMels: number): Float32Array {
  const { index, weight } = sparseFilters(nMels);
  const spectrum = new PowerSpectrum400();
  const window = new Float64Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT);
  const frame = new Float64Array(N_FFT);
  const power = new Float64Array(N_FFT / 2 + 1);
  const out = new Float32Array(nMels * N_FRAMES);
  const n = Math.min(audio.length, CHUNK_SAMPLES);
  // torch.stft(center=True) reflect-pads n_fft / 2 at the start; the end is zero padding.
  const sample = (i: number) => (i < 0 ? (n > -i ? audio[-i] : 0) : i < n ? audio[i] : 0);
  let max = -Infinity;
  for (let t = 0; t < N_FRAMES; t++) {
    const start = t * HOP - N_FFT / 2;
    if (start >= n) {
      // Only zero padding left: log10 of the 1e-10 floor.
      for (let m = 0; m < nMels; m++) out[m * N_FRAMES + t] = -10;
      continue;
    }
    for (let i = 0; i < N_FFT; i++) frame[i] = sample(start + i) * window[i];
    spectrum.compute(frame, power);
    for (let m = 0; m < nMels; m++) {
      const idx = index[m];
      const w = weight[m];
      let acc = 0;
      for (let j = 0; j < idx.length; j++) acc += w[j] * power[idx[j]];
      const v = Math.log10(Math.max(acc, 1e-10));
      out[m * N_FRAMES + t] = v;
      if (v > max) max = v;
    }
  }
  const floor = max - 8;
  for (let i = 0; i < out.length; i++) out[i] = (Math.max(out[i], floor) + 4) / 4;
  return out;
}
