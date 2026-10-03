import type { WhisperTokenizer } from "./tokenizer";

/**
 * Whisper decoding as in openai-whisper (decoding.py / transcribe.py):
 * language detection, greedy or sampled decoding with the timestamp rules,
 * and splitting the result into timestamped segments.
 */

export interface WhisperConfig {
  nMels: number;
  nTextLayer: number;
  nTextCtx: number;
  nTextState: number;
  nTextHead: number;
  nVocab: number;
  sot: number;
  eot: number;
  transcribe: number;
  translate: number;
  sotPrev: number;
  sotLm: number;
  noSpeech: number;
  noTimestamps: number;
  blank: number;
  languages: string[];
  languageTokens: number[];
  nonSpeechTokens: number[];
  /** (decoder layer, head) pairs whose cross-attention follows the audio. */
  alignmentHeads: [number, number][];
  /** Decoder layers whose cross-attention weights the model outputs, in output order. */
  attentionLayers: number[];
}

/** Opaque handles owned by the runner (ONNX tensors). */
export type EncodedAudio = unknown;
export type DecoderCache = unknown;

export interface DecoderOutput {
  /** [tokens × vocab] */
  logits: Float32Array;
  cache: DecoderCache;
  /** Per exposed layer: [heads × tokens × audio frames], when requested. */
  attention: Float32Array[] | null;
  /** Audio frames (1500 for 30 s). */
  frames: number;
}

export interface WhisperRunner {
  /** mel: [nMels × 3000] */
  encode(mel: Float32Array): Promise<EncodedAudio>;
  decode(tokens: number[], cache: DecoderCache | null, audio: EncodedAudio, offset: number, attention: boolean): Promise<DecoderOutput>;
}

/** Seconds per timestamp token. */
export const TIME_PRECISION = 0.02;
const MAX_INITIAL_TIMESTAMP_INDEX = 50;

export const timestampBegin = (cfg: WhisperConfig) => cfg.noTimestamps + 1;

export function sotSequence(cfg: WhisperConfig, language: string): number[] {
  const i = cfg.languages.indexOf(language);
  if (i < 0) throw new Error(`Unsupported language: ${language}`);
  return [cfg.sot, cfg.languageTokens[i], cfg.transcribe];
}

function logSoftmax(logits: Float32Array, out: Float64Array) {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
  let sum = 0;
  for (let i = 0; i < logits.length; i++) sum += Math.exp(logits[i] - max);
  const lse = max + Math.log(sum);
  for (let i = 0; i < logits.length; i++) out[i] = logits[i] - lse;
}

/** Language probabilities from the first decoder step (whisper.decoding.detect_language). */
export async function detectLanguage(runner: WhisperRunner, cfg: WhisperConfig, audio: EncodedAudio): Promise<Map<string, number>> {
  const { logits } = await runner.decode([cfg.sot], null, audio, 0, false);
  const row = logits.subarray(0, cfg.nVocab);
  let max = -Infinity;
  for (const t of cfg.languageTokens) max = Math.max(max, row[t]);
  let sum = 0;
  for (const t of cfg.languageTokens) sum += Math.exp(row[t] - max);
  const probs = new Map<string, number>();
  cfg.languages.forEach((code, i) => probs.set(code, Math.exp(row[cfg.languageTokens[i]] - max) / sum));
  return probs;
}

export class LogitFilters {
  private readonly suppress: number[];
  private readonly tsBegin: number;

  constructor(
    private readonly cfg: WhisperConfig,
    private readonly sampleBegin: number,
  ) {
    this.tsBegin = timestampBegin(cfg);
    this.suppress = [...new Set([...cfg.nonSpeechTokens, cfg.transcribe, cfg.translate, cfg.sot, cfg.sotPrev, cfg.sotLm, cfg.noSpeech])];
  }

