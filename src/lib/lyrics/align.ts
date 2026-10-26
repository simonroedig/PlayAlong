import { PCM_SCALE } from "../separation/protocol";
import type { LyricLine } from "./transcribe";
import { voiceThreshold } from "./vad";

/**
 * Whisper's word timestamps glue each word to the end of the one before: a
 * pause in the middle of a line is counted into the next word, so it would
 * light up while the singer is still silent. This moves word starts to where
 * the voice actually comes back in, using the separated vocal stem.
 */

const STEP = 0.01;
const FRAME = 0.02;

/** Loudness of the vocal stem (interleaved stereo PCM) in dB, every 10 ms. */
export function voiceLevels(stem: Int16Array, frames: number, sampleRate: number): Float32Array {
  const size = Math.round(FRAME * sampleRate);
  const step = Math.round(STEP * sampleRate);
  const n = Math.max(0, Math.floor((frames - size) / step) + 1);
  const out = new Float32Array(n);
  const scale = PCM_SCALE / 2;
  for (let f = 0; f < n; f++) {
    let sum = 0;
    const start = f * step;
    for (let i = start; i < start + size; i++) {
      const v = (stem[2 * i] + stem[2 * i + 1]) * scale;
      sum += v * v;
    }
    out[f] = 10 * Math.log10(sum / size + 1e-12);
  }
  return out;
}

/** The first silent stretch of at least `minSilence` seconds in [from, to): its start and where the voice returns. */
function pauseIn(levels: Float32Array, threshold: number, from: number, to: number, minSilence: number): { silence: number; voice: number } | null {
  const f0 = Math.max(0, Math.round(from / STEP));
  const f1 = Math.min(levels.length, Math.round(to / STEP));
  const need = Math.round(minSilence / STEP);
  for (let f = f0; f < f1; f++) {
    if (levels[f] > threshold) continue;
    let e = f;
    while (e < f1 && levels[e] <= threshold) e++;
    if (e - f >= need && e < f1) return { silence: f * STEP, voice: e * STEP };
    f = e;
  }
  return null;
}

/**
 * Word timings that follow the voice: when a word's span starts with a
 * pause, the word starts after it, and the word before lasts until the
 * pause begins.
 */
export function alignToVoice(lines: readonly LyricLine[], levels: Float32Array, minPause = 0.2): LyricLine[] {
  const threshold = voiceThreshold(levels);
  if (threshold === null) return [...lines];
  const round = (t: number) => Math.round(t * 1000) / 1000;
  return lines.map((line) => {
    const words = line.words.map((w) => ({ ...w }));
    for (let k = 0; k < words.length; k++) {
      const w = words[k];
      // Only look at the first part of the word: the voice has to come back before it ends.
      const pause = pauseIn(levels, threshold, w.start, w.end - 0.06, minPause);
      if (!pause) continue;
      const prev = words[k - 1];
      w.start = round(pause.voice);
      if (prev) prev.end = round(Math.min(Math.max(prev.end, pause.silence), w.start));
    }
    return { ...line, words, start: words[0]?.start ?? line.start, end: words[words.length - 1]?.end ?? line.end };
  });
}
