import { LYRICS_MODEL_BASE } from "./model";
import type { LyricsWorkerPhase, LyricsWorkerRequest, LyricsWorkerResponse } from "./protocol";
import type { LyricsAnalysis } from "./transcribe";

export interface LyricsProgressInfo {
  phase: LyricsWorkerPhase;
  fraction: number;
  /** Model download, in bytes. */
  loaded?: number;
  total?: number;
  cached?: boolean;
}

export interface LyricsJob {
  promise: Promise<{ lyrics: LyricsAnalysis; seconds: number }>;
  cancel(): void;
}

const VOCALS = 3;

/** Transcribes the vocal stem in a dedicated worker. */
export function startLyricsTranscription(
  stems: Int16Array[],
  frames: number,
  language: string | null,
  onProgress?: (progress: LyricsProgressInfo) => void,
): LyricsJob {
  const worker = new Worker(new URL("./lyrics.worker.ts", import.meta.url), { type: "module", name: "playalong-lyrics" });
  let settled = false;
  let reject!: (err: Error) => void;
  const promise = new Promise<{ lyrics: LyricsAnalysis; seconds: number }>((resolve, rej) => {
    reject = rej;
    worker.onmessage = (event: MessageEvent<LyricsWorkerResponse>) => {
      const msg = event.data;
      if (msg.type === "progress") {
        onProgress?.({ phase: msg.phase, fraction: msg.fraction, loaded: msg.loaded, total: msg.total, cached: msg.cached });
        return;
      }
      settled = true;
      worker.terminate();
      if (msg.type === "result") resolve({ lyrics: msg.lyrics, seconds: msg.seconds });
      else rej(new Error(msg.message));
    };
    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      rej(new Error(event.message || "The lyrics worker crashed (out of memory?)"));
    };
  });
  const request: LyricsWorkerRequest = {
    type: "transcribe",
    ortBase: `/ort/${process.env.NEXT_PUBLIC_ORT_VERSION}/`,
    modelBase: LYRICS_MODEL_BASE,
    vocals: stems[VOCALS],
    frames,
    language,
  };
  worker.postMessage(request);
  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      worker.terminate();
      const err = new Error("Lyrics transcription cancelled");
      err.name = "AbortError";
      reject(err);
    },
  };
}
