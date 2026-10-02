"use client";

import { CircleCheck, Clock, HardDrive, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Thumbnail } from "@/components/Thumbnail";
import { formatTime } from "@/lib/songs";
import { deleteSong, listSongs, storageEstimate, type SongRecord } from "@/lib/storage/library";

function formatBytes(bytes: number) {
  if (bytes < 1e6) return `${Math.max(0, Math.round(bytes / 1e3))} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

export function Library() {
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
    // Initial load from IndexedDB (an external system).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const remove = async (song: SongRecord) => {
    if (!confirm(`Remove “${song.title}” and its stems from this browser?`)) return;
    await deleteSong(song.id);
    await refresh();
  };

  return (
    <section aria-labelledby="library-heading" className="mt-4">
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2 id="library-heading" className="text-lg font-semibold tracking-tight text-zinc-100">
          Your library
        </h2>
        {usage && songs && songs.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
            <HardDrive className="size-3.5" />
            {formatBytes(usage.usage)} used in this browser
          </span>
        )}
      </div>

      {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300">Library unavailable: {error}</p>}

      {songs === null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/[0.03]" />
          ))}
        </div>
      ) : songs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 px-6 py-10 text-center text-sm text-zinc-500">
          Nothing here yet. Separated songs are kept in your browser so they open instantly next time.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {songs.map((song) => (
            <li key={song.id} className="group relative">
              <Link
                href={`/song/${song.id}`}
                className="flex items-center gap-3 rounded-2xl border border-white/5 bg-ink-900/70 p-2.5 pr-10 transition hover:border-white/15 hover:bg-ink-850"
              >
                <Thumbnail
                  songId={song.id}
                  hasThumbnail={song.hasThumbnail}
                  className="aspect-video w-28 shrink-0 rounded-xl"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-100">{song.title}</p>
                  <p className="truncate text-xs text-zinc-400">
                    {song.artist ?? (song.source.kind === "file" ? song.source.name : "YouTube")}
                  </p>
                  <p className="mt-1.5 flex items-center gap-2 text-xs text-zinc-500">
                    {song.status === "ready" ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400/90">
                        <CircleCheck className="size-3.5" /> Stems ready
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-300/90">
                        <Clock className="size-3.5" /> Not separated yet
                      </span>
                    )}
                    {song.duration ? <span className="font-mono">{formatTime(song.duration)}</span> : null}
                  </p>
                </div>
              </Link>
              <button
                type="button"
                onClick={() => remove(song)}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-2 text-zinc-500 opacity-60 transition group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-300 focus-visible:opacity-100"
                title="Remove from library"
                aria-label={`Remove ${song.title}`}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
