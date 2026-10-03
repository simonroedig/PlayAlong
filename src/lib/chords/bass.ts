import type { CqtResult } from "./cqt";

/**
 * Bass pitch class per CQT frame from the separated bass stem, by
 * subharmonic summation over the first four harmonics (24 bins/octave CQT
 * starting at C1). Returns a weight per pitch class and frame; frames
 * without a clear bass note get zero weight.
 */
export interface BassFrames {
  /** [frame * 12 + pc] salience of the detected fundamental. */
  salience: Float32Array;
  frames: number;
}

const HARMONICS = [1, 2, 3, 4];
const HARMONIC_WEIGHTS = [1, 0.6, 0.4, 0.3];

export function bassPitchClasses(cqt: CqtResult, binsPerOctave: number, maxF0Bins: number): BassFrames {
  const { data, frames, nBins } = cqt;
  const salience = new Float32Array(frames * 12);
  const offsets = HARMONICS.map((h) => Math.round(binsPerOctave * Math.log2(h)));
  const binsPerSemitone = binsPerOctave / 12;
  const scores = new Float64Array(maxF0Bins);
  let globalPeak = 0;
  const frameBest = new Float64Array(frames);
  const frameBin = new Int32Array(frames);
  for (let t = 0; t < frames; t++) {
    let best = 0;
    let bestBin = -1;
    for (let b = 0; b < maxF0Bins; b++) {
      let s = 0;
      for (let h = 0; h < HARMONICS.length; h++) {
        const bin = b + offsets[h];
        if (bin < nBins) s += HARMONIC_WEIGHTS[h] * data[t * nBins + bin];
      }
      scores[b] = s;
      if (s > best) {
        best = s;
        bestBin = b;
      }
    }
    // An octave above can win through its own harmonics; prefer the lower
    // candidate when it is nearly as strong (bass notes are low).
    if (bestBin >= binsPerOctave) {
      const lower = bestBin - binsPerOctave;
      if (scores[lower] > 0.85 * best) {
        bestBin = lower;
        best = scores[lower];
      }
    }
    frameBest[t] = best;
    frameBin[t] = bestBin;
    if (best > globalPeak) globalPeak = best;
  }
  if (globalPeak <= 0) return { salience, frames };
  for (let t = 0; t < frames; t++) {
    if (frameBin[t] < 0) continue;
    const level = frameBest[t] / globalPeak;
    if (level < 0.08) continue; // silence / noise
    const pc = Math.round(frameBin[t] / binsPerSemitone) % 12;
    salience[t * 12 + pc] = level;
  }
  return { salience, frames };
}
