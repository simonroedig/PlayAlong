/// <reference lib="webworker" />
import type * as OrtModule from "onnxruntime-web";

/** Worker-side helpers shared by the separation and chord workers. */

export type Ort = typeof OrtModule;
export type OrtBackend = "webgpu" | "wasm";

const MODEL_CACHE = "playalong-models-v1";

export async function loadOrt(base: string, backend: OrtBackend, maxThreads = 8): Promise<Ort> {
  const file = backend === "webgpu" ? "ort.webgpu.bundle.min.mjs" : "ort.wasm.bundle.min.mjs";
  // Served from /public (copied by scripts/setup.mjs), so keep it out of the bundle.
  // The bundles embed their Emscripten glue and find the .wasm next to
  // themselves, so env.wasm.wasmPaths must stay unset.
  const ort: Ort = await import(/* webpackIgnore: true */ `${base}${file}`);
  const cores = navigator.hardwareConcurrency || 4;
  // Threads need SharedArrayBuffer, i.e. a cross-origin isolated page.
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(maxThreads, Math.floor(cores * 0.75))) : 1;
  ort.env.logLevel = "error";
  return ort;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ModelSource {
  url: string;
  /** Expected SHA-256, or null to skip verification. */
  sha256: string | null;
}

/** Fetches a model once and keeps it in Cache Storage (keyed by its hash). */
export async function loadModel(
  source: ModelSource,
  onProgress: (loaded: number, total: number, cached: boolean) => void,
): Promise<Uint8Array> {
  const url = new URL(source.url, self.location.href);
  const cacheKey = new URL(url);
  cacheKey.searchParams.set("playalong-sha", source.sha256 ?? "unverified");
  let cache: Cache | null = null;
  try {
    cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(cacheKey);
    if (hit) {
      const bytes = new Uint8Array(await hit.arrayBuffer());
      onProgress(bytes.byteLength, bytes.byteLength, true);
      return bytes;
    }
  } catch {
    cache = null; // Cache Storage unavailable (e.g. private mode); just download.
  }

  const res = await fetch(url);
  if (res.status === 404) {
    throw new Error(`Model not found at ${source.url}. Run \`npm run setup\` to download it.`);
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
      onProgress(loaded, total, false);
    }
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress(loaded, loaded, false);
  // crypto.subtle only exists in secure contexts (https or localhost).
  if (source.sha256 && crypto.subtle) {
    const digest = await sha256Hex(bytes);
    if (digest !== source.sha256) {
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

export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
