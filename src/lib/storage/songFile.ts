import type { SongRecord } from "./library";

/**
 * The .playalong file: one song with everything PlayAlong knows about it, so a
 * folder of them (e.g. in OneDrive or Dropbox) is a library you can open on
 * any computer.
 *
 *   "PLAYALNG" | u32 header length | header (JSON, UTF-8) | payload
 *
 * The header holds the song record (title, chords, lyrics, settings) and a
 * table of payload sections (original audio, artwork, stems) with offsets
 * relative to the payload start, so the header can change without touching
 * the payload. All integers are little-endian.
 */

export const SONG_FILE_EXTENSION = ".playalong";
const MAGIC = "PLAYALNG";
export const SONG_FILE_FORMAT = 1;

export type SectionName = "source" | "thumbnail" | "stems";

export interface StemsInfo {
  /** "opus": WebCodecs Opus packets (48 kHz); "pcm16": raw interleaved samples at 44.1 kHz. */
  codec: "opus" | "pcm16";
  count: number;
  channels: number;
  /** Frames at 44.1 kHz once decoded. */
  frames: number;
  /** Rate of the encoded data. */
  sampleRate: number;
}

export interface SongFileHeader {
  format: number;
  app: "PlayAlong";
  savedAt: number;
  song: SongRecord;
  sections: { name: SectionName; type: string; offset: number; length: number }[];
  stems?: StemsInfo;
}

export interface SongFileParts {
  source?: Blob;
  thumbnail?: Blob;
  stems?: { info: StemsInfo; data: Blob };
}

/** Assembles a .playalong file (a Blob that references the parts, without copying them). */
export function buildSongFile(song: SongRecord, parts: SongFileParts, savedAt = Date.now()): Blob {
  const sections: SongFileHeader["sections"] = [];
  const blobs: Blob[] = [];
  let offset = 0;
  const add = (name: SectionName, blob: Blob | undefined) => {
    if (!blob) return;
    sections.push({ name, type: blob.type, offset, length: blob.size });
    blobs.push(blob);
    offset += blob.size;
  };
  add("source", parts.source);
  add("thumbnail", parts.thumbnail);
  add("stems", parts.stems?.data);
  const header: SongFileHeader = {
    format: SONG_FILE_FORMAT,
    app: "PlayAlong",
    savedAt,
    song,
    sections,
    ...(parts.stems ? { stems: parts.stems.info } : {}),
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const prefix = new Uint8Array(12);
  prefix.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(prefix.buffer).setUint32(8, json.length, true);
  return new Blob([prefix, json, ...blobs], { type: "application/x-playalong" });
}

/** Reads only the header of a .playalong file. */
export async function readSongFileHeader(file: Blob): Promise<{ header: SongFileHeader; payloadStart: number }> {
  const prefix = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (prefix.length < 12 || new TextDecoder().decode(prefix.slice(0, 8)) !== MAGIC) {
    throw new Error("Not a PlayAlong song file");
  }
  const length = new DataView(prefix.buffer).getUint32(8, true);
  if (12 + length > file.size) throw new Error("The song file is incomplete");
  const header = JSON.parse(await file.slice(12, 12 + length).text()) as SongFileHeader;
  if (header.app !== "PlayAlong" || !header.song?.id) throw new Error("Not a PlayAlong song file");
  if (header.format > SONG_FILE_FORMAT) throw new Error("This song file is from a newer PlayAlong; update the app");
  return { header, payloadStart: 12 + length };
}

/** One payload section as a Blob (a lazy slice of the file), or null if absent. */
export function songFileSection(file: Blob, header: SongFileHeader, payloadStart: number, name: SectionName): Blob | null {
  const section = header.sections.find((s) => s.name === name);
  if (!section) return null;
  const start = payloadStart + section.offset;
  return file.slice(start, start + section.length, section.type);
}

/** A file name from the song's artist and title that works on Windows, macOS and Linux. */
export function songFileName(song: Pick<SongRecord, "title" | "artist">, suffix = ""): string {
  const base = [song.artist, song.title]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .join(" - ")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 120);
  return `${base || "Untitled"}${suffix}${SONG_FILE_EXTENSION}`;
}

// Stems section: per stem, length-prefixed chunks. For Opus: decoder description, then the packets.

/** Packs per-stem packet lists ([description, ...packets]) into one Blob. */
export function packStemChunks(stems: Uint8Array[][]): Blob {
  const parts: BlobPart[] = [];
  for (const chunks of stems) {
    const head = new Uint8Array(4);
    new DataView(head.buffer).setUint32(0, chunks.length, true);
    parts.push(head);
    for (const chunk of chunks) {
      const len = new Uint8Array(4);
      new DataView(len.buffer).setUint32(0, chunk.length, true);
      parts.push(len, chunk as Uint8Array<ArrayBuffer>);
    }
  }
  return new Blob(parts);
}

/** Inverse of packStemChunks. */
export function unpackStemChunks(buffer: ArrayBuffer, count: number): Uint8Array[][] {
  const view = new DataView(buffer);
  const out: Uint8Array[][] = [];
  let p = 0;
  for (let s = 0; s < count; s++) {
    if (p + 4 > buffer.byteLength) throw new Error("The stems in this song file are damaged");
    const n = view.getUint32(p, true);
    p += 4;
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < n; i++) {
      const len = view.getUint32(p, true);
      p += 4;
      if (p + len > buffer.byteLength) throw new Error("The stems in this song file are damaged");
      chunks.push(new Uint8Array(buffer, p, len));
      p += len;
    }
    out.push(chunks);
  }
  return out;
}
