import { isYouTubeId } from "./youtube";
import { getSong, putSong, saveSourceAudio } from "./storage/library";

export type SongRef = { kind: "youtube"; videoId: string } | { kind: "file"; hash: string };

export const youtubeSongId = (videoId: string) => `yt-${videoId}`;

export function parseSongId(id: string): SongRef | null {
  if (id.startsWith("yt-")) {
    const videoId = id.slice(3);
    return isYouTubeId(videoId) ? { kind: "youtube", videoId } : null;
  }
  if (id.startsWith("file-")) {
    const hash = id.slice(5);
    return /^[0-9a-f]{16}$/.test(hash) ? { kind: "file", hash } : null;
  }
  return null;
}

export const ACCEPTED_AUDIO = ".mp3,.m4a,.aac,.mp4,.wav,.flac,.ogg,.oga,.opus,.webm,.aif,.aiff,audio/*";
const MAX_FILE_BYTES = 300 * 1024 * 1024;

/** 16 hex chars identifying a file's content (SHA-256 prefix; FNV-1a where crypto.subtle is unavailable). */
async function contentHash(data: ArrayBuffer): Promise<string> {
  const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  if (globalThis.crypto?.subtle) {
    return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)).slice(0, 8));
  }
  // Two independent 32-bit FNV-1a lanes give a 64-bit id.
  const bytes = new Uint8Array(data);
  let a = 0x811c9dc5;
  let b = 0x050c5d1f;
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i], 0x01000193) >>> 0;
    b = Math.imul(b ^ bytes[i] ^ (i & 0xff), 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** Adds a local audio file to the library (deduplicated by content) and returns its song id. */
export async function importFile(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new Error("That file is larger than 300 MB");
  if (file.size === 0) throw new Error("That file is empty");
  const id = `file-${await contentHash(await file.arrayBuffer())}`;
  if (await getSong(id)) return id;
  await saveSourceAudio(id, file);
  await putSong({
    id,
    source: { kind: "file", name: file.name },
    title: file.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim() || "Untitled",
    artist: null,
    duration: null,
    createdAt: Date.now(),
    status: "pending",
    hasThumbnail: false,
  });
  return id;
}

export function formatTime(seconds: number, withTenths = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  const whole = Math.floor(s);
  const base = `${m}:${String(whole).padStart(2, "0")}`;
  return withTenths ? `${base}.${Math.floor((s - whole) * 10)}` : base;
}
