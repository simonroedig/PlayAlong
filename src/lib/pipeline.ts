import { decodeAudio, type DecodedAudio } from "./audio/decode";
import { MODEL_ID, SAMPLE_RATE } from "./separation/model";
import { startSeparation } from "./separation/client";
import type { Backend, BackendPreference } from "./separation/protocol";
import { parseSongId } from "./songs";
import {
  getSong,
  loadSourceAudio,
  putSong,
  saveSourceAudio,
  saveStems,
  saveThumbnail,
  updateSong,
  type SongRecord,
} from "./storage/library";
import { youTubeWatchUrl } from "./youtube";
import type { AudioFormat, YouTubeEvent } from "./youtube-types";

export type PipelineState =
  | { step: "download"; loaded: number; total: number | null; phase: "server" | "transfer" }
  | { step: "decode" }
  | { step: "model"; phase: "download" | "runtime" | "init"; loaded?: number; total?: number; cached?: boolean; backend?: Backend }
  | { step: "separate"; done: number; total: number; backend: Backend; elapsedMs: number; etaMs: number | null }
  | { step: "save" };

export interface PreparedSong {
  song: SongRecord;
  /** Freshly separated stems, so the player does not have to re-read them. */
  stems: Int16Array[] | null;
}

/**
 * Separation needs ~85 MB of memory per minute of audio; 30 minutes (a short
 * live set) stays clear of a browser tab's limits.
 */
const MAX_SECONDS = 30 * 60;

interface Options {
  backend?: BackendPreference;
  signal: AbortSignal;
  onState: (state: PipelineState) => void;
  onSong: (song: SongRecord) => void;
  onNotice: (message: string) => void;
}

function abortError() {
  const err = new Error("Cancelled");
  err.name = "AbortError";
  return err;
}

async function readWithProgress(res: Response, onProgress: (loaded: number, total: number | null) => void): Promise<Blob> {
  const total = Number(res.headers.get("content-length")) || null;
  if (!res.body) return res.blob();
  const reader = res.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array<ArrayBuffer>);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  return new Blob(chunks, { type: res.headers.get("content-type") ?? "application/octet-stream" });
}

/**
 * Formats to request, best first. Opus (YouTube's highest-quality audio
 * stream) where the browser can decode it, AAC otherwise — some Chromium
 * builds ship without AAC, Safari's Opus support varies.
 */
function preferredFormats(): AudioFormat[] {
  const probe = typeof Audio === "function" ? new Audio() : null;
  const opus = probe?.canPlayType('audio/webm; codecs="opus"') === "probably";
  const aac = probe?.canPlayType('audio/mp4; codecs="mp4a.40.2"') !== "";
  if (opus && !(aac && /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent))) return ["opus", "aac"];
  return ["aac", "opus"];
}

/** Downloads a YouTube video's audio through the server and stores it in the library. */
async function fetchYouTube(id: string, videoId: string, format: AudioFormat, opts: Options): Promise<Blob> {
  const res = await fetch("/api/youtube", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: youTubeWatchUrl(videoId), format }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `The server could not fetch this video (HTTP ${res.status})`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let finished: Extract<YouTubeEvent, { type: "done" }> | null = null;
  opts.onState({ step: "download", loaded: 0, total: null, phase: "server" });
  while (!finished) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const event = JSON.parse(line) as YouTubeEvent;
      if (event.type === "error") throw new Error(event.message);
      if (event.type === "meta") {
        const existing = await getSong(id);
        const song: SongRecord = {
          ...(existing ?? { createdAt: Date.now(), status: "pending" as const, hasThumbnail: false }),
          id,
          source: { kind: "youtube", videoId },
          title: event.meta.title,
          artist: event.meta.artist,
          duration: event.meta.duration,
        };
        await putSong(song);
        opts.onSong(song);
      } else if (event.type === "progress") {
        opts.onState({ step: "download", loaded: event.downloaded, total: event.total, phase: "server" });
      } else if (event.type === "done") {
        finished = event;
      }
    }
  }
  if (!finished) throw new Error("The download ended unexpectedly");

  const audioRes = await fetch(`/api/youtube/${videoId}/audio?format=${format}`, { signal: opts.signal });
  if (!audioRes.ok) throw new Error(`Could not load the downloaded audio (HTTP ${audioRes.status})`);
  const blob = await readWithProgress(audioRes, (loaded, total) =>
    opts.onState({ step: "download", loaded, total, phase: "transfer" }),
  );
  await saveSourceAudio(id, blob);

  // The thumbnail is decoration; never fail the import over it.
  try {
    const thumb = await fetch(`/api/youtube/${videoId}/thumbnail`, { signal: opts.signal });
    if (thumb.ok) {
      await saveThumbnail(id, await thumb.blob());
      const song = await updateSong(id, { hasThumbnail: true });
      if (song) opts.onSong(song);
    }
  } catch {
    // ignore
  }
  return blob;
}

