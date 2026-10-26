import { FFT } from "../dsp/fft";

/**
 * Beat tracking on separated stems: a spectral-flux onset envelope (drums
 * weighted highest, bass and harmonic stems as support), a global tempo with
 * a log-normal prior around 120 BPM, and the dynamic-programming beat tracker
 * of Ellis (2007) as in librosa.beat.beat_track.
 */

export interface OnsetEnvelope {
  values: Float32Array;
  /** Frames per second. */
  fps: number;
}

const N_FFT = 1024;
const HOP = 256;
const N_MELS = 64;

function hzToMel(f: number) {
  return 2595 * Math.log10(1 + f / 700);
}
function melToHz(m: number) {
  return 700 * (10 ** (m / 2595) - 1);
}

function melFilterbank(sr: number, fmin: number, fmax: number): Float32Array[] {
  const bins = N_FFT / 2 + 1;
  const mMin = hzToMel(fmin);
  const mMax = hzToMel(fmax);
  const edges = Array.from({ length: N_MELS + 2 }, (_, i) => melToHz(mMin + ((mMax - mMin) * i) / (N_MELS + 1)));
  return Array.from({ length: N_MELS }, (_, m) => {
    const w = new Float32Array(bins);
    const [lo, mid, hi] = [edges[m], edges[m + 1], edges[m + 2]];
    for (let k = 0; k < bins; k++) {
      const f = (k * sr) / N_FFT;
      if (f > lo && f < hi) w[k] = f <= mid ? (f - lo) / (mid - lo) : (hi - f) / (hi - mid);
    }
    return w;
  });
}

/**
 * Spectral flux on a log-mel spectrogram (librosa.onset.onset_strength
 * style), one envelope per frequency band [fmin, fmax) from a single STFT.
 * Frame t is centred at t·HOP.
 */
export function onsetBands(y: Float32Array, sr: number, bands: [number, number][]): OnsetEnvelope[] {
  const frames = 1 + Math.floor(y.length / HOP);
  const fft = new FFT(N_FFT);
  const re = new Float64Array(N_FFT);
  const im = new Float64Array(N_FFT);
  const window = new Float64Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT);
  const fmin = Math.min(...bands.map((b) => b[0]));
  const fmax = Math.min(sr / 2, Math.max(...bands.map((b) => b[1])));
  const mel = melFilterbank(sr, fmin, fmax);
  const centres = mel.map((w) => {
    let num = 0;
    let den = 0;
    w.forEach((v, k) => {
      num += v * ((k * sr) / N_FFT);
      den += v;
    });
    return den > 0 ? num / den : 0;
  });
  const nonZero = mel.map((w) => {
    const idx: number[] = [];
    w.forEach((v, k) => v > 0 && idx.push(k));
    return Int32Array.from(idx);
  });
  const bins = N_FFT / 2 + 1;
  const power = new Float64Array(bins);
  let peakDb = -Infinity;
  const logMel = new Float32Array(frames * N_MELS);
  for (let t = 0; t < frames; t++) {
    const start = t * HOP - N_FFT / 2;
    for (let i = 0; i < N_FFT; i++) {
      const idx = start + i;
      re[i] = idx >= 0 && idx < y.length ? y[idx] * window[i] : 0;
      im[i] = 0;
    }
    fft.transform(re, im);
    for (let k = 0; k < bins; k++) power[k] = re[k] * re[k] + im[k] * im[k];
    for (let m = 0; m < N_MELS; m++) {
      let acc = 0;
      const w = mel[m];
      for (const k of nonZero[m]) acc += w[k] * power[k];
      const db = 10 * Math.log10(acc + 1e-10);
      logMel[t * N_MELS + m] = db;
      if (db > peakDb) peakDb = db;
    }
  }
  // Clip to 80 dB below the peak (librosa power_to_db top_db), then flux per band.
  const floor = peakDb - 80;
  return bands.map(([lo, hi]) => {
    const members = centres.flatMap((c, m) => (c >= lo && c < hi ? [m] : []));
    const values = new Float32Array(frames);
    for (let t = 1; t < frames; t++) {
      let flux = 0;
      for (const m of members) {
        const cur = Math.max(logMel[t * N_MELS + m], floor);
        const prev = Math.max(logMel[(t - 1) * N_MELS + m], floor);
        flux += Math.max(0, cur - prev);
      }
      values[t] = members.length ? flux / members.length : 0;
    }
    return { values, fps: sr / HOP };
  });
}

export function onsetEnvelope(y: Float32Array, sr: number, fmin = 30, fmax = sr / 2): OnsetEnvelope {
  return onsetBands(y, sr, [[fmin, fmax]])[0];
}

/** Removes slow trends (local mean over ~1 s) and half-wave rectifies. */
export function normalizeOnsets(env: Float32Array, fps: number): Float32Array {
  const radius = Math.round(fps * 0.5);
  const out = new Float32Array(env.length);
  let sum = 0;
  let count = 0;
  let lo = 0;
  let hi = -1;
  for (let t = 0; t < env.length; t++) {
    while (hi < Math.min(env.length - 1, t + radius)) {
      sum += env[++hi];
      count++;
    }
    while (lo < t - radius) {
      sum -= env[lo++];
      count--;
    }
    out[t] = Math.max(0, env[t] - sum / count);
  }
  let sq = 0;
  for (const v of out) sq += v * v;
  const rms = Math.sqrt(sq / Math.max(1, out.length)) || 1;
  for (let t = 0; t < out.length; t++) out[t] /= rms;
  return out;
}

