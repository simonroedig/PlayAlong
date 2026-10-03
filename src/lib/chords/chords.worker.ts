/// <reference lib="webworker" />
import type * as OrtModule from "onnxruntime-web";
import { describeError, loadModel, loadOrt } from "../onnx/runtime";
import { analyzeChords, BTC_BINS, BTC_FRAMES, type BtcModel, type ChordModelRunner } from "./analyze";
import type { ChordWorkerRequest, ChordWorkerResponse } from "./protocol";

const worker = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: ChordWorkerResponse) => worker.postMessage(message);

async function run({ config, stems, frames }: ChordWorkerRequest) {
  const started = performance.now();
  post({ type: "progress", phase: "model", fraction: 0 });
  // The recognisers are small; the CPU backend avoids GPU start-up costs.
  const ort = await loadOrt(config.ortBase, "wasm", 4);
  const sessions = new Map<BtcModel, OrtModule.InferenceSession>();
  const loaded = new Map<BtcModel, [number, number]>();
  const report = () => {
    let done = 0;
    let total = 0;
    for (const [l, t] of loaded.values()) {
      done += l;
      total += t;
    }
    if (total > 0) post({ type: "progress", phase: "model", fraction: done / total });
  };
  const bytes = await Promise.all(
    config.models.map((m) =>
      loadModel(m, (l, t) => {
        loaded.set(m.name, [l, t || l]);
        report();
      }),
    ),
  );
  for (let i = 0; i < config.models.length; i++) {
    const session = await ort.InferenceSession.create(bytes[i], {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    sessions.set(config.models[i].name, session);
  }

  const runModel: ChordModelRunner = async (model, features) => {
    const session = sessions.get(model);
    if (!session) throw new Error(`Chord model ${model} is not loaded`);
    const out = await session.run({ features: new ort.Tensor("float32", features, [1, BTC_FRAMES, BTC_BINS]) });
    return out.logits.data as Float32Array;
  };

  let lastPost = 0;
  const analysis = await analyzeChords(
    stems,
    frames,
    runModel,
    { models: config.models.map((m) => m.name) },
    (phase, fraction) => {
      const now = performance.now();
      if (fraction < 1 && now - lastPost < 100) return;
      lastPost = now;
      post({ type: "progress", phase, fraction });
    },
  );
  await Promise.all([...sessions.values()].map((s) => s.release().catch(() => {})));
  post({ type: "result", analysis, seconds: (performance.now() - started) / 1000 });
}

worker.onmessage = (event: MessageEvent<ChordWorkerRequest>) => {
  if (event.data.type !== "analyze") return;
  run(event.data).catch((err) => post({ type: "error", message: describeError(err) }));
};
