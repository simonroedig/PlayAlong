"use client";

import { ArrowLeft, ExternalLink, RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Player } from "@/components/Player";
import { ProcessingPanel } from "@/components/ProcessingPanel";
import { Thumbnail } from "@/components/Thumbnail";
import { prepareSong, type PipelineState } from "@/lib/pipeline";
import { SOURCES } from "@/lib/separation/model";
import { formatTime, parseSongId } from "@/lib/songs";
import { getSong, loadStems, requestPersistence, type SongRecord } from "@/lib/storage/library";
import { youTubeWatchUrl } from "@/lib/youtube";

type View =
  | { kind: "loading" }
  | { kind: "processing"; state: PipelineState | null; startedAt: number }
  | { kind: "ready"; stems: Int16Array[] }
  | { kind: "error"; message: string }
  | { kind: "cancelled" };

export function SongView({ id }: { id: string }) {
  const [song, setSong] = useState<SongRecord | null>(null);
  const [view, setView] = useState<View>({ kind: "loading" });
  const [notices, setNotices] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    const { signal } = controller;
    const run = async () => {
      if (!parseSongId(id)) throw new Error("This song link is not valid.");
      const existing = await getSong(id);
      if (signal.aborted) return;
      if (existing) setSong(existing);
      if (existing?.status === "ready") {
        const stems = await loadStems(id, SOURCES.length);
        if (!signal.aborted) setView({ kind: "ready", stems });
        return;
      }
      void requestPersistence();
      setView({ kind: "processing", state: null, startedAt: Date.now() });
      const prepared = await prepareSong(id, {
        signal,
        onState: (state) => !signal.aborted && setView((v) => (v.kind === "processing" ? { ...v, state } : v)),
        onSong: (s) => !signal.aborted && setSong(s),
        onNotice: (message) => !signal.aborted && setNotices((n) => [...n, message]),
      });
      if (signal.aborted) return;
      setSong(prepared.song);
      const stems = prepared.stems ?? (await loadStems(id, SOURCES.length));
      if (!signal.aborted) setView({ kind: "ready", stems });
    };
    run().catch((err: unknown) => {
      if (signal.aborted || (err instanceof Error && err.name === "AbortError")) return;
      setView({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    });
    return () => controller.abort();
  }, [id, attempt]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setView({ kind: "cancelled" });
  }, []);

  const retry = useCallback(() => {
    setNotices([]);
    setView({ kind: "loading" });
    setAttempt((a) => a + 1);
  }, []);

  const ref = parseSongId(id);

  return (
    <div className="pt-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
      >
        <ArrowLeft className="size-4" /> Library
      </Link>

      <header className="mt-4 flex items-center gap-4">
        <Thumbnail
          songId={id}
          hasThumbnail={song?.hasThumbnail ?? false}
          className="aspect-video w-32 shrink-0 rounded-2xl sm:w-40"
        />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
            {song?.title ?? (ref?.kind === "youtube" ? "YouTube video" : "Loading…")}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-400">
            {song?.artist && <span className="truncate">{song.artist}</span>}
            {song?.duration ? <span className="font-mono text-zinc-500">{formatTime(song.duration)}</span> : null}
            {ref?.kind === "youtube" && (
              <a
                href={youTubeWatchUrl(ref.videoId)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-200"
              >
                YouTube <ExternalLink className="size-3.5" />
              </a>
            )}
            {song?.source.kind === "file" && <span className="truncate text-zinc-500">{song.source.name}</span>}
          </p>
        </div>
      </header>

      <div className="mt-8">
        {view.kind === "loading" && <div className="h-64 animate-pulse rounded-3xl bg-white/[0.03]" />}

        {view.kind === "processing" && (
          <ProcessingPanel
            state={view.state}
            startedAt={view.startedAt}
            isYouTube={ref?.kind === "youtube"}
            notices={notices}
            onCancel={cancel}
          />
        )}

        {view.kind === "error" && (
          <div className="rounded-3xl border border-red-500/20 bg-red-500/[0.06] p-6">
            <p className="flex items-start gap-2 text-red-200">
              <TriangleAlert className="mt-0.5 size-5 shrink-0" />
              <span>{view.message}</span>
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={retry}
                className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-white/15"
              >
                <RotateCcw className="size-4" /> Try again
              </button>
              <Link href="/" className="rounded-xl px-4 py-2 text-sm text-zinc-400 hover:bg-white/5 hover:text-zinc-100">
                Back to library
              </Link>
            </div>
          </div>
        )}

        {view.kind === "cancelled" && (
          <div className="rounded-3xl border border-white/10 bg-ink-900/70 p-6">
            <p className="text-zinc-300">Separation cancelled. Nothing was saved except the downloaded audio.</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={retry}
                className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-white/15"
              >
                <RotateCcw className="size-4" /> Start again
              </button>
              <Link href="/" className="rounded-xl px-4 py-2 text-sm text-zinc-400 hover:bg-white/5 hover:text-zinc-100">
                Back to library
              </Link>
            </div>
          </div>
        )}

        {view.kind === "ready" && song && <Player key={song.id} song={song} stems={view.stems} />}
      </div>
    </div>
  );
}
