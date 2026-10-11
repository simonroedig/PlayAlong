import type { ChordAnalysis } from "../chords/analyze";
import type { ChordView } from "../chords/sheet";
import type { LyricsAnalysis } from "../lyrics/transcribe";
import type { MixerSettings } from "../mixer";
import type { Backend } from "../separation/protocol";

/**
 * The song library lives entirely in the browser (IndexedDB): song metadata in
 * `songs`, binary payloads (original audio, thumbnail, stems) in `files`.
 */

export type SongSource = { kind: "youtube"; videoId: string } | { kind: "file"; name: string };

export interface SongRecord {
  id: string;
  source: SongSource;
  title: string;
  artist: string | null;
  /** Seconds (from metadata until decoded, then exact). */
  duration: number | null;
  createdAt: number;
  /** Last change worth syncing (everything except the mixer). */
  updatedAt?: number;
  status: "pending" | "ready";
  hasThumbnail: boolean;
  /** Present once separated. */
  frames?: number;
  separation?: { model: string; backend: Backend; seconds: number; finishedAt: number };
  mixer?: MixerSettings;
  /** Detected chords, beats and key (re-detected when the version changes). */
  chords?: ChordAnalysis;
  /** Capo / tuning used to display this song's chords. */
  chordView?: Pick<ChordView, "capo" | "tuneDown">;
  /** Lyrics transcribed from the vocal stem, with word timings. */
  lyrics?: LyricsAnalysis;
}

const DB_NAME = "playalong";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

export interface LibraryChange {
  id: string;
  kind: "song" | "stems" | "delete";
  /** Fields that changed ("*" for a whole record). */
  fields: string[];
  /** Changes made by the folder sync itself (not written back). */
  fromFolder?: boolean;
}

const changeListeners = new Set<(change: LibraryChange) => void>();

/** Notifies about every change to the library (used by the folder sync and the library view). */
export function onLibraryChange(listener: (change: LibraryChange) => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function emit(change: LibraryChange) {
  for (const listener of changeListeners) listener(change);
}

/** The mixer is a per-browser preference; everything else is part of the song. */
const touches = (fields: string[]) => fields.some((f) => f !== "mixer");

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("songs")) db.createObjectStore("songs", { keyPath: "id" });
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
    request.onblocked = () => reject(new Error("The library is open in an outdated tab; close it and retry"));
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const fileKey = {
  source: (id: string) => `${id}/source`,
  thumbnail: (id: string) => `${id}/thumbnail`,
  stem: (id: string, index: number) => `${id}/stem/${index}`,
};

export async function listSongs(): Promise<SongRecord[]> {
  const db = await openDb();
  const songs = await result(db.transaction("songs").objectStore("songs").getAll() as IDBRequest<SongRecord[]>);
  return songs.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getSong(id: string): Promise<SongRecord | undefined> {
  const db = await openDb();
  return result(db.transaction("songs").objectStore("songs").get(id) as IDBRequest<SongRecord | undefined>);
}

export async function putSong(song: SongRecord, options: { fromFolder?: boolean } = {}): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("songs", "readwrite");
  const record = options.fromFolder ? song : { ...song, updatedAt: Date.now() };
  tx.objectStore("songs").put(record);
  await done(tx);
  emit({ id: song.id, kind: "song", fields: ["*"], fromFolder: options.fromFolder });
}

export async function updateSong(
  id: string,
  patch: Partial<SongRecord>,
  options: { fromFolder?: boolean } = {},
): Promise<SongRecord | undefined> {
  const fields = Object.keys(patch);
  const full = !options.fromFolder && touches(fields) ? { ...patch, updatedAt: Date.now() } : patch;
  const db = await openDb();
  const tx = db.transaction("songs", "readwrite");
  const store = tx.objectStore("songs");
  const current = await result(store.get(id) as IDBRequest<SongRecord | undefined>);
  if (current) store.put({ ...current, ...full });
  await done(tx);
  if (current) emit({ id, kind: "song", fields, fromFolder: options.fromFolder });
  return current ? { ...current, ...full } : undefined;
}

export async function deleteSong(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["songs", "files"], "readwrite");
  tx.objectStore("songs").delete(id);
  tx.objectStore("files").delete(IDBKeyRange.bound(`${id}/`, `${id}/￿`));
  await done(tx);
  emit({ id, kind: "delete", fields: ["*"] });
}

async function putFile(key: string, value: Blob): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("files", "readwrite");
  tx.objectStore("files").put(value, key);
  await done(tx);
}

async function getFile(key: string): Promise<Blob | undefined> {
  const db = await openDb();
  return result(db.transaction("files").objectStore("files").get(key) as IDBRequest<Blob | undefined>);
}

export const saveSourceAudio = (id: string, blob: Blob) => putFile(fileKey.source(id), blob);
export const loadSourceAudio = (id: string) => getFile(fileKey.source(id));
export const saveThumbnail = (id: string, blob: Blob) => putFile(fileKey.thumbnail(id), blob);
export const loadThumbnail = (id: string) => getFile(fileKey.thumbnail(id));

/** Stores separated stems and marks the song ready, atomically. */
export async function saveStems(
  id: string,
  stems: Int16Array[],
  patch: Partial<SongRecord>,
  options: { fromFolder?: boolean } = {},
): Promise<SongRecord> {
  const db = await openDb();
  const tx = db.transaction(["songs", "files"], "readwrite");
  const files = tx.objectStore("files");
  stems.forEach((stem, i) => {
    // Blob() rejects views on shared memory; copy those first.
    const bytes = stem.buffer instanceof ArrayBuffer ? stem : stem.slice();
    files.put(new Blob([bytes as Int16Array<ArrayBuffer>]), fileKey.stem(id, i));
  });
  const songs = tx.objectStore("songs");
  const current = await result(songs.get(id) as IDBRequest<SongRecord | undefined>);
  if (!current) {
    tx.abort();
    throw new Error("Song disappeared from the library");
  }
  const next: SongRecord = { ...current, ...patch, status: "ready", ...(options.fromFolder ? {} : { updatedAt: Date.now() }) };
  songs.put(next);
  await done(tx);
  emit({ id, kind: "stems", fields: ["*"], fromFolder: options.fromFolder });
  return next;
}

export async function loadStems(id: string, count: number): Promise<Int16Array[]> {
  const blobs = await Promise.all(Array.from({ length: count }, (_, i) => getFile(fileKey.stem(id, i))));
  if (blobs.some((b) => !b)) throw new Error("Stems are missing; the song needs to be separated again");
  const shared = globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined";
  return Promise.all(
    blobs.map(async (b) => {
      const data = new Int16Array(await b!.arrayBuffer());
      if (!shared) return data;
      // Shared memory lets the audio thread read the stems without a copy.
      const out = new Int16Array(new SharedArrayBuffer(data.byteLength));
      out.set(data);
      return out;
    }),
  );
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}

/** Asks the browser not to evict the library under storage pressure. */
export async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // not supported
  }
}
