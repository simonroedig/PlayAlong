import { FFT } from "../dsp/fft";
import { decimate2 } from "./resample";

/**
 * Constant-Q transform magnitude, a port of librosa.cqt (0.10/0.11) with
 * its defaults (Hann wavelets, L1 norm, 1 % basis sparsity, length scaling,
 * zero padding, recursive octave-wise 2:1 decimation). The chord model was
 * trained on these features, so the details matter.
 */
export interface CqtOptions {
  sr: number;
  hop: number;
  fmin: number;
  nBins: number;
  binsPerOctave: number;
}

export interface CqtResult {
  /** |CQT|, frame-major: value of bin b in frame t at [t * nBins + b]. */
  data: Float32Array;
  frames: number;
  nBins: number;
}

const HANN_BANDWIDTH = 1.50018310546875; // librosa.filters.window_bandwidth("hann")

interface SparseRow {
  index: Int32Array;
  re: Float64Array;
  im: Float64Array;
}

interface OctaveBasis {
  nFft: number;
  rows: SparseRow[];
}

const basisCache = new Map<string, OctaveBasis>();

function periodicHann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** librosa.util.sparsify_rows: drop the smallest coefficients holding < `quantile` of the row's L1 mass. */
function sparsify(re: Float64Array, im: Float64Array, quantile: number): SparseRow {
  const n = re.length;
  const mags = new Float64Array(n);
  let norm = 0;
  for (let k = 0; k < n; k++) {
    mags[k] = Math.hypot(re[k], im[k]);
    norm += mags[k];
  }
  const sorted = Float64Array.from(mags).sort();
  let cumulative = 0;
  let threshold = sorted[n - 1];
  for (let k = 0; k < n; k++) {
    cumulative += sorted[k] / norm;
    if (cumulative >= quantile) {
      threshold = sorted[k];
      break;
    }
  }
  const keep: number[] = [];
  for (let k = 0; k < n; k++) if (mags[k] >= threshold) keep.push(k);
  const row: SparseRow = {
    index: Int32Array.from(keep),
    re: new Float64Array(keep.length),
    im: new Float64Array(keep.length),
  };
  keep.forEach((k, j) => {
    row.re[j] = re[k];
    row.im[j] = im[k];
  });
  return row;
}

function octaveBasis(sr: number, freqs: number[], q: number, gain: number): OctaveBasis {
  const key = `${sr}|${freqs.join(",")}|${gain}`;
  const cached = basisCache.get(key);
  if (cached) return cached;
  const lengths = freqs.map((f) => (q * sr) / f);
  const nFft = 2 ** Math.ceil(Math.log2(Math.max(...lengths)));
  const fft = new FFT(nFft);
  const rows = freqs.map((freq, i) => {
    const ilen = lengths[i];
    // np.arange(-ilen // 2, ilen // 2): integer steps from floor(-ilen/2) below floor(ilen/2).
    const start = Math.floor(-ilen / 2);
    const stop = Math.floor(ilen / 2);
    const n = Math.ceil(stop - start);
    const window = periodicHann(n);
    let l1 = 0;
    for (let k = 0; k < n; k++) l1 += window[k];
    const re = new Float64Array(nFft);
    const im = new Float64Array(nFft);
    const lpad = Math.floor((nFft - n) / 2);
    const scale = ilen / nFft / l1;
    for (let k = 0; k < n; k++) {
      const angle = ((start + k) * 2 * Math.PI * freq) / sr;
      re[lpad + k] = Math.cos(angle) * window[k] * scale;
      im[lpad + k] = Math.sin(angle) * window[k] * scale;
    }
    fft.transform(re, im);
    const half = nFft / 2 + 1;
    const row = sparsify(re.subarray(0, half), im.subarray(0, half), 0.01);
    for (let j = 0; j < row.re.length; j++) {
      row.re[j] *= gain;
      row.im[j] *= gain;
    }
    return row;
  });
  const basis = { nFft, rows };
  basisCache.set(key, basis);
  return basis;
}

