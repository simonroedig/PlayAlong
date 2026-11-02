"use client";

import { ChevronDown, CircleCheck, FolderOpen, Music } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFolder } from "@/components/FolderStatus";
import { Thumbnail } from "@/components/Thumbnail";
import { formatTime } from "@/lib/songs";
import { folderEntries, folderSection } from "@/lib/storage/folder";
import { listSongs, onLibraryChange, type SongRecord } from "@/lib/storage/library";

/**
 * Moving between songs without going back to the library: a "switch song"
 * menu at the top of the player and the other songs below it.
 */

type Entry = { song: SongRecord; inFolderOnly: boolean };

function useSongs(): Entry[] | null {
  const folder = useFolder();
  const [songs, setSongs] = useState<SongRecord[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => void listSongs().then((list) => !cancelled && setSongs(list)).catch(() => {});
    load();
    const off = onLibraryChange(load);
    return () => {
      cancelled = true;
      off();
    };
  }, []);
  const folderCount = folder.status === "ready" ? folder.songs : 0;
  if (!songs) return null;
  const here = new Set(songs.map((s) => s.id));
  const elsewhere = folderCount
    ? [...folderEntries().values()].filter((e) => !here.has(e.id)).map((e) => ({ song: e.header.song, inFolderOnly: true }))
    : [];
  return [...songs.map((song) => ({ song, inFolderOnly: false })), ...elsewhere].sort((a, b) => b.song.createdAt - a.song.createdAt);
}

const folderThumbnail = (id: string) => folderSection(id, "thumbnail");

/** A menu of all songs with their artwork, next to "Library". */
export function SongMenu({ currentId }: { currentId: string }) {
  const router = useRouter();
  const songs = useSongs();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (!songs || songs.length < 2) return null;
  const current = songs.find((e) => e.song.id === currentId)?.song;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex h-9 max-w-72 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] pr-2.5 pl-1 text-xs text-zinc-300 transition hover:border-white/20 hover:text-zinc-50"
      >
        {current && <Thumbnail songId={current.id} hasThumbnail={current.hasThumbnail} className="aspect-video h-7 shrink-0 rounded-lg" />}
        <span className="text-zinc-500">Switch song</span>
        <ChevronDown className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Switch song"
          className="absolute top-full left-0 z-40 mt-1.5 max-h-96 w-80 overflow-y-auto rounded-2xl border border-white/10 bg-ink-850 p-1.5 shadow-2xl"
        >
          {songs.map(({ song, inFolderOnly }) => {
            const here = song.id === currentId;
            return (
              <li key={song.id} role="option" aria-selected={here}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (!here) router.push(`/song/${song.id}`);
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-xl p-1.5 text-left transition ${here ? "bg-white/10" : "hover:bg-white/[0.06]"}`}
                >
                  <Thumbnail
                    songId={song.id}
                    hasThumbnail={song.hasThumbnail}
                    load={inFolderOnly ? folderThumbnail : undefined}
                    className="aspect-video w-16 shrink-0 rounded-lg"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-zinc-100">{song.title}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {inFolderOnly ? "In your folder" : (song.artist ?? (song.source.kind === "file" ? song.source.name : "YouTube"))}
                      {song.duration ? ` · ${formatTime(song.duration)}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The other songs, below the player. */
export function OtherSongs({ currentId }: { currentId: string }) {
  const songs = useSongs()?.filter((e) => e.song.id !== currentId);
  if (!songs?.length) return null;
  return (
    <section className="mt-10" aria-labelledby="other-songs">
      <h2 id="other-songs" className="mb-3 flex items-center gap-2 text-base font-semibold text-zinc-200">
        <Music className="size-4 text-zinc-400" /> Your other songs
      </h2>
      <ul className="flex gap-3 overflow-x-auto pb-2">
        {songs.map(({ song, inFolderOnly }) => (
          <li key={song.id} className="w-52 shrink-0">
            <Link href={`/song/${song.id}`} className="block rounded-2xl border border-white/5 bg-ink-900/70 p-2 transition hover:border-white/15 hover:bg-ink-850">
              <Thumbnail
                songId={song.id}
                hasThumbnail={song.hasThumbnail}
                load={inFolderOnly ? folderThumbnail : undefined}
                className="aspect-video w-full rounded-xl"
              />
              <p className="mt-2 truncate px-1 text-sm font-medium text-zinc-100">{song.title}</p>
              <p className="flex items-center gap-2 truncate px-1 text-xs text-zinc-500">
                {inFolderOnly ? (
                  <span className="inline-flex items-center gap-1 text-sky-300/90">
                    <FolderOpen className="size-3" /> In your folder
                  </span>
                ) : song.status === "ready" ? (
                  <span className="inline-flex items-center gap-1 text-emerald-400/80">
                    <CircleCheck className="size-3" /> Ready
                  </span>
                ) : (
                  <span>Not separated yet</span>
                )}
                {song.duration ? <span className="font-mono">{formatTime(song.duration)}</span> : null}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
