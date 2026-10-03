import type { BtcModel, ChordAnalysis } from "./analyze";

export interface ChordConfig {
  /** Directory serving the ONNX Runtime Web bundles, e.g. "/ort/1.30.0/". */
  ortBase: string;
  models: { name: BtcModel; url: string; sha256: string | null }[];
}

export type ChordPhase = "model" | "prepare" | "recognise" | "decode";

export type ChordWorkerRequest = {
  type: "analyze";
  config: ChordConfig;
  /** Interleaved stereo PCM per source, model order. */
  stems: Int16Array[];
  frames: number;
};

export type ChordWorkerResponse =
  | { type: "progress"; phase: ChordPhase; fraction: number }
  | { type: "result"; analysis: ChordAnalysis; seconds: number }
  | { type: "error"; message: string };
