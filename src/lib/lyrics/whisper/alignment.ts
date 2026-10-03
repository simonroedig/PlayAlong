import { sotSequence, type EncodedAudio, type WhisperConfig, type WhisperRunner } from "./decoding";
import type { WhisperTokenizer } from "./tokenizer";

/**
 * Word timestamps from the cross-attention of Whisper's alignment heads
 * (whisper/timing.py: find_alignment): attention over the audio frames per
 * text token, normalised, median-filtered, then a monotonic DTW path.
 */

export interface WordTiming {
  word: string;
  tokens: number[];
  /** Seconds, relative to the window start. */
  start: number;
  end: number;
  probability: number;
}

/** Audio frames per second at the encoder output (2 per 10 ms Mel frame pair). */
const FRAMES_PER_SECOND = 50;

/** Median over a sliding window along each row, reflect-padded (whisper.timing.median_filter). */
export function medianFilterRows(x: Float32Array, rows: number, cols: number, width: number): Float32Array {
  const pad = Math.floor(width / 2);
  if (cols <= pad) return x;
  const out = new Float32Array(x.length);
  const window = new Float32Array(width);
  const at = (row: number, c: number) => {
    // numpy / torch "reflect": -1 → 1, cols → cols - 2
    if (c < 0) c = -c;
    if (c >= cols) c = 2 * cols - 2 - c;
    return x[row * cols + c];
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (let k = 0; k < width; k++) window[k] = at(r, c - pad + k);
      window.sort();
      out[r * cols + c] = window[pad];
    }
  }
  return out;
}

/** Monotonic alignment path through a cost matrix [n × m] (whisper.timing.dtw_cpu + backtrace). */
export function dtw(cost: Float32Array, n: number, m: number): { textIndices: Int32Array; timeIndices: Int32Array } {
  const W = m + 1;
  const acc = new Float32Array((n + 1) * W).fill(Infinity);
  const trace = new Int8Array((n + 1) * W).fill(-1);
  acc[0] = 0;
  for (let j = 1; j <= m; j++) {
    for (let i = 1; i <= n; i++) {
      const c0 = acc[(i - 1) * W + j - 1];
      const c1 = acc[(i - 1) * W + j];
      const c2 = acc[i * W + j - 1];
      let c: number;
      let t: number;
      if (c0 < c1 && c0 < c2) {
        c = c0;
        t = 0;
      } else if (c1 < c0 && c1 < c2) {
        c = c1;
        t = 1;
      } else {
        c = c2;
        t = 2;
      }
      acc[i * W + j] = Math.fround(cost[(i - 1) * m + j - 1] + c);
      trace[i * W + j] = t;
    }
  }
  for (let j = 0; j <= m; j++) trace[j] = 2;
  for (let i = 0; i <= n; i++) trace[i * W] = 1;
  let i = n;
  let j = m;
  const path: [number, number][] = [];
  while (i > 0 || j > 0) {
    path.push([i - 1, j - 1]);
    const t = trace[i * W + j];
    if (t === 0) {
      i--;
      j--;
    } else if (t === 1) {
      i--;
    } else {
      j--;
    }
  }
  path.reverse();
  return { textIndices: Int32Array.from(path, (p) => p[0]), timeIndices: Int32Array.from(path, (p) => p[1]) };
}

/**
 * Aligns `textTokens` (no timestamps) to the audio of a window of
 * `numFrames` Mel frames. One teacher-forced decoder pass.
 */