/** Global tempo in BPM: onset autocorrelation weighted by a log-normal prior (librosa: 120 BPM, 1 octave). */
export function estimateTempo(env: Float32Array, fps: number, startBpm = 120, stdOctaves = 1): number {
  const minLag = Math.floor((60 * fps) / 220);
  const maxLag = Math.ceil((60 * fps) / 40);
  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length || 1;
  const x = Float32Array.from(env, (v) => v - mean);
  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let acc = 0;
    for (let t = lag; t < x.length; t++) acc += x[t] * x[t - lag];
    ac[lag] = acc / Math.max(1, x.length - lag);
  }
  let best = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / startBpm) / stdOctaves) ** 2);
    // A beat period also shows up at twice the lag; reward consistent periodicity.
    const harmonic = lag * 2 <= maxLag + 1 ? Math.max(0, ac[lag * 2]) * 0.5 : 0;
    const score = (Math.max(0, ac[lag]) + harmonic) * prior;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  // Parabolic refinement of the peak.
  const a = ac[best - 1];
  const b = ac[best];
  const c = ac[best + 1];
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  return (60 * fps) / (best + shift);
}

/**
 * Dynamic-programming beat tracker (Ellis 2007, librosa.beat.__beat_tracker).
 * Returns beat positions in frames.
 */
export function trackBeatFrames(env: Float32Array, fps: number, bpm: number, tightness = 100): number[] {
  const n = env.length;
  if (n === 0) return [];
  const period = (60 * fps) / bpm;
  // Local score: onsets smoothed with a Gaussian of width period/32.
  const half = Math.round(period);
  const kernel = Array.from({ length: 2 * half + 1 }, (_, i) => Math.exp(-0.5 * (((i - half) * 32) / period) ** 2));
  const local = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    let acc = 0;
    for (let k = 0; k < kernel.length; k++) {
      const idx = t + k - half;
      if (idx >= 0 && idx < n) acc += kernel[k] * env[idx];
    }
    local[t] = acc;
  }
  const cumscore = new Float64Array(n);
  const backlink = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2);
  const hi = Math.round(2 * period);
  for (let t = 0; t < n; t++) {
    let best = -Infinity;
    let bestPrev = -1;
    for (let d = lo; d <= hi; d++) {
      const prev = t - d;
      if (prev < 0) break;
      const score = cumscore[prev] - tightness * Math.log(d / period) ** 2;
      if (score > best) {
        best = score;
        bestPrev = prev;
      }
    }
    cumscore[t] = local[t] + (bestPrev >= 0 && best > 0 ? best : 0);
    backlink[t] = bestPrev >= 0 && best > 0 ? bestPrev : -1;
  }
  // Last beat: the last local maximum of cumscore above half the median of maxima.
  const maxima: number[] = [];
  for (let t = 1; t < n - 1; t++) if (cumscore[t] > cumscore[t - 1] && cumscore[t] >= cumscore[t + 1]) maxima.push(t);
  if (maxima.length === 0) return [];
  const values = maxima.map((t) => cumscore[t]).sort((a, b) => a - b);
  const threshold = 0.5 * values[Math.floor(values.length / 2)];
  let tail = maxima[maxima.length - 1];
  for (let i = maxima.length - 1; i >= 0; i--) {
    if (cumscore[maxima[i]] >= threshold) {
      tail = maxima[i];
      break;
    }
  }
  const beats: number[] = [];
  for (let t = tail; t >= 0; t = backlink[t]) beats.push(t);
  beats.reverse();
  // Trim weak beats at the start and end (silence or count-in noise).
  let sq = 0;
  for (const b of beats) sq += local[b] * local[b];
  const rms = Math.sqrt(sq / beats.length);
  let first = 0;
  let last = beats.length - 1;
  while (first < last && local[beats[first]] < 0.5 * rms) first++;
  while (last > first && local[beats[last]] < 0.5 * rms) last--;
  return beats.slice(first, last + 1);
}

/** Snaps each beat to the strongest onset within ±window frames. */
export function refineBeats(beats: number[], env: Float32Array, window: number): number[] {
  return beats.map((b) => {
    let best = b;
    for (let t = Math.max(0, b - window); t <= Math.min(env.length - 1, b + window); t++) {
      if (env[t] > env[best] * 1.15) best = t;
    }
    return best;
  });
}

/**
 * Extends a beat sequence to cover [0, duration] using the local period at
 * either end, so every moment of the song falls between two beats.
 */
export function extendBeats(beatTimes: number[], duration: number, fallbackPeriod: number, start = 0): number[] {
  const beats = [...beatTimes];
  if (beats.length < 2) {
    const out: number[] = [];
    for (let t = start; t < duration; t += fallbackPeriod) out.push(t);
    return out;
  }
  const headPeriod = Math.max(0.2, beats[Math.min(4, beats.length - 1)] - beats[0]) / Math.min(4, beats.length - 1);
  const tailPeriod =
    Math.max(0.2, beats[beats.length - 1] - beats[Math.max(0, beats.length - 5)]) / Math.min(4, beats.length - 1);
  while (beats[0] - headPeriod > start - headPeriod * 0.5 && beats[0] > start + 0.05) beats.unshift(Math.max(start, beats[0] - headPeriod));
  while (beats[beats.length - 1] + tailPeriod < duration) beats.push(beats[beats.length - 1] + tailPeriod);
  return beats;
}