  /** Applies SuppressBlank, SuppressTokens and ApplyTimestampRules in place. `tokens` includes the SOT sequence. */
  apply(logits: Float32Array, tokens: readonly number[]) {
    const { cfg, sampleBegin, tsBegin } = this;
    const n = logits.length;
    if (tokens.length === sampleBegin) {
      logits[cfg.blank] = -Infinity;
      logits[cfg.eot] = -Infinity;
    }
    for (const t of this.suppress) logits[t] = -Infinity;

    // ApplyTimestampRules
    logits[cfg.noTimestamps] = -Infinity;
    const seq = tokens.slice(sampleBegin);
    const lastWasTimestamp = seq.length >= 1 && seq[seq.length - 1] >= tsBegin;
    const penultimateWasTimestamp = seq.length < 2 || seq[seq.length - 2] >= tsBegin;
    if (lastWasTimestamp) {
      if (penultimateWasTimestamp) for (let i = tsBegin; i < n; i++) logits[i] = -Infinity;
      else for (let i = 0; i < cfg.eot; i++) logits[i] = -Infinity;
    }
    let lastTimestamp = -1;
    for (const t of seq) if (t >= tsBegin) lastTimestamp = t;
    if (lastTimestamp >= 0) {
      // Timestamps must not decrease, and segments must not be empty.
      const limit = lastWasTimestamp && !penultimateWasTimestamp ? lastTimestamp : lastTimestamp + 1;
      for (let i = tsBegin; i < limit; i++) logits[i] = -Infinity;
    }
    if (tokens.length === sampleBegin) {
      for (let i = 0; i < tsBegin; i++) logits[i] = -Infinity;
      for (let i = tsBegin + MAX_INITIAL_TIMESTAMP_INDEX + 1; i < n; i++) logits[i] = -Infinity;
    }
    // If timestamps are jointly more likely than any text token, force a timestamp.
    const logprobs = new Float64Array(n);
    logSoftmax(logits, logprobs);
    let maxTs = -Infinity;
    for (let i = tsBegin; i < n; i++) maxTs = Math.max(maxTs, logprobs[i]);
    let sumTs = 0;
    for (let i = tsBegin; i < n; i++) sumTs += Math.exp(logprobs[i] - maxTs);
    const timestampLogprob = maxTs + Math.log(sumTs);
    let maxText = -Infinity;
    for (let i = 0; i < tsBegin; i++) maxText = Math.max(maxText, logprobs[i]);
    if (timestampLogprob > maxText) for (let i = 0; i < tsBegin; i++) logits[i] = -Infinity;
  }
}

/** Deterministic PRNG for temperature sampling. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DecodeResult {
  /** Sampled tokens after the SOT sequence, without the final end-of-text. */
  tokens: number[];
  sumLogprob: number;
  avgLogprob: number;
  noSpeechProb: number;
  temperature: number;
  text: string;
  compressionRatio: number;
}

async function compressionRatio(text: string): Promise<number> {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length === 0) return 0;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  const compressed = await new Response(stream).arrayBuffer();
  return bytes.length / compressed.byteLength;
}

