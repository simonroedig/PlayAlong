import { BINS, SEGMENT, SOURCES } from "./model";
import { DemucsSpectrogram } from "./spectrogram";

export interface ModelOutputs {
  /** [1, S, 4, BINS, FRAMES] */
  specOut: Float32Array;
  /** [1, S, 2, SEGMENT] */
  timeOut: Float32Array;
}

/** Runs the ONNX core on one normalized segment. */
export type ModelRunner = (mix: Float32Array, spec: Float32Array) => Promise<ModelOutputs>;

export interface SeparateOptions {
  /** Fraction of each segment shared with the next one (demucs default 0.25). */
  overlap?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /**
   * Receives finished audio in order. `blocks[s * 2 + c]` holds `length`
   * samples of source `s`, channel `c`, starting at frame `start`. The arrays
   * are reused after the callback returns.
   */
  onBlock: (start: number, length: number, blocks: Float32Array[]) => void;
}

const NUM_SOURCES = SOURCES.length;

/** Segment offsets used by demucs.apply.apply_model with `split=True`. */
export function segmentOffsets(length: number, overlap = 0.25, segment = SEGMENT): number[] {
  const stride = Math.trunc((1 - overlap) * segment);
  const offsets: number[] = [];
  for (let o = 0; o < length; o += stride) offsets.push(o);
  return offsets;
}

/** Triangular cross-fade weight of apply_model (transition_power = 1). */
export function transitionWeight(segment = SEGMENT): Float32Array {
  const half = Math.floor(segment / 2);
  const w = new Float32Array(segment);
  for (let i = 0; i < half; i++) w[i] = i + 1;
  for (let i = half; i < segment; i++) w[i] = segment - i;
  let max = 0;
  for (let i = 0; i < segment; i++) max = Math.max(max, w[i]);
  for (let i = 0; i < segment; i++) w[i] /= max;
  return w;
}

function abortError(): Error {
  const err = new Error("Separation cancelled");
  err.name = "AbortError";
  return err;
}

/**
 * Separates a stereo track into the model's sources, reproducing
 * `demucs.separate` (global normalization, split into overlapping 7.8 s
 * segments, triangular cross-fades, no random shifts).
 *
 * `left` / `right` are normalized in place to save memory; pass copies if the
 * caller still needs the original samples.
 */
export async function separate(
  left: Float32Array,
  right: Float32Array,
  runModel: ModelRunner,
  options: SeparateOptions,
): Promise<void> {
  const { overlap = 0.25, signal, onProgress, onBlock } = options;
  const length = left.length;
  if (right.length !== length) throw new Error("channels differ in length");
  if (length === 0) throw new Error("the track is empty");

  // demucs.separate normalizes by the mean / std of the mono mix.
  let sum = 0;
  for (let i = 0; i < length; i++) sum += (left[i] + right[i]) * 0.5;
  const mean = sum / length;
  let sq = 0;
  for (let i = 0; i < length; i++) {
    const d = (left[i] + right[i]) * 0.5 - mean;
    sq += d * d;
  }
  let std = Math.sqrt(sq / Math.max(1, length - 1));
  if (!(std > 1e-8)) std = 1;
  for (let i = 0; i < length; i++) {
    left[i] = (left[i] - mean) / std;
    right[i] = (right[i] - mean) / std;
  }

  const spectrogram = new DemucsSpectrogram(SEGMENT);
  const offsets = segmentOffsets(length, overlap);
  const weight = transitionWeight();
  const channels = NUM_SOURCES * 2;

  // Rolling overlap-add window covering [windowStart, windowStart + SEGMENT).
  const acc = Array.from({ length: channels }, () => new Float32Array(SEGMENT));
  const sumWeight = new Float32Array(SEGMENT);
  const out = Array.from({ length: channels }, () => new Float32Array(SEGMENT));
  const chunkL = new Float32Array(SEGMENT);
  const chunkR = new Float32Array(SEGMENT);

  const flush = (start: number, count: number) => {
    for (let ch = 0; ch < channels; ch++) {
      const a = acc[ch];
      const o = out[ch];
      for (let i = 0; i < count; i++) o[i] = (a[i] / sumWeight[i]) * std + mean;
    }
    onBlock(start, count, out.map((o) => o.subarray(0, count)));
    // Slide the window forward.
    for (let ch = 0; ch < channels; ch++) {
      acc[ch].copyWithin(0, count);
      acc[ch].fill(0, SEGMENT - count);
    }
    sumWeight.copyWithin(0, count);
    sumWeight.fill(0, SEGMENT - count);
  };

  const prepare = (k: number) => {
    const offset = offsets[k];
    const chunkLength = Math.min(SEGMENT, length - offset);
    // TensorChunk.padded: centre a short chunk, keeping real context around it.
    const delta = SEGMENT - chunkLength;
    const start = offset - Math.floor(delta / 2);
    const mix = new Float32Array(2 * SEGMENT);
    const from = Math.max(0, start);
    const to = Math.min(length, start + SEGMENT);
    mix.set(left.subarray(from, to), from - start);
    mix.set(right.subarray(from, to), SEGMENT + from - start);
    chunkL.set(mix.subarray(0, SEGMENT));
    chunkR.set(mix.subarray(SEGMENT));
    const spec = new Float32Array(4 * BINS * spectrogram.frames);
    spectrogram.forward(chunkL, chunkR, spec);
    return { mix, spec, offset, chunkLength, trim: Math.floor(delta / 2) };
  };

  let pending: Promise<ModelOutputs> | null = null;
  let next = prepare(0);
  pending = runModel(next.mix, next.spec);
  const sourceL = new Float32Array(SEGMENT);
  const sourceR = new Float32Array(SEGMENT);

  for (let k = 0; k < offsets.length; k++) {
    if (signal?.aborted) throw abortError();
    const current = next;
    const result = await pending!;
    if (signal?.aborted) throw abortError();
    // Queue the next segment before doing CPU work so a GPU backend can
    // overlap inference with this segment's inverse STFT.
    if (k + 1 < offsets.length) {
      next = prepare(k + 1);
      pending = runModel(next.mix, next.spec);
    } else {
      pending = null;
    }

    const { specOut, timeOut } = result;
    const specPerSource = 4 * BINS * spectrogram.frames;
    for (let s = 0; s < NUM_SOURCES; s++) {
      sourceL.set(timeOut.subarray((s * 2) * SEGMENT, (s * 2 + 1) * SEGMENT));
      sourceR.set(timeOut.subarray((s * 2 + 1) * SEGMENT, (s * 2 + 2) * SEGMENT));
      spectrogram.inverseAdd(specOut, s * specPerSource, sourceL, sourceR);
      const aL = acc[s * 2];
      const aR = acc[s * 2 + 1];
      const { chunkLength, trim } = current;
      for (let i = 0; i < chunkLength; i++) {
        const w = weight[i];
        aL[i] += w * sourceL[trim + i];
        aR[i] += w * sourceR[trim + i];
      }
    }
    for (let i = 0; i < current.chunkLength; i++) sumWeight[i] += weight[i];

    const done = k + 1 < offsets.length ? offsets[k + 1] - current.offset : length - current.offset;
    flush(current.offset, done);
    onProgress?.(k + 1, offsets.length);
  }
}
