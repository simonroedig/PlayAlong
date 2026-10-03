import type { LyricsAnalysis } from "./transcribe";

export type LyricsWorkerPhase = "model" | "load" | "prepare" | "transcribe";

export type LyricsWorkerRequest = {
  type: "transcribe";
  /** Directory serving the ONNX Runtime Web bundles. */
  ortBase: string;
  /** Directory with model.json and the model files. */
  modelBase: string;
  /** The vocal stem: interleaved stereo PCM. */
  vocals: Int16Array;
  frames: number;
  /** ISO code, or null to detect. */
  language: string | null;
};

export type LyricsWorkerResponse =
  | { type: "progress"; phase: LyricsWorkerPhase; fraction: number; loaded?: number; total?: number; cached?: boolean }
  | { type: "result"; lyrics: LyricsAnalysis; seconds: number }
  | { type: "error"; message: string };
