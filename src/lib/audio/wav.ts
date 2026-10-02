import { PCM_SCALE } from "../separation/protocol";

/**
 * Mixes interleaved stereo int16 stems with the given linear gains into a
 * 16-bit stereo WAV file.
 */
export function mixToWav(stems: Int16Array[], gains: number[], frames: number, sampleRate: number): Blob {
  const dataBytes = frames * 4;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 2, true); // stereo
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataBytes, true);

  const out = new Int16Array(buffer, 44, frames * 2);
  const mix = new Float32Array(frames * 2);
  stems.forEach((stem, s) => {
    const g = (gains[s] ?? 0) * (32767 / PCM_SCALE);
    if (g === 0) return;
    for (let i = 0; i < frames * 2; i++) mix[i] += stem[i] * g;
  });
  for (let i = 0; i < mix.length; i++) {
    const v = Math.round(mix[i]);
    out[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
  }
  return new Blob([buffer], { type: "audio/wav" });
}
