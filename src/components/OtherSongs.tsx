"use client";

import { CircleCheck, FolderOpen, Music } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useFolder } from "@/components/FolderStatus";
import { Thumbnail } from "@/components/Thumbnail";
import { Select } from "@/components/ui/Select";
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

/** A compact menu of all songs, next to "Library". */
export function SongMenu({ currentId }: { currentId: string }) {
  const router = useRouter();
  const songs = useSongs();
  if (!songs || songs.length < 2) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-zinc-500">
      <span aria-hidden>Switch song</span>
      <Select
        label="Switch song"
        align="left"
        value={currentId}
        onChange={(id) => id !== currentId && router.push(`/song/${id}`)}
        options={songs.map(({ song }) => ({ value: song.id, label: song.title }))}
      />
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
