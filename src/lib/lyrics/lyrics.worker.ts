/// <reference lib="webworker" />
import { describeError, loadModel, loadOrt } from "../onnx/runtime";
import { whisperConfig, type LyricsModelManifest } from "./model";
import type { LyricsWorkerRequest, LyricsWorkerResponse } from "./protocol";
import { transcribeLyrics, vocalStemAt16k } from "./transcribe";
import { createWhisperRunner } from "./whisper/runner";
import { WhisperTokenizer } from "./whisper/tokenizer";

const worker = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: LyricsWorkerResponse) => worker.postMessage(message);

async function fetchManifest(base: string): Promise<LyricsModelManifest> {
  const res = await fetch(new URL("model.json", new URL(base, worker.location.href)));
  if (res.status === 404) throw new Error("The lyrics model is not installed. Run `npm run setup` to download it.");
  if (!res.ok) throw new Error(`Could not load the lyrics model (HTTP ${res.status})`);
  return res.json();
}

async function run({ ortBase, modelBase, vocals, frames, language }: LyricsWorkerRequest) {
  const started = performance.now();
  post({ type: "progress", phase: "model", fraction: 0 });
  const manifest = await fetchManifest(modelBase);
  const base = new URL(modelBase, worker.location.href);
  const url = (file: string) => new URL(file, base).href;
  const cfg = whisperConfig(manifest);

  // Both halves of the model download together; report their combined progress.
  const total = manifest.bytes.encoder + manifest.bytes.decoder;
  const loaded = { encoder: 0, decoder: 0 };
  let cachedParts = 0;
  let lastPost = 0;
  const report = (part: "encoder" | "decoder") => (bytes: number, _total: number, cached: boolean) => {
    loaded[part] = bytes;
    if (cached) cachedParts++;
    const now = performance.now();
    if (now - lastPost < 150 && bytes < manifest.bytes[part]) return;
    lastPost = now;
    const sum = loaded.encoder + loaded.decoder;
    post({ type: "progress", phase: "model", fraction: sum / total, loaded: sum, total, cached: cachedParts === 2 });
  };
  const [tokensRes, ort, encoderBytes, decoderBytes] = await Promise.all([
    fetch(url(manifest.files.tokens)),
    loadOrt(ortBase, "wasm", 4),
    loadModel({ url: url(manifest.files.encoder), sha256: manifest.sha256.encoder }, report("encoder")),
    loadModel({ url: url(manifest.files.decoder), sha256: manifest.sha256.decoder }, report("decoder")),
  ]);
  const tokenizer = new WhisperTokenizer(await tokensRes.text(), cfg.eot);

  post({ type: "progress", phase: "load", fraction: 0 });
  const options = { executionProviders: ["wasm"], graphOptimizationLevel: "all" as const };
  const encoder = await ort.InferenceSession.create(encoderBytes, options);
  post({ type: "progress", phase: "load", fraction: 0.6 });
  const decoder = await ort.InferenceSession.create(decoderBytes, options);
  post({ type: "progress", phase: "load", fraction: 1 });

  const runner = createWhisperRunner(ort, encoder, decoder, cfg, manifest.attentionOutputs);
  const audio = vocalStemAt16k(vocals, frames);
  let lastProgress = 0;
  const lyrics = await transcribeLyrics(audio, runner, cfg, tokenizer, manifest.name, { language }, (phase, fraction) => {
    const now = performance.now();
    if (fraction < 1 && now - lastProgress < 200) return;
    lastProgress = now;
    post({ type: "progress", phase, fraction });
  });
  await Promise.all([encoder.release().catch(() => {}), decoder.release().catch(() => {})]);
  post({ type: "result", lyrics, seconds: (performance.now() - started) / 1000 });
}

worker.onmessage = (event: MessageEvent<LyricsWorkerRequest>) => {
  if (event.data.type !== "transcribe") return;
  run(event.data).catch((err) => post({ type: "error", message: describeError(err) }));
};
