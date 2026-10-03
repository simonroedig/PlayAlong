import type { BtcModel, ChordAnalysis } from "./analyze";
import { CHORD_MODELS } from "./model";
import type { ChordConfig, ChordPhase, ChordWorkerRequest, ChordWorkerResponse } from "./protocol";

export interface ChordJob {
  promise: Promise<{ analysis: ChordAnalysis; seconds: number }>;
  cancel(): void;
}

export const DEFAULT_CHORD_MODELS: BtcModel[] = ["majmin", "large"];

function config(models: BtcModel[]): ChordConfig {
  return {
    ortBase: `/ort/${process.env.NEXT_PUBLIC_ORT_VERSION}/`,
    models: models.map((name) => ({ name, url: CHORD_MODELS[name].url, sha256: CHORD_MODELS[name].sha256 || null })),
  };
}

/**
 * Detects chords, beats and key from separated stems in a dedicated worker.
 * Shared-memory stems are read in place; others are copied.
 */
export function startChordAnalysis(
  stems: Int16Array[],
  frames: number,
  onProgress?: (phase: ChordPhase, fraction: number) => void,
  models: BtcModel[] = DEFAULT_CHORD_MODELS,
): ChordJob {
  const worker = new Worker(new URL("./chords.worker.ts", import.meta.url), { type: "module", name: "playalong-chords" });
  let settled = false;
  let reject!: (err: Error) => void;
  const promise = new Promise<{ analysis: ChordAnalysis; seconds: number }>((resolve, rej) => {
    reject = rej;
    worker.onmessage = (event: MessageEvent<ChordWorkerResponse>) => {
      const msg = event.data;
      if (msg.type === "progress") {
        onProgress?.(msg.phase, msg.fraction);
        return;
      }
      settled = true;
      worker.terminate();
      if (msg.type === "result") resolve({ analysis: msg.analysis, seconds: msg.seconds });
      else rej(new Error(msg.message));
    };
    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      rej(new Error(event.message || "The chord worker crashed"));
    };
  });
  const request: ChordWorkerRequest = { type: "analyze", config: config(models), stems, frames };
  worker.postMessage(request);
  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      worker.terminate();
      const err = new Error("Chord analysis cancelled");
      err.name = "AbortError";
      reject(err);
    },
  };
}
