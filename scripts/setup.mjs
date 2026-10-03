#!/usr/bin/env node
/**
 * Prepares the large / platform-specific assets that are not committed:
 *
 *   1. ONNX Runtime Web bundles + WebAssembly -> public/ort/<version>/
 *      (copied from node_modules so they are served same-origin, which the
 *      cross-origin-isolated pages require)
 *   2. The separation model -> public/models/htdemucs_6s.onnx
 *      (downloaded once and verified against a pinned SHA-256)
 *   3. The lyrics model -> public/models/whisper-turbo/
 *      (Whisper large-v3 turbo, int8 ONNX by sherpa-onnx; downloaded once,
 *      verified, and its decoder made to output cross-attention weights,
 *      which word timestamps need)
 *   4. yt-dlp -> .bin/yt-dlp (official standalone build for this platform)
 *
 * Idempotent: finished steps are skipped. Runs automatically before
 * `npm run dev` / `npm run build`.
 *
 *   node scripts/setup.mjs              all steps
 *   node scripts/setup.mjs --update     also update yt-dlp to the latest release
 *   PLAYALONG_SKIP_DOWNLOADS=1          skip steps 2–4 (e.g. in CI)
 *   PLAYALONG_SKIP_LYRICS_MODEL=1       skip only the lyrics model (~560 MB download, 1 GB on disk)
 *
 * Behind an HTTP(S) proxy, run with NODE_USE_ENV_PROXY=1 so fetch honours it.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addGraphOutputs, crossAttentionOutputs, onnxMetadata } from "./lib/onnx-proto.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const skipDownloads = process.env.PLAYALONG_SKIP_DOWNLOADS === "1";

const MODEL = {
  file: path.join(root, "public", "models", "htdemucs_6s.onnx"),
  // Demucs v4 htdemucs_6s (Meta, MIT) exported to ONNX without its STFT.
  // Rebuild it from Meta's original weights with scripts/export_model.py.
  url:
    process.env.PLAYALONG_MODEL_SOURCE_URL ??
    "https://github.com/GamerNationinc/GgMusicMaker/releases/download/models-v1/htdemucs_6s.onnx",
  sha256: "2ade624b295794eafd697968232622d17c5a47d11a2de1b93fb1c41f2904832b",
};

const LYRICS_MODEL = {
  dir: path.join(root, "public", "models", "whisper-turbo"),
  name: "whisper-large-v3-turbo",
  // OpenAI Whisper large-v3 turbo (MIT), int8 ONNX export by k2-fsa/sherpa-onnx (Apache-2.0).
  url:
    process.env.PLAYALONG_LYRICS_MODEL_SOURCE_URL ??
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-turbo.tar.bz2",
  sha256: "b11acbbcd660b44a8e0df33724feb5aaa709cf65668f2823d59f656312544f22",
  members: {
    encoder: "sherpa-onnx-whisper-turbo/turbo-encoder.int8.onnx",
    decoder: "sherpa-onnx-whisper-turbo/turbo-decoder.int8.onnx",
    tokens: "sherpa-onnx-whisper-turbo/turbo-tokens.txt",
  },
  // openai-whisper's _ALIGNMENT_HEADS["large-v3-turbo"]: (decoder layer, head)
  alignmentHeads: [
    [2, 4],
    [2, 11],
    [3, 3],
    [3, 6],
    [3, 11],
    [3, 14],
  ],
};

const log = (msg) => console.log(`\x1b[36m[setup]\x1b[0m ${msg}`);
const warn = (msg) => console.warn(`\x1b[33m[setup]\x1b[0m ${msg}`);

function copyOrtRuntime() {
  const ortDir = path.join(root, "node_modules", "onnxruntime-web");
  const { version } = JSON.parse(fs.readFileSync(path.join(ortDir, "package.json"), "utf8"));
  const target = path.join(root, "public", "ort", version);
  const files = [
    // WebGPU execution provider (+ CPU kernels)
    "ort.webgpu.bundle.min.mjs",
    "ort-wasm-simd-threaded.asyncify.wasm",
    // CPU-only fallback (smaller, no asyncify overhead)
    "ort.wasm.bundle.min.mjs",
    "ort-wasm-simd-threaded.wasm",
  ];
  const missing = files.filter((f) => !fs.existsSync(path.join(target, f)));
  if (missing.length === 0) return;
  // Drop runtimes of other versions so stale files are not served.
  const ortRoot = path.join(root, "public", "ort");
  if (fs.existsSync(ortRoot)) {
    for (const entry of fs.readdirSync(ortRoot)) {
      if (entry !== version) fs.rmSync(path.join(ortRoot, entry), { recursive: true, force: true });
    }
  }
  fs.mkdirSync(target, { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(ortDir, "dist", f), path.join(target, f));
  log(`ONNX Runtime Web ${version} copied to public/ort/${version}/`);
}

async function sha256File(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    fs.createReadStream(file).on("data", (d) => hash.update(d)).on("end", resolve).on("error", reject);
  });
  return hash.digest("hex");
}

async function download(url, dest, label) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`${label}: HTTP ${res.status} for ${url}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const tmp = `${dest}.part`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const out = fs.createWriteStream(tmp);
  let received = 0;
  let lastPrint = 0;
  for await (const chunk of res.body) {
    received += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
    const now = Date.now();
    if (process.stdout.isTTY && now - lastPrint > 250) {
      lastPrint = now;
      const pct = total ? ` ${((received / total) * 100).toFixed(0)}%` : "";
      process.stdout.write(`\r\x1b[36m[setup]\x1b[0m ${label}: ${(received / 1e6).toFixed(1)} MB${pct}   `);
    }
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  if (process.stdout.isTTY) process.stdout.write("\n");
  return tmp;
}

async function ensureModel() {
  if (fs.existsSync(MODEL.file)) return;
  if (skipDownloads) {
    warn("model missing and downloads are disabled (PLAYALONG_SKIP_DOWNLOADS=1)");
    return;
  }
  log("downloading the separation model (Demucs v4 htdemucs_6s, ~115 MB, one time)…");
  const tmp = await download(MODEL.url, MODEL.file, "model");
  const digest = await sha256File(tmp);
  if (process.env.PLAYALONG_MODEL_SOURCE_URL === undefined && digest !== MODEL.sha256) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`model checksum mismatch: expected ${MODEL.sha256}, got ${digest}`);
  }
  fs.renameSync(tmp, MODEL.file);
  log(`model saved to public/models/ (sha256 ${digest.slice(0, 12)}…)`);
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function ensureLyricsModel() {
  const manifest = path.join(LYRICS_MODEL.dir, "model.json");
  if (fs.existsSync(manifest)) return;
  if (skipDownloads || process.env.PLAYALONG_SKIP_LYRICS_MODEL === "1") {
    warn("lyrics model missing and its download is disabled");
    return;
  }
  log("downloading the lyrics model (Whisper large-v3 turbo, ~560 MB, one time)…");
  const archive = path.join(root, "public", "models", "whisper-turbo.tar.bz2");
  const tmp = await download(LYRICS_MODEL.url, archive, "lyrics model");
  const digest = await sha256File(tmp);
  if (process.env.PLAYALONG_LYRICS_MODEL_SOURCE_URL === undefined && digest !== LYRICS_MODEL.sha256) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`lyrics model checksum mismatch: expected ${LYRICS_MODEL.sha256}, got ${digest}`);
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "playalong-whisper-"));
  try {
    log("unpacking the lyrics model…");
    const members = Object.values(LYRICS_MODEL.members);
    const res = spawnSync("tar", ["-xjf", tmp, "-C", work, ...members], { stdio: "inherit" });
    if (res.status !== 0) throw new Error("could not unpack the archive (needs `tar` with bzip2 support)");
    fs.rmSync(tmp, { force: true });

    const read = (member) => fs.readFileSync(path.join(work, LYRICS_MODEL.members[member]));
    const encoder = read("encoder");
    const metadata = onnxMetadata(encoder);
    const decoder = read("decoder");
    const cross = crossAttentionOutputs(decoder);
    if (cross.length !== Number(metadata.n_text_layer)) {
      throw new Error(`unexpected decoder graph: ${cross.length} cross-attention layers, expected ${metadata.n_text_layer}`);
    }
    const attentionLayers = [...new Set(LYRICS_MODEL.alignmentHeads.map(([layer]) => layer))].sort((a, b) => a - b);
    const attentionOutputs = attentionLayers.map((layer) => cross[layer]);
    const patched = addGraphOutputs(decoder, attentionOutputs);
    const tokens = read("tokens");

    fs.mkdirSync(LYRICS_MODEL.dir, { recursive: true });
    const files = { encoder: "encoder.int8.onnx", decoder: "decoder.int8.onnx", tokens: "tokens.txt" };
    fs.writeFileSync(path.join(LYRICS_MODEL.dir, files.encoder), encoder);
    fs.writeFileSync(path.join(LYRICS_MODEL.dir, files.decoder), patched);
    fs.writeFileSync(path.join(LYRICS_MODEL.dir, files.tokens), tokens);
    const info = {
      name: LYRICS_MODEL.name,
      source: LYRICS_MODEL.url,
      files,
      bytes: { encoder: encoder.length, decoder: patched.length, tokens: tokens.length },
      sha256: { encoder: sha256(encoder), decoder: sha256(patched), tokens: sha256(tokens) },
      metadata,
      alignmentHeads: LYRICS_MODEL.alignmentHeads,
      attentionLayers,
      attentionOutputs,
    };
    // Written last: its presence marks a complete installation.
    fs.writeFileSync(manifest, JSON.stringify(info, null, 1));
    log("lyrics model saved to public/models/whisper-turbo/");
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function ytdlpAsset() {
  const { platform, arch } = process;
  if (platform === "linux") return arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
  if (platform === "darwin") return "yt-dlp_macos";
  if (platform === "win32") return arch === "arm64" ? "yt-dlp_arm64.exe" : "yt-dlp.exe";
  return null;
}

async function ensureYtdlp() {
  if (process.env.YTDLP_PATH) return;
  const bin = path.join(root, ".bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  if (fs.existsSync(bin)) {
    const ageDays = (Date.now() - fs.statSync(bin).mtimeMs) / 86400000;
    if (args.has("--update") || ageDays > 7) {
      if (skipDownloads) return;
      // YouTube changes often; the official builds can update themselves.
      log("checking for a newer yt-dlp…");
      const res = spawnSync(bin, ["-U"], { stdio: "inherit" });
      if (res.status === 0) fs.utimesSync(bin, new Date(), new Date());
    }
    return;
  }
  if (skipDownloads) return;
  const asset = ytdlpAsset();
  if (!asset) {
    warn(`no yt-dlp build for ${process.platform}/${process.arch}; install yt-dlp and set YTDLP_PATH`);
    return;
  }
  log(`downloading yt-dlp (${asset})…`);
  const tmp = await download(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, bin, "yt-dlp");
  fs.renameSync(tmp, bin);
  fs.chmodSync(bin, 0o755);
  const version = spawnSync(bin, ["--version"], { encoding: "utf8" }).stdout?.trim();
  log(`yt-dlp ${version || "(unknown version)"} installed to .bin/`);
}

copyOrtRuntime();
for (const [name, step] of [
  ["model", ensureModel],
  ["lyrics model", ensureLyricsModel],
  ["yt-dlp", ensureYtdlp],
]) {
  try {
    await step();
  } catch (err) {
    warn(`${name} setup failed: ${err instanceof Error ? err.message : err}`);
    if (name === "model") warn("the app can't separate stems until public/models/htdemucs_6s.onnx exists");
    if (name === "lyrics model") warn("lyrics transcription is unavailable until public/models/whisper-turbo/ exists");
    if (name === "yt-dlp") warn("YouTube import is unavailable until yt-dlp is installed (file upload still works)");
  }
}
