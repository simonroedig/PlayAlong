/// <reference lib="webworker" />
import type * as OrtModule from "onnxruntime-web";
import { separate, type ModelRunner } from "./demucs";
import { BINS, FRAMES, SEGMENT, SOURCES } from "./model";
import { PCM_SCALE, type Backend, type SeparationConfig, type WorkerRequest, type WorkerResponse } from "./protocol";

type Ort = typeof OrtModule;
type Session = OrtModule.InferenceSession;

const worker = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: WorkerResponse, transfer: Transferable[] = []) => worker.postMessage(message, transfer);

const MODEL_CACHE = "playalong-models-v1";

async function loadOrt(base: string, backend: Backend): Promise<Ort> {
  const file = backend === "webgpu" ? "ort.webgpu.bundle.min.mjs" : "ort.wasm.bundle.min.mjs";
  // Served from /public (copied by scripts/setup.mjs), so keep it out of the bundle.
  // The bundles embed their Emscripten glue and find the .wasm next to
  // themselves, so env.wasm.wasmPaths must stay unset.
  const ort: Ort = await import(/* webpackIgnore: true */ `${base}${file}`);
  const cores = navigator.hardwareConcurrency || 4;
  // Threads need SharedArrayBuffer, i.e. a cross-origin isolated page.
  ort.env.wasm.numThreads = worker.crossOriginIsolated ? Math.max(1, Math.min(8, Math.floor(cores * 0.75))) : 1;
  ort.env.logLevel = "error";
  return ort;
}

/** True if the model produced NaN / Infinity (seen with buggy GPU drivers). */
function hasNonFinite(data: Float32Array, stride: number): boolean {
  for (let i = 0; i < data.length; i += stride) {
    if (!Number.isFinite(data[i])) return true;
  }
  return false;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fetches the model once and keeps it in Cache Storage (keyed by its hash). */
async function loadModel(config: SeparationConfig): Promise<Uint8Array> {
  const url = new URL(config.modelUrl, worker.location.href);
  const cacheKey = new URL(url);
  cacheKey.searchParams.set("playalong-sha", config.modelSha256 ?? "unverified");
  let cache: Cache | null = null;
  try {
    cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(cacheKey);
    if (hit) {
      const bytes = new Uint8Array(await hit.arrayBuffer());
      post({ type: "model", loaded: bytes.byteLength, total: bytes.byteLength, cached: true });
      return bytes;
    }
  } catch {
    cache = null; // Cache Storage unavailable (e.g. private mode); just download.
  }

  const res = await fetch(url);
  if (res.status === 404) {
    throw new Error(`Model not found at ${config.modelUrl}. Run \`npm run setup\` to download it.`);
  }
  if (!res.ok || !res.body) throw new Error(`Could not download the model (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let lastPost = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    if (performance.now() - lastPost > 100) {
      lastPost = performance.now();
      post({ type: "model", loaded, total, cached: false });
    }
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  post({ type: "model", loaded, total: loaded, cached: false });
  // crypto.subtle only exists in secure contexts (https or localhost).
  if (config.modelSha256 && crypto.subtle) {
    const digest = await sha256Hex(bytes);
    if (digest !== config.modelSha256) {
      throw new Error("The downloaded model is corrupt (checksum mismatch). Reload to try again.");
    }
  }
  try {
    await cache?.put(cacheKey, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }));
  } catch {
    // Quota exceeded: still usable for this session.
  }
  return bytes;
}

async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

interface Engine {
  ort: Ort;
  session: Session;
  backend: Backend;
}

async function createEngine(config: SeparationConfig, model: Uint8Array, backend: Backend): Promise<Engine> {
  post({ type: "status", phase: "runtime", backend });
  const ort = await loadOrt(config.ortBase, backend);
  post({ type: "status", phase: "init", backend });
  const session = await ort.InferenceSession.create(model, {
    executionProviders: [backend],
    graphOptimizationLevel: "all",
  });
  return { ort, session, backend };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function run(request: WorkerRequest) {
  const { config, left, right } = request;
  const frames = left.length;
  const model = await loadModel(config);

  let engine: Engine | null = null;
  const wantGpu = config.backend !== "wasm" && (config.backend === "webgpu" || (await hasWebGpu()));
  if (wantGpu) {
    try {
      engine = await createEngine(config, model, "webgpu");
    } catch (err) {
      post({ type: "fallback", from: "webgpu", to: "wasm", reason: describe(err) });
    }
  }
  engine ??= await createEngine(config, model, "wasm");

  const runner: ModelRunner = async (mix, spec) => {
    for (;;) {
      const { ort, session } = engine!;
      try {
        const outputs = await session.run({
          mix: new ort.Tensor("float32", mix, [1, 2, SEGMENT]),
          spec: new ort.Tensor("float32", spec, [1, 4, BINS, FRAMES]),
        });
        const specOut = outputs.spec_out.data as Float32Array;
        const timeOut = outputs.time_out.data as Float32Array;
        if (engine!.backend === "webgpu" && (hasNonFinite(timeOut, 1) || hasNonFinite(specOut, 7))) {
          throw new Error("the GPU returned invalid numbers");
        }
        return { specOut, timeOut };
      } catch (err) {
        if (engine!.backend !== "webgpu") throw err;
        // GPU errors (device lost, out of memory, unsupported op) are not
        // fatal: rerun the same segment on the CPU and carry on there.
        post({ type: "fallback", from: "webgpu", to: "wasm", reason: describe(err) });
        await session.release().catch(() => {});
        engine = await createEngine(config, model, "wasm");
      }
    }
  };

  // With cross-origin isolation the stems live in shared memory, so the page
  // and the audio thread can use them without further copies.
  const shared = worker.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined";
  const stems = SOURCES.map(() =>
    shared ? new Int16Array(new SharedArrayBuffer(frames * 4)) : new Int16Array(frames * 2),
  );
  await separate(left, right, runner, {
    onProgress: (done, total) => post({ type: "progress", done, total, backend: engine!.backend }),
    onBlock: (start, length, blocks) => {
      for (let s = 0; s < stems.length; s++) {
        const out = stems[s];
        const l = blocks[s * 2];
        const r = blocks[s * 2 + 1];
        let o = start * 2;
        for (let i = 0; i < length; i++) {
          const a = Math.round(l[i] * PCM_SCALE);
          const b = Math.round(r[i] * PCM_SCALE);
          out[o++] = a > 32767 ? 32767 : a < -32768 ? -32768 : a;
          out[o++] = b > 32767 ? 32767 : b < -32768 ? -32768 : b;
        }
      }
    },
  });
  await engine.session.release().catch(() => {});
  post(
    { type: "result", stems, frames, backend: engine.backend },
    shared ? [] : stems.map((s) => s.buffer as ArrayBuffer),
  );
}

worker.onmessage = (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type !== "separate") return;
  run(event.data).catch((err) => post({ type: "error", message: describe(err) }));
};
