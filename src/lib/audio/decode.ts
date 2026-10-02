import { SAMPLE_RATE } from "../separation/model";

export interface DecodedAudio {
  left: Float32Array;
  right: Float32Array;
  frames: number;
}

/**
 * Decodes any format the browser understands (MP3, AAC/M4A, Opus, FLAC, WAV…)
 * to stereo float PCM at the model's 44.1 kHz. Mono files are duplicated,
 * extra channels are ignored. `data` is detached by the decoder.
 */
export async function decodeAudio(data: ArrayBuffer): Promise<DecodedAudio> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: SAMPLE_RATE });
  let buffer: AudioBuffer;
  try {
    buffer = await ctx.decodeAudioData(data);
  } catch {
    throw new Error("This file could not be decoded. Try MP3, M4A, WAV, FLAC or OGG.");
  }
  if (buffer.length === 0) throw new Error("The audio is empty");
  const left = buffer.getChannelData(0).slice();
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : left.slice();
  return { left, right, frames: buffer.length };
}
