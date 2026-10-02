export type Backend = "webgpu" | "wasm";
export type BackendPreference = "auto" | Backend;

export interface SeparationConfig {
  /** Directory serving the ONNX Runtime Web bundles, e.g. "/ort/1.30.0/". */
  ortBase: string;
  modelUrl: string;
  /** Expected SHA-256 of the model, or null to skip verification. */
  modelSha256: string | null;
  backend: BackendPreference;
}

export type WorkerRequest = {
  type: "separate";
  config: SeparationConfig;
  left: Float32Array;
  right: Float32Array;
};

export type WorkerResponse =
  | { type: "status"; phase: "runtime" | "init"; backend: Backend }
  | { type: "model"; loaded: number; total: number; cached: boolean }
  | { type: "fallback"; from: Backend; to: Backend; reason: string }
  | { type: "progress"; done: number; total: number; backend: Backend }
  | { type: "result"; stems: Int16Array[]; frames: number; backend: Backend }
  | { type: "error"; message: string };

/**
 * Stems are stored as interleaved 16-bit PCM with 6 dB of headroom
 * (sample = int16 / PCM_SCALE), because separated sources can peak above the
 * mix they were taken from.
 */
export const PCM_SCALE = 16384;