/** One decoding pass over a 30 s window (whisper.decoding.DecodingTask, beam size 1). */
export async function decodeWindow(
  runner: WhisperRunner,
  cfg: WhisperConfig,
  tokenizer: WhisperTokenizer,
  audio: EncodedAudio,
  language: string,
  temperature = 0,
  seed = 0,
): Promise<DecodeResult> {
  const initial = sotSequence(cfg, language);
  const sampleBegin = initial.length;
  const filters = new LogitFilters(cfg, sampleBegin);
  const maxTokens = Math.floor(cfg.nTextCtx / 2);
  const random = mulberry32(seed + 1);
  const tokens = [...initial];
  let feed = [...initial];
  let cache: DecoderCache | null = null;
  let offset = 0;
  let sumLogprob = 0;
  let noSpeechProb = 0;
  const logprobs = new Float64Array(cfg.nVocab);
  for (let step = 0; step < maxTokens; step++) {
    const out = await runner.decode(feed, cache, audio, offset, false);
    cache = out.cache;
    if (step === 0) {
      // P(no speech) at the start-of-transcript position.
      const sotRow = out.logits.subarray(0, cfg.nVocab);
      const tmp = new Float64Array(cfg.nVocab);
      logSoftmax(sotRow, tmp);
      noSpeechProb = Math.exp(tmp[cfg.noSpeech]);
    }
    offset += feed.length;
    const last = out.logits.slice((feed.length - 1) * cfg.nVocab, feed.length * cfg.nVocab);
    filters.apply(last, tokens);
    logSoftmax(last, logprobs);
    let next = 0;
    if (temperature === 0) {
      for (let i = 1; i < last.length; i++) if (last[i] > last[next]) next = i;
    } else {
      // Categorical(logits / T)
      let max = -Infinity;
      for (let i = 0; i < last.length; i++) if (last[i] / temperature > max) max = last[i] / temperature;
      let sum = 0;
      for (let i = 0; i < last.length; i++) sum += Math.exp(last[i] / temperature - max);
      let r = random() * sum;
      for (next = 0; next < last.length - 1; next++) {
        r -= Math.exp(last[next] / temperature - max);
        if (r <= 0 && Number.isFinite(last[next])) break;
      }
    }
    sumLogprob += logprobs[next];
    if (next === cfg.eot) break;
    tokens.push(next);
    feed = [next];
  }
  const sampled = tokens.slice(sampleBegin);
  const text = tokenizer.decode(sampled);
  return {
    tokens: sampled,
    sumLogprob,
    avgLogprob: sumLogprob / (sampled.length + 1),
    noSpeechProb,
    temperature,
    text,
    compressionRatio: await compressionRatio(text),
  };
}

export interface Segment {
  /** Seconds, relative to the window start. */
  start: number;
  end: number;
  /** Tokens including the surrounding timestamp tokens. */
  tokens: number[];
}

/**
 * Splits decoded tokens at consecutive timestamp tokens (whisper.transcribe)
 * and returns where to continue: the end of the window if the last segment
 * finished, otherwise the start of the unfinished one.
 */
export function splitSegments(cfg: WhisperConfig, tokens: number[], windowSeconds: number): { segments: Segment[]; consumed: number } {
  const tsBegin = timestampBegin(cfg);
  const isTs = tokens.map((t) => t >= tsBegin);
  const singleTimestampEnding = tokens.length >= 2 && !isTs[tokens.length - 2] && isTs[tokens.length - 1];
  const consecutive: number[] = [];
  for (let i = 0; i + 1 < tokens.length; i++) if (isTs[i] && isTs[i + 1]) consecutive.push(i + 1);
  const segments: Segment[] = [];
  if (consecutive.length > 0) {
    const slices = [...consecutive];
    if (singleTimestampEnding) slices.push(tokens.length);
    let last = 0;
    for (const current of slices) {
      const sliced = tokens.slice(last, current);
      segments.push({
        start: (sliced[0] - tsBegin) * TIME_PRECISION,
        end: (sliced[sliced.length - 1] - tsBegin) * TIME_PRECISION,
        tokens: sliced,
      });
      last = current;
    }
    if (singleTimestampEnding) return { segments, consumed: windowSeconds };
    return { segments, consumed: (tokens[last - 1] - tsBegin) * TIME_PRECISION };
  }
  let duration = windowSeconds;
  const timestamps = tokens.filter((t) => t >= tsBegin);
  if (timestamps.length > 0 && timestamps[timestamps.length - 1] !== tsBegin) {
    duration = (timestamps[timestamps.length - 1] - tsBegin) * TIME_PRECISION;
  }
  if (tokens.some((t) => t < cfg.eot)) segments.push({ start: 0, end: duration, tokens });
  return { segments, consumed: windowSeconds };
}
