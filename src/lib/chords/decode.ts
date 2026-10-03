import { FAMILY, INTERVALS, LARGE_N, MAJMIN_N, QUALITIES, type Key, type Quality } from "./vocabulary";

/**
 * Turning per-beat chord probabilities into a clean, playable chord chart:
 * repetition smoothing, key estimation, metre-aware Viterbi decoding,
 * extensions and slash basses.
 */

export const STATES = 25; // 12 major, 12 minor (index 2·root + minor), N

export const stateRoot = (s: number) => (s === MAJMIN_N ? null : s >> 1);
export const stateMinor = (s: number) => (s & 1) === 1;

function normalize(v: Float64Array): Float64Array {
  let sum = 0;
  for (const x of v) sum += x;
  if (sum > 0) for (let i = 0; i < v.length; i++) v[i] /= sum;
  return v;
}

/**
 * Averages each beat's distribution with the beats at the same position in
 * repeated passages (found by comparing the surrounding bars), so a chorus
 * gets the same chords every time and one-off errors are outvoted.
 */
export function repetitionSmoothing(
  beats: Float64Array[],
  beatsPerBar: number,
  options: { window?: number; threshold?: number; neighbours?: number; strength?: number } = {},
): Float64Array[] {
  const n = beats.length;
  const window = options.window ?? beatsPerBar * 2;
  const threshold = options.threshold ?? 0.9;
  const maxNeighbours = options.neighbours ?? 8;
  const strength = options.strength ?? 1;
  // Hellinger-style unit vectors.
  const unit = beats.map((p) => {
    const v = Float64Array.from(p, Math.sqrt);
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < v.length; i++) v[i] /= norm;
    return v;
  });
  const dot = (a: Float64Array, b: Float64Array) => {
    let s = 0;
    for (let k = 0; k < a.length; k++) s += a[k] * b[k];
    return s;
  };
  const half = Math.floor(window / 2);
  const similarity = (i: number, j: number) => {
    let sum = 0;
    let count = 0;
    for (let k = -half; k < window - half; k++) {
      const a = i + k;
      const b = j + k;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      sum += dot(unit[a], unit[b]);
      count++;
    }
    return count >= half ? sum / count : 0;
  };
  return beats.map((p, i) => {
    const candidates: { j: number; s: number }[] = [];
    for (let j = i % beatsPerBar; j < n; j += beatsPerBar) {
      if (Math.abs(j - i) < window) continue;
      const s = similarity(i, j);
      if (s >= threshold) candidates.push({ j, s });
    }
    if (candidates.length === 0) return p;
    candidates.sort((a, b) => b.s - a.s);
    const chosen = candidates.slice(0, maxNeighbours);
    const avg = new Float64Array(p.length);
    let wsum = 0;
    for (const { j, s } of chosen) {
      for (let k = 0; k < p.length; k++) avg[k] += s * beats[j][k];
      wsum += s;
    }
    const kappa = strength * Math.min(1, chosen.length / 2);
    const out = new Float64Array(p.length);
    for (let k = 0; k < p.length; k++) out[k] = (p[k] + (kappa * avg[k]) / wsum) / (1 + kappa);
    return out;
  });
}

/** Chord prior within a major key, by scale degree of the root (rock/pop harmony). */
const MAJOR_DEGREE_PRIOR: Record<number, { maj: number; min: number }> = {
  0: { maj: 1, min: 0.12 },
  1: { maj: 0.06, min: 0.04 },
  2: { maj: 0.3, min: 0.8 },
  3: { maj: 0.3, min: 0.05 },
  4: { maj: 0.3, min: 0.6 },
  5: { maj: 1, min: 0.45 },
  6: { maj: 0.06, min: 0.06 },
  7: { maj: 1, min: 0.2 },
  8: { maj: 0.3, min: 0.05 },
  9: { maj: 0.2, min: 0.9 },
  10: { maj: 0.5, min: 0.08 },
  11: { maj: 0.06, min: 0.12 },
};
const N_PRIOR = 0.12;

/**
 * Prior over the 25 states given a key (a minor key uses its relative major
 * plus a strong V). `strength` < 1 flattens it.
 */
export function keyPrior(key: Key | null, strength = 1): Float64Array {
  const prior = new Float64Array(STATES);
  if (!key) {
    prior.fill(1);
    return normalize(prior);
  }
  const major = key.mode === "major" ? key.tonic : (key.tonic + 3) % 12;
  for (let root = 0; root < 12; root++) {
    const degree = (root - major + 12) % 12;
    prior[2 * root] = MAJOR_DEGREE_PRIOR[degree].maj;
    prior[2 * root + 1] = MAJOR_DEGREE_PRIOR[degree].min;
  }
  if (key.mode === "minor") prior[2 * ((key.tonic + 7) % 12)] = 0.8; // harmonic-minor V
  prior[MAJMIN_N] = N_PRIOR;
  for (let s = 0; s < STATES; s++) prior[s] **= strength;
  return normalize(prior);
}

/** Most likely key for a chord histogram (25 states, N ignored). */
export function estimateKey(histogram: Float64Array): Key | null {
  let total = 0;
  for (let s = 0; s < 24; s++) total += histogram[s];
  if (total <= 0) return null;
  let best: Key | null = null;
  let bestScore = -Infinity;
  for (let tonic = 0; tonic < 12; tonic++) {
    const prior = keyPrior({ tonic, mode: "major" });
    let score = 0;
    for (let s = 0; s < 24; s++) score += histogram[s] * Math.log(prior[s] + 1e-6);
    if (score > bestScore) {
      bestScore = score;
      best = { tonic, mode: "major" };
    }
  }
  if (!best) return null;
  // Relative minor if its tonic chord clearly dominates the major tonic.
  const relMinor = (best.tonic + 9) % 12;
  if (histogram[2 * relMinor + 1] > 1.15 * histogram[2 * best.tonic]) {
    return { tonic: relMinor, mode: "minor" };
  }
  return best;
}

