import { FFT } from "../dsp/fft";
import { BINS, HOP, NFFT } from "./model";

/**
 * Exact port of HTDemucs' `_spec` / `_ispec` (demucs v4) for a fixed segment
 * length:
 *
 * - `_spec` reflect-pads the signal by 3·hop/2 (plus enough on the right to
 *   reach a whole number of hops), runs a centered, normalized STFT with a
 *   periodic Hann window, drops the Nyquist bin and keeps frames [2, 2 + le).
 *   The kept frames never reach into torch.stft's own centering pad, so frame
 *   `f` is simply the windowed slice starting at `f·hop − 3·hop/2`.
 * - `_ispec` zero-pads the Nyquist bin and two frames on each side, runs a
 *   normalized, centered iSTFT and crops 3·hop/2 samples from the front.
 *
 * Two real channels are transformed with one complex FFT (left in the real
 * part, right in the imaginary part), which halves the work.
 */
export class DemucsSpectrogram {
  readonly length: number;
  readonly frames: number;
  private readonly fft = new FFT(NFFT);
  private readonly window = new Float64Array(NFFT);
  private readonly invEnvelope: Float32Array;
  private readonly pad = (HOP / 2) * 3;
  private static readonly BLOCK = 8;
  private readonly bufRe: Float64Array[] = [];
  private readonly bufIm: Float64Array[] = [];

  constructor(length: number) {
    this.length = length;
    this.frames = Math.ceil(length / HOP);
    for (let n = 0; n < NFFT; n++) {
      this.window[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / NFFT);
    }
    for (let b = 0; b < DemucsSpectrogram.BLOCK; b++) {
      this.bufRe.push(new Float64Array(NFFT));
      this.bufIm.push(new Float64Array(NFFT));
    }
    this.invEnvelope = this.computeInverseEnvelope();
  }

  /**
   * torch.istft divides the overlap-added frames by the sum of squared windows
   * of *all* frames, including the zero frames `_ispec` pads in. Precompute
   * its reciprocal for every output sample.
   */
  private computeInverseEnvelope(): Float32Array {
    const totalFrames = this.frames + 4;
    // Output sample i sits at index (nfft/2 + pad + i) of the overlap-add
    // buffer: istft's center crop plus `_ispec`'s crop.
    const offset = NFFT / 2 + this.pad;
    const env = new Float32Array(this.length);
    for (let i = 0; i < this.length; i++) {
      const j = offset + i;
      const tMin = Math.max(0, Math.ceil((j - NFFT + 1) / HOP));
      const tMax = Math.min(totalFrames - 1, Math.floor(j / HOP));
      let sum = 0;
      for (let t = tMin; t <= tMax; t++) {
        const w = this.window[j - t * HOP];
        sum += w * w;
      }
      env[i] = sum > 1e-11 ? 1 / sum : 0;
    }
    return env;
  }

  /**
   * Complex-as-channels spectrogram of one stereo segment, written in the
   * layout of the ONNX `spec` input: [4][BINS][frames] with channels
   * (L.re, L.im, R.re, R.im).
   */
  forward(left: Float32Array, right: Float32Array, out: Float32Array): void {
    const { length: L, frames, pad, window, fft } = this;
    if (left.length !== L || right.length !== L) throw new Error("segment length mismatch");
    if (out.length !== 4 * BINS * frames) throw new Error("spec buffer has the wrong size");
    const scale = 1 / Math.sqrt(NFFT);
    const block = DemucsSpectrogram.BLOCK;
    for (let f0 = 0; f0 < frames; f0 += block) {
      const nb = Math.min(block, frames - f0);
      for (let b = 0; b < nb; b++) {
        const re = this.bufRe[b];
        const im = this.bufIm[b];
        const start = (f0 + b) * HOP - pad;
        for (let n = 0; n < NFFT; n++) {
          let idx = start + n;
          if (idx < 0) idx = -idx;
          else if (idx >= L) idx = 2 * (L - 1) - idx;
          const w = window[n];
          re[n] = left[idx] * w;
          im[n] = right[idx] * w;
        }
        fft.transform(re, im);
      }
      // Unpack the two real spectra: X = FFT(l + i·r)
      //   L[k] = (X[k] + conj(X[N-k])) / 2,  R[k] = (X[k] − conj(X[N-k])) / 2i
      for (let k = 0; k < BINS; k++) {
        const nk = (NFFT - k) & (NFFT - 1);
        const o0 = k * frames + f0;
        const o1 = (BINS + k) * frames + f0;
        const o2 = (2 * BINS + k) * frames + f0;
        const o3 = (3 * BINS + k) * frames + f0;
        for (let b = 0; b < nb; b++) {
          const re = this.bufRe[b];
          const im = this.bufIm[b];
          const xr = re[k];
          const xi = im[k];
          const yr = re[nk];
          const yi = im[nk];
          out[o0 + b] = 0.5 * (xr + yr) * scale;
          out[o1 + b] = 0.5 * (xi - yi) * scale;
          out[o2 + b] = 0.5 * (xi + yi) * scale;
          out[o3 + b] = 0.5 * (yr - xr) * scale;
        }
      }
    }
  }

  /**
   * Inverse of one source's spectrogram ([4][BINS][frames] starting at
   * `offset` inside `spec`), added into `outL` / `outR`.
   */
  inverseAdd(spec: Float32Array, offset: number, outL: Float32Array, outR: Float32Array): void {
    const { length: L, frames, pad, window, fft, invEnvelope } = this;
    const scale = 1 / Math.sqrt(NFFT);
    const block = DemucsSpectrogram.BLOCK;
    const c0 = offset;
    const c1 = offset + BINS * frames;
    const c2 = offset + 2 * BINS * frames;
    const c3 = offset + 3 * BINS * frames;
    for (let f0 = 0; f0 < frames; f0 += block) {
      const nb = Math.min(block, frames - f0);
      // DC: irfft ignores the imaginary part.
      for (let b = 0; b < nb; b++) {
        this.bufRe[b][0] = spec[c0 + f0 + b];
        this.bufIm[b][0] = spec[c2 + f0 + b];
        this.bufRe[b][BINS] = 0;
        this.bufIm[b][BINS] = 0;
      }
      // C[k] = L[k] + i·R[k] and its Hermitian mirror C[N-k] = conj(L[k]) + i·conj(R[k]).
      for (let k = 1; k < BINS; k++) {
        const base = k * frames + f0;
        const nk = NFFT - k;
        for (let b = 0; b < nb; b++) {
          const lr = spec[c0 + base + b];
          const li = spec[c1 + base + b];
          const rr = spec[c2 + base + b];
          const ri = spec[c3 + base + b];
          const re = this.bufRe[b];
          const im = this.bufIm[b];
          re[k] = lr - ri;
          im[k] = li + rr;
          re[nk] = lr + ri;
          im[nk] = rr - li;
        }
      }
      for (let b = 0; b < nb; b++) {
        const re = this.bufRe[b];
        const im = this.bufIm[b];
        fft.transform(re, im, true);
        const start = (f0 + b) * HOP - pad;
        const nStart = Math.max(0, -start);
        const nEnd = Math.min(NFFT, L - start);
        for (let n = nStart; n < nEnd; n++) {
          const i = start + n;
          const w = window[n] * scale * invEnvelope[i];
          outL[i] += re[n] * w;
          outR[i] += im[n] * w;
        }
      }
    }
  }
}