/**
 * Brings a song to the "ready" state: fetch (YouTube) or load (file) the
 * source audio, decode it, separate it in the browser and store the stems.
 */
export async function prepareSong(id: string, opts: Options): Promise<PreparedSong> {
  const ref = parseSongId(id);
  if (!ref) throw new Error("Unknown song");
  let song = await getSong(id);
  if (song?.status === "ready") return { song, stems: null };

  let decoded: DecodedAudio | null = null;
  const stored = await loadSourceAudio(id);
  if (stored) {
    opts.onState({ step: "decode" });
    try {
      decoded = await decodeAudio(await stored.arrayBuffer());
    } catch (err) {
      if (ref.kind === "file") throw err;
    }
  } else if (ref.kind === "file") {
    throw new Error("The original file is no longer in the library. Please add it again.");
  }
  if (!decoded && ref.kind === "youtube") {
    const formats = preferredFormats();
    for (const [i, format] of formats.entries()) {
      const source = await fetchYouTube(id, ref.videoId, format, opts);
      if (opts.signal.aborted) throw abortError();
      opts.onState({ step: "decode" });
      try {
        decoded = await decodeAudio(await source.arrayBuffer());
        break;
      } catch (err) {
        if (i === formats.length - 1) throw err;
        opts.onNotice(`This browser could not decode the ${format.toUpperCase()} stream; trying ${formats[i + 1].toUpperCase()} instead.`);
      }
    }
  }
  if (!decoded) throw new Error("No audio to separate");
  if (opts.signal.aborted) throw abortError();
  const duration = decoded.frames / SAMPLE_RATE;
  if (duration > MAX_SECONDS) {
    throw new Error(`This track is ${Math.round(duration / 60)} minutes long. PlayAlong handles recordings up to ${MAX_SECONDS / 60} minutes.`);
  }
  song = await updateSong(id, { duration });
  if (song) opts.onSong(song);

  opts.onState({ step: "model", phase: "download" });
  const job = startSeparation(decoded.left, decoded.right, {
    backend: opts.backend,
    onStatus: (status) => {
      if (status.phase === "model") {
        opts.onState({ step: "model", phase: "download", loaded: status.loaded, total: status.total, cached: status.cached });
      } else if (status.phase === "separating") {
        const { done, total, backend, elapsedMs, etaMs } = status;
        opts.onState({ step: "separate", done, total, backend, elapsedMs, etaMs });
      } else {
        opts.onState({ step: "model", phase: status.phase, backend: status.backend });
      }
    },
    onFallback: (reason) => opts.onNotice(`GPU acceleration failed, continuing on the CPU (${reason})`),
  });
  const onAbort = () => job.cancel();
  opts.signal.addEventListener("abort", onAbort);
  let result;
  try {
    result = await job.promise;
  } finally {
    opts.signal.removeEventListener("abort", onAbort);
  }

  opts.onState({ step: "save" });
  const ready = await saveStems(id, result.stems, {
    frames: result.frames,
    duration: result.frames / SAMPLE_RATE,
    separation: { model: MODEL_ID, backend: result.backend, seconds: result.seconds, finishedAt: Date.now() },
  });
  return { song: ready, stems: result.stems };
}
