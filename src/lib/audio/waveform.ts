import { PCM_SCALE } from "../separation/protocol";

/**
 * Per-stem loudness envelope (RMS per bucket) for the overview display.
 * Returns `stems.length` arrays of `buckets` values in linear amplitude.
 */
export function stemEnvelopes(stems: Int16Array[], frames: number, buckets = 1200): Float32Array[] {
  const perBucket = frames / buckets;
  // Reading every 4th frame is plenty for a loudness envelope.
  const stride = 4;
  return stems.map((stem) => {
    const env = new Float32Array(buckets);
    for (let b = 0; b < buckets; b++) {
      const start = Math.floor(b * perBucket);
      const end = Math.min(frames, Math.floor((b + 1) * perBucket));
      let sum = 0;
      let count = 0;
      for (let f = start; f < end; f += stride) {
        const l = stem[f * 2];
        const r = stem[f * 2 + 1];
        sum += l * l + r * r;
        count += 2;
      }
      env[b] = count ? Math.sqrt(sum / count) / PCM_SCALE : 0;
    }
    return env;
  });
}
