import { SOURCES } from "../separation/model";
import {
  getSong,
  listSongs,
  loadSourceAudio,
  loadStems,
  loadThumbnail,
  onLibraryChange,
  putSong,
  saveSourceAudio,
  saveStems,
  saveThumbnail,
  updateSong,
  type SongRecord,
} from "./library";
import {
  buildSongFile,
  readSongFileHeader,
  SONG_FILE_EXTENSION,
  songFileName,
  songFileSection,
  type SongFileHeader,
} from "./songFile";
import { decodeStems, encodeStems } from "./stemCodec";

/**
 * Keeps the library in a folder on the user's computer (File System Access
 * API, Chrome and Edge): one .playalong file per song. The browser library
 * stays the working copy; the folder is written whenever a song changes and
 * read on start, so the same folder (e.g. inside OneDrive or Dropbox) carries
 * songs, chords and lyrics between computers.
 */

type Permission = "granted" | "denied" | "prompt";
interface PermissionHandle {
  queryPermission(options: { mode: "readwrite" }): Promise<Permission>;
  requestPermission(options: { mode: "readwrite" }): Promise<Permission>;
}
type DirectoryPicker = (options?: { id?: string; mode?: "readwrite"; startIn?: string }) => Promise<FileSystemDirectoryHandle>;

const FOLDER_NAME = "PlayAlong";

export interface FolderEntry {
  id: string;
  fileName: string;
  size: number;
  header: SongFileHeader;
  payloadStart: number;
}

export type FolderState =
  | { status: "checking" }
  | { status: "unsupported" }
  | { status: "none" }
  | { status: "permission"; name: string }
  | { status: "ready"; name: string; songs: number; busy: string | null; error: string | null; syncedAt: number | null };

let state: FolderState = { status: "checking" };
const SERVER_STATE: FolderState = { status: "checking" };
let entries = new Map<string, FolderEntry>();
let handle: FileSystemDirectoryHandle | null = null;
const listeners = new Set<() => void>();

function setState(next: FolderState) {
  state = next;
  for (const l of listeners) l();
}

export const folderStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => state,
  getServerSnapshot: (): FolderState => SERVER_STATE,
};

/** Songs in the folder (by song id). */
export const folderEntries = () => entries;

export const folderSupported = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

// --- The chosen folder is remembered in its own small database. ---

function settingsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("playalong-settings", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("kv");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeHandle(value: FileSystemDirectoryHandle | null) {
  const db = await settingsDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    if (value) tx.objectStore("kv").put(value, "folder");
    else tx.objectStore("kv").delete("folder");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await settingsDb();
  const value = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
    const request = db.transaction("kv").objectStore("kv").get("folder");
    request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}

const permission = (dir: FileSystemDirectoryHandle, request: boolean) => {
  const h = dir as unknown as PermissionHandle;
  return request ? h.requestPermission({ mode: "readwrite" }) : h.queryPermission({ mode: "readwrite" });
};

async function* files(dir: FileSystemDirectoryHandle): AsyncGenerator<FileSystemFileHandle> {
  for await (const entry of (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
    if (entry.kind === "file" && entry.name.toLowerCase().endsWith(SONG_FILE_EXTENSION)) yield entry as FileSystemFileHandle;
  }
}

// --- One operation at a time. ---

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

function readyState(patch: Partial<Extract<FolderState, { status: "ready" }>> = {}) {
  const base = state.status === "ready" ? state : { busy: null, error: null, syncedAt: null };
  setState({ ...base, status: "ready", name: handle?.name ?? FOLDER_NAME, songs: entries.size, ...patch });
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

// --- Public API ---

let started = false;
let markScanned: () => void = () => {};
const scanned = new Promise<void>((resolve) => (markScanned = resolve));
/** Resolves once the folder (if any) has been read after start, or after a few seconds. */
export const folderScanned = () => Promise.race([scanned, new Promise<void>((r) => setTimeout(r, 4000))]);

/** Restores the folder from the last visit (without prompting). */
export async function initFolder(): Promise<void> {
  if (started) return;
  started = true;
  if (!folderSupported()) {
    markScanned();
    return setState({ status: "unsupported" });
  }
  onLibraryChange((change) => {
    if (change.fromFolder || state.status !== "ready") return;
    if (change.kind === "delete") return;
    if (change.kind === "song" && !change.fields.some((f) => f !== "mixer")) return;
    schedule(change.id);
  });
  try {
    handle = await loadHandle();
  } catch {
    handle = null;
  }
  if (!handle) {
    markScanned();
    return setState({ status: "none" });
  }
  if ((await permission(handle, false)) === "granted") {
    readyState();
    void syncFolder();
  } else {
    markScanned();
    setState({ status: "permission", name: handle.name });
  }
}

/** Lets the user pick (or create) the PlayAlong folder. Call from a click. */
export async function connectFolder(): Promise<void> {
  const picker = (window as unknown as { showDirectoryPicker: DirectoryPicker }).showDirectoryPicker;
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await picker({ id: "playalong", mode: "readwrite", startIn: "documents" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    throw err;
  }
  // Use the folder itself if it is (or already holds) a PlayAlong library, else a "PlayAlong" folder inside it.
  let hasSongs = false;
  for await (const file of files(dir)) {
    void file;
    hasSongs = true;
    break;
  }
  if (!hasSongs && dir.name.toLowerCase() !== FOLDER_NAME.toLowerCase()) {
    dir = await dir.getDirectoryHandle(FOLDER_NAME, { create: true });
  }
  handle = dir;
  await storeHandle(dir);
  entries = new Map();
  readyState({ error: null });
  await syncFolder();
}

/** Asks for access again after a restart of the browser. Call from a click. */
export async function reconnectFolder(): Promise<void> {
  if (!handle) return connectFolder();
  if ((await permission(handle, true)) !== "granted") return;
  readyState();
  await syncFolder();
}

export async function disconnectFolder(): Promise<void> {
  handle = null;
  entries = new Map();
  await storeHandle(null);
  setState({ status: "none" });
}

async function scan(dir: FileSystemDirectoryHandle): Promise<Map<string, FolderEntry>> {
  const found = new Map<string, FolderEntry>();
  for await (const fileHandle of files(dir)) {
    try {
      const file = await fileHandle.getFile();
      const { header, payloadStart } = await readSongFileHeader(file);
      const previous = found.get(header.song.id);
      if (!previous || (previous.header.song.updatedAt ?? 0) < (header.song.updatedAt ?? 0)) {
        found.set(header.song.id, { id: header.song.id, fileName: fileHandle.name, size: file.size, header, payloadStart });
      }
    } catch {
      // not a song file, or still being written by a sync client
    }
  }
  return found;
}

const stamp = (song: SongRecord) => song.updatedAt ?? song.createdAt;

/** Two-way sync: writes new and changed songs, takes over chords and lyrics changed elsewhere. */
export function syncFolder(): Promise<void> {
  return serial(async () => {
    const dir = handle;
    if (!dir || state.status !== "ready") return;
    readyState({ busy: "Checking your folder", error: null });
    try {
      entries = await scan(dir);
      markScanned();
      readyState();
      for (const song of await listSongs()) {
        const entry = entries.get(song.id);
        if (song.status !== "ready") continue;
        if (!entry || stamp(song) > stamp(entry.header.song)) await write(dir, song.id);
        else if (stamp(entry.header.song) > stamp(song)) {
          const { title, artist, chords, chordView, lyrics, updatedAt } = entry.header.song;
          await updateSong(song.id, { title, artist, chords, chordView, lyrics, updatedAt }, { fromFolder: true });
        }
      }
      readyState({ busy: null, syncedAt: Date.now() });
    } catch (err) {
      markScanned();
      readyState({ busy: null, error: message(err) });
    }
  });
}

async function write(dir: FileSystemDirectoryHandle, id: string): Promise<void> {
  const song = await getSong(id);
  if (!song || song.status !== "ready" || !song.frames) return;
  const existing = entries.get(id);
  readyState({ busy: `Saving “${song.title}”` });

  // Stems are only encoded once per separation; later saves reuse them from the file.
  let stems: Parameters<typeof buildSongFile>[1]["stems"];
  let previousFile: File | null = null;
  if (existing && existing.header.stems && existing.header.song.separation?.finishedAt === song.separation?.finishedAt) {
    previousFile = await (await dir.getFileHandle(existing.fileName)).getFile();
    const data = songFileSection(previousFile, existing.header, existing.payloadStart, "stems");
    if (data) stems = { info: existing.header.stems, data };
  }
  if (!stems) {
    const raw = await loadStems(id, SOURCES.length);
    stems = await encodeStems(raw, song.frames, (done, total) =>
      readyState({ busy: `Saving “${song.title}” · stems ${done} of ${total}` }),
    );
  }
  const [source, thumbnail] = await Promise.all([
    loadSourceAudio(id),
    song.hasThumbnail ? loadThumbnail(id) : Promise.resolve(undefined),
  ]);
  const blob = buildSongFile(song, { source, thumbnail, stems });

  let fileName = existing?.fileName;
  if (!fileName) {
    const taken = new Set([...entries.values()].map((e) => e.fileName.toLowerCase()));
    for (let n = 1; !fileName || taken.has(fileName.toLowerCase()); n++) fileName = songFileName(song, n > 1 ? ` (${n})` : "");
  }
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (err) {
    await writable.abort().catch(() => {});
    throw err;
  }
  const { header, payloadStart } = await readSongFileHeader(blob);
  entries.set(id, { id, fileName, size: blob.size, header, payloadStart });
  readyState({ busy: null });
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
function schedule(id: string) {
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      void serial(async () => {
        if (!handle || state.status !== "ready") return;
        try {
          await write(handle, id);
        } catch (err) {
          readyState({ busy: null, error: message(err) });
        }
      });
    }, 1500),
  );
}

/** Removes a song's file from the folder. */
export function removeFromFolder(id: string): Promise<void> {
  return serial(async () => {
    const entry = entries.get(id);
    if (!handle || !entry) return;
    await handle.removeEntry(entry.fileName).catch(() => {});
    entries.delete(id);
    readyState();
  });
}

/** A section of a song file in the folder (e.g. its artwork). */
export async function folderSection(id: string, name: "thumbnail" | "source"): Promise<Blob | null> {
  const entry = entries.get(id);
  if (!handle || !entry) return null;
  const file = await (await handle.getFileHandle(entry.fileName)).getFile();
  return songFileSection(file, entry.header, entry.payloadStart, name);
}

/**
 * Copies a song from the folder into this browser (if it is there and not yet
 * here). Returns the song, or null if the folder doesn't have it.
 */
export function importFromFolder(id: string, onProgress?: (text: string) => void): Promise<SongRecord | null> {
  return serial(async () => {
    const entry = entries.get(id);
    if (!handle || !entry) return null;
    const existing = await getSong(id);
    if (existing?.status === "ready") return existing;
    onProgress?.("Reading the song file");
    const file = await (await handle.getFileHandle(entry.fileName)).getFile();
    const { header, payloadStart } = await readSongFileHeader(file);
    const source = songFileSection(file, header, payloadStart, "source");
    const thumbnail = songFileSection(file, header, payloadStart, "thumbnail");
    const stemsData = songFileSection(file, header, payloadStart, "stems");
    // Copy the payload out of the file before it can change underneath.
    if (source) await saveSourceAudio(id, new Blob([await source.arrayBuffer()], { type: source.type }));
    if (thumbnail) await saveThumbnail(id, new Blob([await thumbnail.arrayBuffer()], { type: thumbnail.type }));
    const song: SongRecord = { ...header.song, status: "pending", hasThumbnail: !!thumbnail };
    await putSong(song, { fromFolder: true });
    if (!stemsData || !header.stems) return song;
    const stems = await decodeStems(header.stems, stemsData, (done, total) => onProgress?.(`Unpacking stems ${done} of ${total}`));
    return saveStems(id, stems, { frames: header.stems.frames }, { fromFolder: true });
  });
}
