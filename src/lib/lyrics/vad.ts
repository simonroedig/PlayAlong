/**
 * Where the singing is, from the separated vocal stem: a loudness gate
 * relative to the loudest singing (stem bleed and breaths stay below it),
 * smoothed into regions and packed into Whisper's 30 s windows.
 */

export interface Region {
  /** Seconds. */
  start: number;
  end: number;
}

const FRAME = 0.02;
const STEP = 0.01;

export interface VadOptions {
  /** dB below the loud singing level that still counts as voice. */
  range?: number;
  /** Absolute floor in dBFS. */
  floor?: number;
  minGap?: number;
  minVoice?: number;
  padStart?: number;
  padEnd?: number;
}

/** Frame levels in dB (20 ms frames every 10 ms). */
export function frameLevels(audio: Float32Array, sr: number): Float32Array {
  const size = Math.round(FRAME * sr);
  const step = Math.round(STEP * sr);
  const n = Math.max(0, Math.floor((audio.length - size) / step) + 1);
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    const start = f * step;
    for (let i = start; i < start + size; i++) sum += audio[i] * audio[i];
    out[f] = 10 * Math.log10(sum / size + 1e-12);
  }
  return out;
}

/** Level above which a frame counts as voice (dB), or null for a silent stem. */
export function voiceThreshold(levels: Float32Array, range = 33, floor = -58): number | null {
  const audible = Array.from(levels).filter((v) => v > -90).sort((a, b) => a - b);
  if (audible.length === 0) return null;
  const loud = audible[Math.floor(audible.length * 0.95)];
  return Math.max(floor, loud - range);
}

/** First time in [from, to] where the voice is on, or null. */
export function voiceOnset(levels: Float32Array, threshold: number, from: number, to: number): number | null {
  for (let f = Math.max(0, Math.floor(from / STEP)); f * STEP <= to && f < levels.length; f++) {
    if (levels[f] > threshold) return f * STEP;
  }
  return null;
}

export function voiceRegions(audio: Float32Array, sr: number, options: VadOptions = {}): Region[] {
  const { range = 33, floor = -58, minGap = 0.5, minVoice = 0.15, padStart = 0.25, padEnd = 0.35 } = options;
  const levels = frameLevels(audio, sr);
  if (levels.length === 0) return [];
  const threshold = voiceThreshold(levels, range, floor);
  if (threshold === null) return [];
  const raw: Region[] = [];
  let start = -1;
  levels.forEach((v, f) => {
    if (v > threshold && start < 0) start = f;
    if (v <= threshold && start >= 0) {
      raw.push({ start: start * STEP, end: f * STEP + FRAME });
      start = -1;
    }
  });
  if (start >= 0) raw.push({ start: start * STEP, end: levels.length * STEP + FRAME });

  // Bridge short gaps, drop blips, pad.
  const merged: Region[] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end < minGap) last.end = r.end;
    else merged.push({ ...r });
  }
  const duration = audio.length / sr;
  const padded = merged
    .filter((r) => r.end - r.start >= minVoice)
    .map((r) => ({ start: Math.max(0, r.start - padStart), end: Math.min(duration, r.end + padEnd) }));
  const out: Region[] = [];
  for (const r of padded) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push(r);
  }
  return out;
}

/**
 * Packs voice regions into windows of at most `maxLength` seconds, splitting
 * long stretches of singing at their quietest moment.
 */
export function packWindows(regions: Region[], audio: Float32Array, sr: number, maxLength = 28, maxGap = 6): Region[] {
  const levels = frameLevels(audio, sr);
  const quietest = (from: number, to: number) => {
    let best = to;
    let bestLevel = Infinity;
    // 200 ms average level, searched every 50 ms
    for (let t = from; t <= to; t += 0.05) {
      const f0 = Math.floor(t / STEP);
      let sum = 0;
      let count = 0;
      for (let f = f0; f < f0 + 20 && f < levels.length; f++) {
        sum += levels[f];
        count++;
      }
      const level = count ? sum / count : -120;
      if (level < bestLevel) {
        bestLevel = level;
        best = t + 0.1;
      }
    }
    return best;
  };
  const pieces: Region[] = [];
  for (const r of regions) {
    let start = r.start;
    while (r.end - start > maxLength) {
      const cut = quietest(start + maxLength * 0.55, start + maxLength - 0.2);
      pieces.push({ start, end: cut });
      start = cut;
    }
    pieces.push({ start, end: r.end });
  }
  const windows: Region[] = [];
  for (const p of pieces) {
    const last = windows[windows.length - 1];
    if (last && p.end - last.start <= maxLength && p.start - last.end <= maxGap) last.end = p.end;
    else windows.push({ ...p });
  }
  return windows;
}