export async function alignWords(
  runner: WhisperRunner,
  cfg: WhisperConfig,
  tokenizer: WhisperTokenizer,
  audio: EncodedAudio,
  language: string,
  textTokens: number[],
  numFrames: number,
  medianWidth = 7,
): Promise<WordTiming[]> {
  if (textTokens.length === 0) return [];
  const sot = sotSequence(cfg, language);
  const tokens = [...sot, cfg.noTimestamps, ...textTokens, cfg.eot];
  const out = await runner.decode(tokens, null, audio, 0, true);
  if (!out.attention) throw new Error("The Whisper decoder does not output cross-attention weights");
  const T = out.frames;
  const nTok = tokens.length;
  const frames = Math.min(T, Math.floor(numFrames / 2));
  const heads = cfg.alignmentHeads;

  // Per head: attention over the window's frames, renormalised (softmax over the
  // truncated frames), standardised over tokens, median-filtered over time.
  const matrix = new Float32Array(nTok * frames);
  const w = new Float32Array(nTok * frames);
  for (const [layer, head] of heads) {
    const att = out.attention[cfg.attentionLayers.indexOf(layer)];
    const base = head * nTok * T;
    for (let t = 0; t < nTok; t++) {
      let sum = 0;
      for (let f = 0; f < frames; f++) sum += att[base + t * T + f];
      for (let f = 0; f < frames; f++) w[t * frames + f] = att[base + t * T + f] / (sum || 1);
    }
    for (let f = 0; f < frames; f++) {
      let mean = 0;
      for (let t = 0; t < nTok; t++) mean += w[t * frames + f];
      mean /= nTok;
      let variance = 0;
      for (let t = 0; t < nTok; t++) variance += (w[t * frames + f] - mean) ** 2;
      const std = Math.sqrt(variance / nTok) || 1;
      for (let t = 0; t < nTok; t++) w[t * frames + f] = (w[t * frames + f] - mean) / std;
    }
    const filtered = medianFilterRows(w, nTok, frames, medianWidth);
    for (let i = 0; i < matrix.length; i++) matrix[i] += filtered[i] / heads.length;
  }

  // Rows of no_timestamps + text tokens (the SOT sequence and the final EOT are dropped).
  const first = sot.length;
  const rows = nTok - first - 1;
  const cost = new Float32Array(rows * frames);
  for (let r = 0; r < rows; r++) for (let f = 0; f < frames; f++) cost[r * frames + f] = -matrix[(first + r) * frames + f];
  const { textIndices, timeIndices } = dtw(cost, rows, frames);

  // Token probabilities from the same pass (rows predicting each text token).
  const probs = textTokens.map((token, i) => {
    const row = out.logits.subarray((first + i) * cfg.nVocab, (first + i) * cfg.nVocab + cfg.eot);
    let max = -Infinity;
    for (let k = 0; k < row.length; k++) if (row[k] > max) max = row[k];
    let sum = 0;
    for (let k = 0; k < row.length; k++) sum += Math.exp(row[k] - max);
    return Math.exp(row[token] - max) / sum;
  });

  const { words, tokens: wordTokens } = tokenizer.splitToWordTokens([...textTokens, cfg.eot], language);
  if (wordTokens.length <= 1) return [];
  const boundaries = [0];
  for (let i = 0; i < wordTokens.length - 1; i++) boundaries.push(boundaries[i] + wordTokens[i].length);
  const jumpTimes: number[] = [];
  for (let k = 0; k < textIndices.length; k++) {
    if (k === 0 || textIndices[k] !== textIndices[k - 1]) jumpTimes.push(timeIndices[k] / FRAMES_PER_SECOND);
  }
  const result: WordTiming[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    const a = boundaries[i];
    const b = boundaries[i + 1];
    const p = probs.slice(a, b);
    result.push({
      word: words[i],
      tokens: wordTokens[i],
      start: jumpTimes[a] ?? 0,
      end: jumpTimes[b] ?? jumpTimes[jumpTimes.length - 1] ?? 0,
      probability: p.length ? p.reduce((s, v) => s + v, 0) / p.length : 0,
    });
  }
  return result;
}

const PREPEND = "\"'“¿([{-";
const APPEND = "\"'.。,，!！?？:：”)]}、";

/** Attaches punctuation to the neighbouring words (whisper.timing.merge_punctuations). */
export function mergePunctuations(alignment: WordTiming[]): WordTiming[] {
  const words = alignment.map((w) => ({ ...w, tokens: [...w.tokens] }));
  // prepend punctuations
  let i = words.length - 2;
  let j = words.length - 1;
  while (i >= 0) {
    const previous = words[i];
    const following = words[j];
    if (previous.word.startsWith(" ") && PREPEND.includes(previous.word.trim()) && previous.word.trim() !== "") {
      following.word = previous.word + following.word;
      following.tokens = [...previous.tokens, ...following.tokens];
      previous.word = "";
      previous.tokens = [];
    } else {
      j = i;
    }
    i--;
  }
  // append punctuations
  i = 0;
  j = 1;
  while (j < words.length) {
    const previous = words[i];
    const following = words[j];
    if (!previous.word.endsWith(" ") && APPEND.includes(following.word) && following.word !== "") {
      previous.word = previous.word + following.word;
      previous.tokens = [...previous.tokens, ...following.tokens];
      following.word = "";
      following.tokens = [];
    } else {
      i = j;
    }
    j++;
  }
  return words.filter((w) => w.word !== "");
}
