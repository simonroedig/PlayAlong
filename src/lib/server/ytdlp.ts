import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AudioFormat, HealthInfo, YouTubeEvent, YouTubeMeta } from "../youtube-types";
import { isYouTubeId, youTubeWatchUrl } from "../youtube";

/**
 * Thin wrapper around the yt-dlp CLI: resolves the binary, downloads a
 * video's best audio-only stream into a small on-disk cache and reports
 * progress. Only canonical watch URLs built from a validated id are ever
 * passed to the process.
 */

// Runtime paths: `turbopackIgnore` keeps the bundler from tracing the whole
// project (including the 115 MB model in /public) into the server output.
const CACHE_DIR = path.resolve(
  /*turbopackIgnore: true*/ process.env.PLAYALONG_CACHE_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), ".cache", "youtube"),
);
const MAX_CACHED_FILES = 40;
export const MAX_DURATION_MINUTES = Number(process.env.PLAYALONG_MAX_DURATION_MIN ?? 30);

/** yt-dlp format selectors; each falls back to whatever audio exists. */
const FORMAT_SELECTOR: Record<AudioFormat, string> = {
  opus: "bestaudio[acodec=opus]/bestaudio[ext=webm]/bestaudio/best",
  aac: "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio/best",
};

const MIME_BY_EXT: Record<string, string> = {
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  webm: "audio/webm",
  opus: "audio/ogg",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
};