export interface ViterbiOptions {
  /** Chord-change probability for each position in the bar (0 = downbeat). */
  changeProbability: number[];
  /** Index of the first downbeat in the beat list. */
  downbeat: number;
  prior: Float64Array;
  /** Distribution of the first state (default: the prior). */
  initial?: Float64Array;
  /** Per-beat additive log scores (e.g. bass agreement), [beat][state]. */
  extra?: Float64Array[];
}

/** Best state sequence over beats (log-domain Viterbi). */
export function viterbi(emissions: Float64Array[], options: ViterbiOptions): number[] {
  const n = emissions.length;
  if (n === 0) return [];
  const { changeProbability, prior } = options;
  const barLength = changeProbability.length;
  const logPrior = Float64Array.from(prior, (p) => Math.log(p + 1e-9));
  const logEmit = (i: number, s: number) => Math.log(emissions[i][s] + 1e-4) + (options.extra?.[i][s] ?? 0);
  const initial = options.initial ?? prior;
  let delta = new Float64Array(STATES);
  for (let s = 0; s < STATES; s++) delta[s] = Math.log(initial[s] + 1e-9) + logEmit(0, s);
  const back: Int8Array[] = [];
  for (let i = 1; i < n; i++) {
    const pos = (((i - options.downbeat) % barLength) + barLength) % barLength;
    const pChange = changeProbability[pos];
    const logStay = Math.log(1 - pChange);
    // Leaving state a for b: pChange · prior(b) / (1 − prior(a)).
    const leave = Float64Array.from(delta, (d, a) => d - Math.log(1 - prior[a] + 1e-9));
    let bestPrev = 0;
    for (let s = 1; s < STATES; s++) if (leave[s] > leave[bestPrev]) bestPrev = s;
    let second = bestPrev === 0 ? 1 : 0;
    for (let s = 0; s < STATES; s++) if (s !== bestPrev && leave[s] > leave[second]) second = s;
    const next = new Float64Array(STATES);
    const ptr = new Int8Array(STATES);
    for (let s = 0; s < STATES; s++) {
      const from = bestPrev !== s ? bestPrev : second;
      const change = leave[from] + Math.log(pChange) + logPrior[s];
      const stay = delta[s] + logStay;
      if (stay >= change) {
        next[s] = stay;
        ptr[s] = s;
      } else {
        next[s] = change;
        ptr[s] = from;
      }
      next[s] += logEmit(i, s);
    }
    delta = next;
    back.push(ptr);
  }
  let state = 0;
  for (let s = 1; s < STATES; s++) if (delta[s] > delta[state]) state = s;
  const path = new Array<number>(n);
  path[n - 1] = state;
  for (let i = n - 1; i > 0; i--) {
    state = back[i - 1][state];
    path[i - 1] = state;
  }
  return path;
}

/**
 * Picks the most likely extension (7, maj7, sus4, …) of a decided triad from
 * the large-vocabulary model, only when it is clearly supported.
 */
export function refineQuality(root: number, minor: boolean, large: Float64Array, minShare = 0.4, minRatio = 1.25): Quality {
  const family = minor ? "min" : "maj";
  const triad: Quality = minor ? "min" : "maj";
  let total = 0;
  let best: Quality = triad;
  let bestMass = 0;
  for (let q = 0; q < QUALITIES.length; q++) {
    const quality = QUALITIES[q];
    if (FAMILY[quality] !== family) continue;
    const mass = large[root * 14 + q];
    total += mass;
    if (quality !== triad && mass > bestMass) {
      bestMass = mass;
      best = quality;
    }
  }
  const triadMass = large[root * 14 + QUALITIES.indexOf(triad)];
  if (total <= 0 || best === triad) return triad;
  return bestMass / total >= minShare && bestMass >= minRatio * triadMass ? best : triad;
}

/** Slash bass if one chord tone other than the root clearly dominates the bass line. */
export function slashBass(root: number, quality: Quality, bassHistogram: Float64Array, minShare = 0.6): number | null {
  let total = 0;
  let top = 0;
  for (let pc = 0; pc < 12; pc++) {
    total += bassHistogram[pc];
    if (bassHistogram[pc] > bassHistogram[top]) top = pc;
  }
  if (total <= 0 || top === root || bassHistogram[top] / total < minShare) return null;
  const tones = INTERVALS[quality].map((i) => (root + i) % 12);
  return tones.includes(top) ? top : null;
}

/** Collapses large-vocabulary probabilities onto the 25 maj/min states. */
export function largeToMajMin(large: Float32Array | Float64Array, offset: number, out: Float64Array): Float64Array {
  out.fill(0);
  for (let root = 0; root < 12; root++) {
    for (let q = 0; q < QUALITIES.length; q++) {
      const p = large[offset + root * 14 + q];
      out[2 * root + (FAMILY[QUALITIES[q]] === "min" ? 1 : 0)] += p;
    }
  }
  out[MAJMIN_N] = large[offset + LARGE_N];
  return normalize(out);
}