/** Complex filter responses of one octave: [frame][filter] interleaved re/im. */
function octaveResponse(y: Float32Array, hop: number, basis: OctaveBasis): { re: Float32Array; im: Float32Array; frames: number } {
  const { nFft, rows } = basis;
  const frames = 1 + Math.floor(y.length / hop);
  const half = nFft / 2;
  const fft = new FFT(nFft);
  const fr = new Float64Array(nFft);
  const fi = new Float64Array(nFft);
  const nRows = rows.length;
  const outRe = new Float32Array(frames * nRows);
  const outIm = new Float32Array(frames * nRows);
  for (let t = 0; t < frames; t++) {
    const start = t * hop - half;
    for (let k = 0; k < nFft; k++) {
      const idx = start + k;
      fr[k] = idx >= 0 && idx < y.length ? y[idx] : 0;
      fi[k] = 0;
    }
    fft.transform(fr, fi);
    for (let r = 0; r < nRows; r++) {
      const row = rows[r];
      let accRe = 0;
      let accIm = 0;
      for (let j = 0; j < row.index.length; j++) {
        const k = row.index[j];
        accRe += row.re[j] * fr[k] - row.im[j] * fi[k];
        accIm += row.re[j] * fi[k] + row.im[j] * fr[k];
      }
      outRe[t * nRows + r] = accRe;
      outIm[t * nRows + r] = accIm;
    }
  }
  return { re: outRe, im: outIm, frames };
}

function numTwoFactors(x: number): number {
  let n = 0;
  while (x > 0 && x % 2 === 0) {
    n++;
    x /= 2;
  }
  return n;
}

export function cqtMagnitude(signal: Float32Array, options: CqtOptions): CqtResult {
  const { nBins, binsPerOctave } = options;
  let { sr, hop } = options;
  const freqs = Array.from({ length: nBins }, (_, k) => options.fmin * 2 ** (k / binsPerOctave));
  // librosa.filters._relative_bandwidth for log-spaced bins.
  const alpha = (2 ** (2 / binsPerOctave) - 1) / (2 ** (2 / binsPerOctave) + 1);
  const q = 1 / alpha;
  const nOctaves = Math.ceil(nBins / binsPerOctave);
  const filterCutoff = Math.max(...freqs.map((f) => f * (1 + (0.5 * HANN_BANDWIDTH) / q)));
  const nyquist = sr / 2;
  if (filterCutoff > nyquist) throw new Error("CQT bins exceed the Nyquist frequency");

  // Early downsampling (librosa __early_downsample).
  const count1 = Math.max(0, Math.ceil(Math.log2(nyquist / filterCutoff)) - 1 - 1);
  const count2 = Math.max(0, numTwoFactors(hop) - nOctaves + 1);
  const early = Math.min(count1, count2);
  let y = signal;
  for (let i = 0; i < early; i++) y = decimate2(y, Math.SQRT2);
  sr /= 2 ** early;
  hop /= 2 ** early;
  const baseSr = sr;

  const responses: { re: Float32Array; im: Float32Array; frames: number; bins: number[] }[] = [];
  let mySr = sr;
  let myHop = hop;
  let myY = y;
  for (let i = 0; i < nOctaves; i++) {
    const hi = nBins - i * binsPerOctave;
    const lo = Math.max(0, hi - binsPerOctave);
    const bins = Array.from({ length: hi - lo }, (_, k) => lo + k);
    const basis = octaveBasis(mySr, bins.map((b) => freqs[b]), q, Math.sqrt(baseSr / mySr));
    responses.push({ ...octaveResponse(myY, myHop, basis), bins });
    if (myHop % 2 === 0 && i < nOctaves - 1) {
      myHop /= 2;
      mySr /= 2;
      myY = decimate2(myY, Math.SQRT2);
    }
  }

  const frames = Math.min(...responses.map((r) => r.frames));
  const data = new Float32Array(frames * nBins);
  const lengthScale = freqs.map((f) => 1 / Math.sqrt((q * baseSr) / f));
  for (const resp of responses) {
    const nRows = resp.bins.length;
    for (let t = 0; t < frames; t++) {
      for (let r = 0; r < nRows; r++) {
        const bin = resp.bins[r];
        const re = resp.re[t * nRows + r];
        const im = resp.im[t * nRows + r];
        data[t * nBins + bin] = Math.hypot(re, im) * lengthScale[bin];
      }
    }
  }
  return { data, frames, nBins };
}
