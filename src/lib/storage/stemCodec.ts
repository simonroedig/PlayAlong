import { SAMPLE_RATE } from "../separation/model";
import { packStemChunks, unpackStemChunks, type StemsInfo } from "./songFile";

/**
 * Stems for .playalong files. Raw stems take about 64 MB per minute of music,
 * so they are stored as Opus at 128 kbit/s per stem (about 6 MB per minute for
 * all six) through WebCodecs, which every browser with folder access has.
 * Without WebCodecs they are stored as they are.
 */

const CHANNELS = 2;
const BITRATE = 128_000;
/** Interleaved int16 → float in [-1, 1) and back; independent of the separation's PCM scale. */
const SCALE = 32768;
const BLOCK = 4410;

async function opusSupported(): Promise<boolean> {
  if (typeof AudioEncoder === "undefined" || typeof AudioDecoder === "undefined") return false;
  try {
    const { supported } = await AudioEncoder.isConfigSupported({
      codec: "opus",
      sampleRate: SAMPLE_RATE,
      numberOfChannels: CHANNELS,
      bitrate: BITRATE,
    });
    return !!supported;
  } catch {
    return false;
  }
}

function bytesOf(source: AllowSharedBufferSource): Uint8Array<ArrayBuffer> {
  const view = ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source);
  const copy = new Uint8Array(view.length);
  copy.set(view);
  return copy;
}

/** A stem as one float array per channel, at 44.1 kHz or resampled to `rate`. */
async function planarAt(stem: Int16Array, frames: number, rate: number): Promise<Float32Array[]> {
  const planes = Array.from({ length: CHANNELS }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    planes[0][i] = stem[2 * i] / SCALE;
    planes[1][i] = stem[2 * i + 1] / SCALE;
  }
  if (rate === SAMPLE_RATE) return planes;
  // The browser's resampler, as for decoding.
  const length = Math.ceil((frames * rate) / SAMPLE_RATE);
  const context = new OfflineAudioContext(CHANNELS, length, rate);
  const buffer = context.createBuffer(CHANNELS, Math.max(1, frames), SAMPLE_RATE);
  planes.forEach((plane, c) => buffer.copyToChannel(plane, c));
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  const rendered = await context.startRendering();
  return Array.from({ length: CHANNELS }, (_, c) => rendered.getChannelData(c));
}

async function encodeOpus(stem: Int16Array, frames: number, rate: number): Promise<{ chunks: Uint8Array[]; sampleRate: number }> {
  const planes = await planarAt(stem, frames, rate);
  const total = planes[0].length;
  const block = Math.round((BLOCK * rate) / SAMPLE_RATE);
  const packets: Uint8Array[] = [];
  let description: Uint8Array = new Uint8Array(0);
  let sampleRate = 48000;
  let failure: unknown = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const config = meta?.decoderConfig;
      if (config) {
        sampleRate = config.sampleRate;
        if (config.description) description = bytesOf(config.description);
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      packets.push(data);
    },
    error: (err) => {
      failure = err;
    },
  });
  try {
    encoder.configure({ codec: "opus", sampleRate: rate, numberOfChannels: CHANNELS, bitrate: BITRATE });
    for (let start = 0; start < total; start += block) {
      if (failure) break;
      const n = Math.min(block, total - start);
      const planar = new Float32Array(n * CHANNELS);
      planar.set(planes[0].subarray(start, start + n), 0);
      planar.set(planes[1].subarray(start, start + n), n);
      encoder.encode(
        new AudioData({
          format: "f32-planar",
          sampleRate: rate,
          numberOfFrames: n,
          numberOfChannels: CHANNELS,
          timestamp: Math.round((start / rate) * 1e6),
          data: planar,
        }),
      );
      // Keep the queue (and memory) bounded.
      if (encoder.encodeQueueSize > 64) await encoder.flush();
    }
    if (!failure) await encoder.flush();
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
  if (failure) throw failure;
  if (packets.length === 0) throw new Error("The Opus encoder produced nothing");
  return { chunks: [description, ...packets], sampleRate };
}

