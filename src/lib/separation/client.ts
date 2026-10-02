import { DEFAULT_MODEL_SHA256, DEFAULT_MODEL_URL } from "./model";
import type { Backend, BackendPreference, SeparationConfig, WorkerRequest, WorkerResponse } from "./protocol";

export type SeparationStatus =
  | { phase: "model"; loaded: number; total: number; cached: boolean }
  | { phase: "runtime" | "init"; backend: Backend }
  | { phase: "separating"; done: number; total: number; backend: Backend; elapsedMs: number; etaMs: number | null };

export interface SeparationResult {
  stems: Int16Array[];
  frames: number;
  backend: Backend;
  seconds: number;
}

export interface SeparationJob {
  promise: Promise<SeparationResult>;
  cancel(): void;
}

function config(backend: BackendPreference): SeparationConfig {
  const modelUrl = process.env.NEXT_PUBLIC_MODEL_URL || DEFAULT_MODEL_URL;
  const customModel = Boolean(process.env.NEXT_PUBLIC_MODEL_URL);
  return {
    ortBase: `/ort/${process.env.NEXT_PUBLIC_ORT_VERSION}/`,
    modelUrl,
    modelSha256: process.env.NEXT_PUBLIC_MODEL_SHA256 || (customModel ? null : DEFAULT_MODEL_SHA256),
    backend,
  };
}

/**
 * Runs the separation in a dedicated worker. The channel arrays are
 * transferred (and normalized in place there), so the caller must not use
 * them afterwards.
 */
export function startSeparation(
  left: Float32Array,
  right: Float32Array,
  options: { backend?: BackendPreference; onStatus?: (status: SeparationStatus) => void; onFallback?: (reason: string) => void },
): SeparationJob {
  const worker = new Worker(new URL("./separation.worker.ts", import.meta.url), {
    type: "module",
    name: "playalong-separation",
  });
  let settled = false;
  let reject!: (err: Error) => void;
  const promise = new Promise<SeparationResult>((resolve, rej) => {
    reject = rej;
    const started = performance.now();
    let firstSegmentAt = 0;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      switch (msg.type) {
        case "model":
          options.onStatus?.({ phase: "model", loaded: msg.loaded, total: msg.total, cached: msg.cached });
          break;
        case "status":
          options.onStatus?.({ phase: msg.phase, backend: msg.backend });
          break;
        case "fallback":
          options.onFallback?.(msg.reason);
          break;
        case "progress": {
          const now = performance.now();
          // The first segment includes warm-up (shader compilation), so the
          // estimate is based on the segments after it.
          if (msg.done === 1) firstSegmentAt = now;
          const perSegment = msg.done > 1 ? (now - firstSegmentAt) / (msg.done - 1) : null;
          options.onStatus?.({
            phase: "separating",
            done: msg.done,
            total: msg.total,
            backend: msg.backend,
            elapsedMs: now - started,
            etaMs: perSegment !== null ? perSegment * (msg.total - msg.done) : null,
          });
          break;
        }
        case "result":
          settled = true;
          worker.terminate();
          resolve({
            stems: msg.stems,
            frames: msg.frames,
            backend: msg.backend,
            seconds: (performance.now() - started) / 1000,
          });
          break;
        case "error":
          settled = true;
          worker.terminate();
          rej(new Error(msg.message));
          break;
      }
    };
    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      rej(new Error(event.message || "The separation worker crashed"));
    };
  });

  const request: WorkerRequest = { type: "separate", config: config(options.backend ?? "auto"), left, right };
  worker.postMessage(request, [left.buffer, right.buffer]);

  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      worker.terminate();
      const err = new Error("Separation cancelled");
      err.name = "AbortError";
      reject(err);
    },
  };
}