export function ytdlpBinary(): string {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
  const local = path.join(/*turbopackIgnore: true*/ process.cwd(), ".bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  return fs.existsSync(local) ? local : "yt-dlp";
}

let versionCache: { version: string | null; error?: string; at: number } | null = null;

export function ytdlpVersion(): { version: string | null; error?: string } {
  // Successful probes are cached for the process lifetime; failures are
  // retried every 30 s so installing yt-dlp does not need a restart.
  if (versionCache && (versionCache.version || Date.now() - versionCache.at < 30000)) return versionCache;
  const res = spawnSync(ytdlpBinary(), ["--version"], { encoding: "utf8", timeout: 20000 });
  const at = Date.now();
  if (res.error) {
    const code = (res.error as NodeJS.ErrnoException).code;
    versionCache = { version: null, error: code === "ENOENT" ? "not installed" : res.error.message, at };
  } else if (res.status !== 0) {
    versionCache = { version: null, error: res.stderr.trim() || `exit code ${res.status}`, at };
  } else {
    versionCache = { version: res.stdout.trim(), at };
  }
  return versionCache;
}

export function health(): HealthInfo {
  const { version, error } = ytdlpVersion();
  return {
    ytdlp: { available: version !== null, version, path: version ? ytdlpBinary() : null, error },
    maxDurationMinutes: MAX_DURATION_MINUTES,
  };
}

/** yt-dlp >= 2025.11 needs a JavaScript runtime for YouTube; point it at the Node running this server. */
function supportsJsRuntimes(version: string | null): boolean {
  return version !== null && version >= "2025.11.12";
}

function commonArgs(): string[] {
  const args = ["--no-playlist", "--no-warnings", "--ignore-config"];
  if (supportsJsRuntimes(ytdlpVersion().version)) args.push("--js-runtimes", `node:${process.execPath}`);
  if (process.env.YTDLP_COOKIES_FROM_BROWSER) args.push("--cookies-from-browser", process.env.YTDLP_COOKIES_FROM_BROWSER);
  if (process.env.YTDLP_COOKIES) args.push("--cookies", process.env.YTDLP_COOKIES);
  if (process.env.YTDLP_EXTRA_ARGS) args.push(...process.env.YTDLP_EXTRA_ARGS.split(/\s+/).filter(Boolean));
  return args;
}

function cacheKey(id: string, format: AudioFormat) {
  return `${id}.${format}`;
}

function metaPath(id: string, format: AudioFormat) {
  return path.join(CACHE_DIR, `${cacheKey(id, format)}.json`);
}

interface CachedAudio {
  meta: YouTubeMeta;
  file: string;
  size: number;
  mimeType: string;
}

export function cachedAudio(id: string, format: AudioFormat): CachedAudio | null {
  if (!isYouTubeId(id)) return null;
  try {
    const stored = JSON.parse(fs.readFileSync(metaPath(id, format), "utf8")) as { meta: YouTubeMeta; file: string };
    const file = path.join(CACHE_DIR, path.basename(stored.file));
    const { size } = fs.statSync(file);
    const ext = path.extname(file).slice(1).toLowerCase();
    return { meta: stored.meta, file, size, mimeType: MIME_BY_EXT[ext] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

function pruneCache() {
  try {
    const entries = fs
      .readdirSync(CACHE_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ key: f.slice(0, -5), mtime: fs.statSync(path.join(CACHE_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const { key } of entries.slice(MAX_CACHED_FILES)) {
      for (const f of fs.readdirSync(CACHE_DIR)) {
        if (f.startsWith(`${key}.`)) fs.rmSync(path.join(CACHE_DIR, f), { force: true });
      }
    }
  } catch {
    // best effort
  }
}

function friendlyError(stderr: string): string {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errorLine = [...lines].reverse().find((l) => l.startsWith("ERROR:")) ?? lines.at(-1) ?? "yt-dlp failed";
  const message = errorLine.replace(/^ERROR:\s*(\[[^\]]+\]\s*[\w-]+:\s*)?/, "");
  if (/confirm you.?re not a bot|sign in to confirm/i.test(message)) {
    return `${message}. YouTube wants a signed-in session. Set YTDLP_COOKIES_FROM_BROWSER=chrome (or firefox, safari, …) and restart the server.`;
  }
  if (/requested format is not available|no video formats/i.test(message)) {
    return `${message}. Try updating yt-dlp with \`npm run setup -- --update\`.`;
  }
  return message;
}

type Listener = (event: YouTubeEvent) => void;

interface Download {
  listeners: Set<Listener>;
  last: { meta?: YouTubeMeta; progress?: YouTubeEvent };
}

const inFlight = new Map<string, Download>();

function parseMeta(id: string, raw: string): YouTubeMeta {
  const data = JSON.parse(raw) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    id,
    title: str(data.track) ?? str(data.title) ?? id,
    artist: str(data.artist) ?? str(data.uploader) ?? str(data.channel),
    duration: typeof data.duration === "number" ? data.duration : null,
    thumbnail: str(data.thumbnail),
  };
}

/**
 * Ensures the audio of `id` is in the cache, streaming events to `listener`.
 * Concurrent requests for the same id and format share one yt-dlp process.
 */
export function fetchAudio(id: string, format: AudioFormat, listener: Listener): () => void {
  if (!isYouTubeId(id)) {
    listener({ type: "error", message: "Invalid YouTube video id" });
    return () => {};
  }
  const key = cacheKey(id, format);
  const cached = cachedAudio(id, format);
  if (cached) {
    listener({ type: "meta", meta: cached.meta });
    listener({ type: "done", meta: cached.meta, size: cached.size, mimeType: cached.mimeType, cached: true });
    return () => {};
  }

  const existing = inFlight.get(key);
  if (existing) {
    existing.listeners.add(listener);
    if (existing.last.meta) listener({ type: "meta", meta: existing.last.meta });
    if (existing.last.progress) listener(existing.last.progress);
    return () => existing.listeners.delete(listener);
  }

  const download: Download = { listeners: new Set([listener]), last: {} };
  inFlight.set(key, download);
  const emit = (event: YouTubeEvent) => {
    for (const l of download.listeners) l(event);
  };
  const finish = (event: YouTubeEvent) => {
    inFlight.delete(key);
    emit(event);
  };

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const args = [
    ...commonArgs(),
    "--format",
    FORMAT_SELECTOR[format],
    "--output",
    path.join(CACHE_DIR, `${key}.%(ext)s`),
    "--no-mtime",
    "--print",
    "video:PLAYALONG_META %(.{title,track,artist,uploader,channel,duration,thumbnail})j",
    "--print",
    "after_move:PLAYALONG_FILE %(filepath)s",
    "--progress",
    "--newline",
    "--progress-template",
    "download:PLAYALONG_PROGRESS %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s",
    youTubeWatchUrl(id),
  ];

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(ytdlpBinary(), args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    finish({ type: "error", message: `Could not start yt-dlp: ${(err as Error).message}` });
    return () => {};
  }

  let meta: YouTubeMeta | null = null;
  let file: string | null = null;
  let stderr = "";
  let tooLong = false;

  const onLine = (line: string) => {
    if (line.startsWith("PLAYALONG_META ")) {
      try {
        meta = parseMeta(id, line.slice("PLAYALONG_META ".length));
      } catch {
        return;
      }
      download.last.meta = meta;
      if (meta.duration !== null && meta.duration > MAX_DURATION_MINUTES * 60) {
        tooLong = true;
        child.kill();
        return;
      }
      emit({ type: "meta", meta });
    } else if (line.startsWith("PLAYALONG_PROGRESS ")) {
      const [done, total, estimate] = line.slice("PLAYALONG_PROGRESS ".length).split(" ").map(Number);
      const event: YouTubeEvent = {
        type: "progress",
        downloaded: Number.isFinite(done) ? done : 0,
        total: Number.isFinite(total) ? total : Number.isFinite(estimate) ? estimate : null,
      };
      download.last.progress = event;
      emit(event);
    } else if (line.startsWith("PLAYALONG_FILE ")) {
      file = line.slice("PLAYALONG_FILE ".length).trim();
    }
  };

  const splitLines = (onChunk: (line: string) => void) => {
    let buffer = "";
    return (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let nl: number;
      while ((nl = buffer.search(/\r?\n/)) >= 0) {
        onChunk(buffer.slice(0, nl));
        buffer = buffer.slice(buffer[nl] === "\r" ? nl + 2 : nl + 1);
      }
    };
  };
  child.stdout?.on("data", splitLines(onLine));
  child.stderr?.on(
    "data",
    splitLines((line) => {
      if (line.startsWith("PLAYALONG_")) onLine(line);
      else stderr += `${line}\n`;
    }),
  );

  child.on("error", (err: NodeJS.ErrnoException) => {
    finish({
      type: "error",
      message: err.code === "ENOENT" ? "yt-dlp is not installed. Run `npm run setup` (or set YTDLP_PATH)." : err.message,
    });
  });

  child.on("close", (code) => {
    if (!inFlight.has(key)) return;
    if (tooLong) {
      finish({ type: "error", message: `This video is longer than ${MAX_DURATION_MINUTES} minutes. Pick a shorter one (a live set of a few songs works).` });
      return;
    }
    if (code !== 0 || !file || !meta) {
      finish({ type: "error", message: code === 0 ? "yt-dlp did not produce an audio file" : friendlyError(stderr) });
      return;
    }
    const finalMeta: YouTubeMeta = meta;
    fs.writeFileSync(metaPath(id, format), JSON.stringify({ meta: finalMeta, file: path.basename(file) }));
    pruneCache();
    const result = cachedAudio(id, format);
    if (!result) {
      finish({ type: "error", message: "Downloaded file went missing" });
      return;
    }
    finish({ type: "done", meta: finalMeta, size: result.size, mimeType: result.mimeType, cached: false });
  });

  return () => download.listeners.delete(listener);
}