export async function encodeStems(
  stems: Int16Array[],
  frames: number,
  onProgress?: (done: number, total: number) => void,
): Promise<{ info: StemsInfo; data: Blob }> {
  if (await opusSupported()) {
    // Some browsers say they support Opus at 44.1 kHz and then refuse it: try 48 kHz (Opus's own rate) next.
    for (const rate of [SAMPLE_RATE, 48000]) {
      try {
        const all: Uint8Array[][] = [];
        let sampleRate = rate;
        for (const [i, stem] of stems.entries()) {
          const encoded = await encodeOpus(stem, frames, rate);
          all.push(encoded.chunks);
          sampleRate = encoded.sampleRate;
          onProgress?.(i + 1, stems.length);
        }
        return { info: { codec: "opus", count: stems.length, channels: CHANNELS, frames, sampleRate }, data: packStemChunks(all) };
      } catch (err) {
        console.warn(`Opus at ${rate} Hz failed, trying the next way`, err);
      }
    }
  }
  // Uncompressed (bigger files, but always works). Blob() rejects views on shared memory: copy.
  const raw = stems.map((stem) => [new Uint8Array(stem.slice(0, frames * CHANNELS).buffer)]);
  onProgress?.(stems.length, stems.length);
  return { info: { codec: "pcm16", count: stems.length, channels: CHANNELS, frames, sampleRate: SAMPLE_RATE }, data: packStemChunks(raw) };
}

async function decodeOpus(chunks: Uint8Array[], info: StemsInfo): Promise<Int16Array> {
  const [description, ...packets] = chunks;
  const expected = Math.ceil((info.frames * info.sampleRate) / SAMPLE_RATE) + info.sampleRate;
  const planes = Array.from({ length: info.channels }, () => new Float32Array(expected));
  let length = 0;
  let failure: unknown = null;
  const decoder = new AudioDecoder({
    output: (audio) => {
      const n = Math.min(audio.numberOfFrames, expected - length);
      if (n > 0) {
        for (let c = 0; c < info.channels; c++) {
          const plane = new Float32Array(audio.numberOfFrames);
          audio.copyTo(plane, { planeIndex: c, format: "f32-planar" });
          planes[c].set(plane.subarray(0, n), length);
        }
        length += n;
      }
      audio.close();
    },
    error: (err) => {
      failure = err;
    },
  });
  decoder.configure({
    codec: "opus",
    sampleRate: info.sampleRate,
    numberOfChannels: info.channels,
    ...(description.length ? { description } : {}),
  });
  packets.forEach((data, i) => decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: i * 20_000, data })));
  await decoder.flush();
  decoder.close();
  if (failure) throw failure;

  // Back to 44.1 kHz with the browser's resampler.
  const context = new OfflineAudioContext(info.channels, info.frames, SAMPLE_RATE);
  const buffer = context.createBuffer(info.channels, Math.max(1, length), info.sampleRate);
  for (let c = 0; c < info.channels; c++) buffer.copyToChannel(planes[c].subarray(0, Math.max(1, length)), c);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  const rendered = await context.startRendering();
  const out = new Int16Array(info.frames * info.channels);
  for (let c = 0; c < info.channels; c++) {
    const data = rendered.getChannelData(c);
    for (let i = 0; i < info.frames; i++) {
      const v = Math.round(data[i] * SCALE);
      out[i * info.channels + c] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    }
  }
  return out;
}

export async function decodeStems(
  info: StemsInfo,
  data: Blob,
  onProgress?: (done: number, total: number) => void,
): Promise<Int16Array[]> {
  const stems = unpackStemChunks(await data.arrayBuffer(), info.count);
  const out: Int16Array[] = [];
  for (const [i, chunks] of stems.entries()) {
    if (info.codec === "pcm16") {
      const bytes = chunks[0];
      out.push(new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    } else {
      if (typeof AudioDecoder === "undefined") throw new Error("This browser can't decode the stems in this song file");
      out.push(await decodeOpus(chunks, info));
    }
    onProgress?.(i + 1, stems.length);
  }
  return out;
}
