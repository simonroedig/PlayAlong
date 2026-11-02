"use client";

import { CircleCheck, Clock, Download, FolderCheck, FolderOpen, FolderPlus, FolderSync, HardDrive, Loader2, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFolder } from "@/components/FolderStatus";
import { Thumbnail } from "@/components/Thumbnail";
import { formatTime } from "@/lib/songs";
import { connectFolder, exportSongFile, folderEntries, folderSection, reconnectFolder, removeFromFolder, syncFolder } from "@/lib/storage/folder";
import { deleteSong, listSongs, onLibraryChange, storageEstimate, type SongRecord } from "@/lib/storage/library";

function formatBytes(bytes: number) {
  if (bytes < 1e6) return `${Math.max(0, Math.round(bytes / 1e3))} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

const folderThumbnail = (id: string) => folderSection(id, "thumbnail");

type Item = { song: SongRecord; place: "browser" | "folder" };

export function Library() {
  const folder = useFolder();
  const [songs, setSongs] = useState<SongRecord[] | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, estimate] = await Promise.all([listSongs(), storageEstimate()]);
      setSongs(list);
      setUsage(estimate);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSongs([]);
    }
  }, []);

  useEffect(() => {
    // Initial load from IndexedDB (an external system), then follow its changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onLibraryChange(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 300);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [refresh]);

  // Songs in the folder that this browser doesn't have yet (opened on another computer).
  const folderSongs = folder.status === "ready" ? folder.songs : 0;
  const items = useMemo<Item[] | null>(() => {
    if (!songs) return null;
    const here = new Set(songs.map((s) => s.id));
    const elsewhere = folderSongs
      ? [...folderEntries().values()].filter((e) => !here.has(e.id)).map((e) => ({ song: e.header.song, place: "folder" as const }))
      : [];
    return [...songs.map((song) => ({ song, place: "browser" as const })), ...elsewhere].sort(
      (a, b) => b.song.createdAt - a.song.createdAt,
    );
  }, [songs, folderSongs]);

  // Saving one song as a .playalong file (to the Downloads folder).
  const [exporting, setExporting] = useState<{ id: string; text: string } | null>(null);
  const download = async (song: SongRecord) => {
    setExporting({ id: song.id, text: "Preparing" });
    try {
      const { blob, name } = await exportSongFile(song.id, (text) => setExporting({ id: song.id, text }));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(null);
    }
  };

  const remove = async ({ song, place }: Item) => {
    const inFolder = folder.status === "ready" && folderEntries().has(song.id);
    const where = place === "folder" ? "your folder" : inFolder ? "this browser and your folder" : "this browser";
    if (!confirm(`Remove “${song.title}” from ${where}?`)) return;
    if (inFolder) await removeFromFolder(song.id);
    if (place === "browser") await deleteSong(song.id);
    await refresh();
  };

  return (
    <section aria-labelledby="library-heading" className="mt-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <h2 id="library-heading" className="text-lg font-semibold tracking-tight text-zinc-100">
          Your songs
        </h2>
      </div>

      <StoragePanel usage={usage?.usage ?? null} onError={setError} />

      {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300">Library unavailable: {error}</p>}

      {items === null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/[0.03]" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 px-6 py-10 text-center text-sm text-zinc-500">
          No songs yet. Everything you open here is kept, so it opens instantly next time.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const { song, place } = item;
            return (
              <li key={song.id} className="group relative">
                <Link
                  href={`/song/${song.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-white/5 bg-ink-900/70 p-2.5 pr-10 transition hover:border-white/15 hover:bg-ink-850"
                >
                  <Thumbnail
                    songId={song.id}
                    hasThumbnail={song.hasThumbnail}
                    load={place === "folder" ? folderThumbnail : undefined}
                    className="aspect-video w-28 shrink-0 rounded-xl"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-100">{song.title}</p>
                    <p className="truncate text-xs text-zinc-400">
                      {song.artist ?? (song.source.kind === "file" ? song.source.name : "YouTube")}
                    </p>
                    <p className="mt-1.5 flex items-center gap-2 text-xs text-zinc-500">
                      {place === "folder" ? (
                        <span className="inline-flex items-center gap-1 text-sky-300/90">
                          <FolderOpen className="size-3.5" /> In your folder
                        </span>
                      ) : song.status === "ready" ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400/90">
                          <CircleCheck className="size-3.5" /> Ready to play
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-zinc-400">
                          <Clock className="size-3.5" /> Not separated yet
                        </span>
                      )}
                      {song.duration ? <span className="font-mono">{formatTime(song.duration)}</span> : null}
                    </p>
                    {place === "browser" && <Where song={song} folderReady={folder.status === "ready"} />}
                  </div>
                </Link>
                {place === "browser" && song.status === "ready" && (
                  <button
                    type="button"
                    onClick={() => download(song)}
                    disabled={exporting !== null}
                    className="absolute top-2 right-2 rounded-lg p-2 text-zinc-500 opacity-60 transition group-hover:opacity-100 hover:bg-white/10 hover:text-zinc-100 focus-visible:opacity-100 disabled:opacity-40"
                    title={exporting?.id === song.id ? `Saving file · ${exporting.text}` : "Download as a .playalong file (stems, chords and lyrics), to move, back up or open elsewhere"}
                    aria-label={`Download ${song.title} as a file`}
                  >
                    {exporting?.id === song.id ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(item)}
                  className="absolute right-2 bottom-2 rounded-lg p-2 text-zinc-500 opacity-60 transition group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-300 focus-visible:opacity-100"
                  title="Remove song"
                  aria-label={`Remove ${song.title}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Where a song is kept: only in this browser, or also as a file in the folder. */
function Where({ song, folderReady }: { song: SongRecord; folderReady: boolean }) {
  const inFolder = folderReady && folderEntries().has(song.id);
  return inFolder ? (
    <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-emerald-400/80" title={`File: ${folderEntries().get(song.id)?.fileName}`}>
      <FolderCheck className="size-3" /> In your folder
    </span>
  ) : (
    <span
      className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-300/80"
      title={folderReady ? "Saved to the folder once it is taken apart" : "Only in this browser: clearing the browser's data removes it"}
    >
      <HardDrive className="size-3" /> {folderReady && song.status === "ready" ? "Saving to your folder…" : "Only in this browser"}
    </span>
  );
}

const primary =
  "inline-flex items-center gap-1.5 rounded-xl bg-zinc-50 px-3 py-2 text-xs font-semibold text-ink-950 hover:bg-white disabled:opacity-50";
const secondary = "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs text-zinc-300 hover:bg-white/5 disabled:opacity-50";

/** Where the songs are saved, up front: this browser or a folder on the computer, and how to change it. */
function StoragePanel({ usage, onError }: { usage: number | null; onError: (message: string) => void }) {
  const folder = useFolder();
  const run = (action: () => Promise<void>) => () => void action().catch((err) => onError(err instanceof Error ? err.message : String(err)));
  if (folder.status === "checking") return null;
  const box = "mb-4 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm";

  if (folder.status === "ready") {
    return (
      <div className={`${box} border-emerald-400/20 bg-emerald-400/[0.04]`}>
        <FolderOpen className="size-5 shrink-0 text-emerald-300" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-zinc-100">
            Saved in your folder “{folder.name}” on this computer
            {folder.busy && <span className="ml-2 text-xs font-normal text-zinc-400">· {folder.busy}</span>}
          </p>
          <p className="text-xs text-zinc-400">
            {folder.songs} {folder.songs === 1 ? "song" : "songs"}, one .playalong file each: copy, move or back them up like any file. The
            browser only tells PlayAlong the folder&apos;s name, not where it is; it&apos;s the folder you picked.
          </p>
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={run(syncFolder)} disabled={!!folder.busy} className={secondary}>
            <RefreshCw className="size-3.5" /> Sync
          </button>
          <button type="button" onClick={run(connectFolder)} className={secondary}>
            <FolderOpen className="size-3.5" /> Other folder
          </button>
        </div>
      </div>
    );
  }
  if (folder.status === "permission") {
    return (
      <div className={`${box} border-sky-400/20 bg-sky-400/[0.04]`}>
        <FolderSync className="size-5 shrink-0 text-sky-300" />
        <p className="min-w-0 flex-1 text-zinc-200">
          Your songs are saved in the folder “{folder.name}”. After a browser restart it needs one click to open again.
        </p>
        <button type="button" onClick={run(reconnectFolder)} className={primary}>
          <FolderOpen className="size-3.5" /> Open folder
        </button>
      </div>
    );
  }
  return (
    <div className={`${box} border-amber-300/20 bg-amber-300/[0.04]`}>
      <HardDrive className="size-5 shrink-0 text-amber-200" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-zinc-100">
          Saved only in this browser{usage ? <span className="font-normal text-zinc-400"> · {formatBytes(usage)}</span> : null}
        </p>
        <p className="text-xs text-zinc-400">
          {folder.status === "unsupported"
            ? "Clearing the browser's data removes them. Download songs as .playalong files (the arrow on each song), or open PlayAlong in Chrome or Edge to keep them in a folder."
            : "Clearing the browser's data removes them. Pick a folder (e.g. on your Desktop or in OneDrive) and every song is also saved there as a .playalong file you can see, move and back up."}
        </p>
      </div>
      {folder.status === "none" && (
        <button type="button" onClick={run(connectFolder)} className={primary}>
          <FolderPlus className="size-3.5" /> Save to a folder
        </button>
      )}
    </div>
  );
}
