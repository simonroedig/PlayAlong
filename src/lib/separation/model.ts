/**
 * Static description of the separation model shipped with the app:
 * Demucs v4 "htdemucs_6s" (Hybrid Transformer Demucs, 6 sources), exported
 * to ONNX without its STFT / iSTFT. The spectral transforms, segmenting and
 * overlap-add run in TypeScript (see `spectrogram.ts` and `demucs.ts`).
 *
 * ONNX contract:
 *   mix      float32 [1, 2, SEGMENT]            normalized stereo segment
 *   spec     float32 [1, 4, BINS, FRAMES]       complex-as-channels STFT of `mix`
 *   spec_out float32 [1, 6, 4, BINS, FRAMES]   per-source spectrogram (de-normalized)
 *   time_out float32 [1, 6, 2, SEGMENT]        per-source time-branch output (de-normalized)
 */
export const SAMPLE_RATE = 44100;
export const NFFT = 4096;
export const HOP = 1024;
export const BINS = NFFT / 2;
/** Training segment of htdemucs: 7.8 s. */
export const SEGMENT = 343980;
export const FRAMES = Math.ceil(SEGMENT / HOP);

/** Output order of the model. Stored stems keep this order. */
export const SOURCES = ["drums", "bass", "other", "vocals", "guitar", "piano"] as const;
export type SourceName = (typeof SOURCES)[number];

export const MODEL_ID = "htdemucs_6s";
export const MODEL_LABEL = "Demucs v4 · htdemucs_6s";

export const DEFAULT_MODEL_URL = "/models/htdemucs_6s.onnx";
/** SHA-256 of the default model file (checked once after download). */
export const DEFAULT_MODEL_SHA256 = "2ade624b295794eafd697968232622d17c5a47d11a2de1b93fb1c41f2904832b";
