"use client";

import { CircleCheck, Clock, FolderOpen, HardDrive, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFolder } from "@/components/FolderStatus";
import { Thumbnail } from "@/components/Thumbnail";
import { formatTime } from "@/lib/songs";
import { folderEntries, folderSection, removeFromFolder } from "@/lib/storage/folder";
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
        {folder.status === "ready" ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
            <FolderOpen className="size-3.5" /> Saved in your folder “{folder.name}”
          </span>
        ) : usage && songs && songs.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
            <HardDrive className="size-3.5" />
            {formatBytes(usage.usage)} used in this browser
          </span>
        ) : null}
      </div>

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
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => remove(item)}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-2 text-zinc-500 opacity-60 transition group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-300 focus-visible:opacity-100"
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
