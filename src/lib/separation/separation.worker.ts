/// <reference lib="webworker" />
import type * as OrtModule from "onnxruntime-web";
import { describeError as describe, loadModel, loadOrt, type Ort } from "../onnx/runtime";
import { separate, type ModelRunner } from "./demucs";
import { BINS, FRAMES, SEGMENT, SOURCES } from "./model";
import { PCM_SCALE, type Backend, type SeparationConfig, type WorkerRequest, type WorkerResponse } from "./protocol";

type Session = OrtModule.InferenceSession;

const worker = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: WorkerResponse, transfer: Transferable[] = []) => worker.postMessage(message, transfer);

/** True if the model produced NaN / Infinity (seen with buggy GPU drivers). */
function hasNonFinite(data: Float32Array, stride: number): boolean {
  for (let i = 0; i < data.length; i += stride) {
    if (!Number.isFinite(data[i])) return true;
  }
  return false;
}

function loadSeparationModel(config: SeparationConfig): Promise<Uint8Array> {
  return loadModel({ url: config.modelUrl, sha256: config.modelSha256 }, (loaded, total, cached) =>
    post({ type: "model", loaded, total, cached }),
  );
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

async function run(request: WorkerRequest) {
  const { config, left, right } = request;
  const frames = left.length;
  const model = await loadSeparationModel(config);

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
