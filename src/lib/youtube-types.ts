/** Audio-only stream to fetch: Opus (WebM) or AAC (M4A). */
export type AudioFormat = "opus" | "aac";

export const AUDIO_FORMATS: AudioFormat[] = ["opus", "aac"];

export interface YouTubeMeta {
  id: string;
  title: string;
  artist: string | null;
  /** Seconds. */
  duration: number | null;
  thumbnail: string | null;
}

/** Newline-delimited JSON events streamed by POST /api/youtube. */
export type YouTubeEvent =
  | { type: "meta"; meta: YouTubeMeta }
  | { type: "progress"; downloaded: number; total: number | null }
  | { type: "done"; meta: YouTubeMeta; size: number; mimeType: string; cached: boolean }
  | { type: "error"; message: string };

export interface HealthInfo {
  ytdlp: { available: boolean; version: string | null; path: string | null; error?: string };
  maxDurationMinutes: number;
}
