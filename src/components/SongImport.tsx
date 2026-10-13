"use client";

import { ArrowRight, ClipboardPaste, FileAudio, Loader2, TriangleAlert, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { VideoLinkIcon } from "@/components/icons";
import { useHealth } from "@/hooks/useCapabilities";
import { YOUTUBE_IMPORT } from "@/lib/features";
import { ACCEPTED_AUDIO, importFile, youtubeSongId } from "@/lib/songs";
import { parseYouTubeId } from "@/lib/youtube";

/** The two ways in: a YouTube link (left) or an audio file (right, a big drop zone). */
export function SongImport() {
  const router = useRouter();
  const health = useHealth();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"link" | "file" | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const ytdlpMissing = YOUTUBE_IMPORT && health !== null && !health.ytdlp.available;

  const open = (input: string) => {
    const id = parseYouTubeId(input);
    if (!id) {
      setError("That doesn't look like a YouTube video link. Try something like youtube.com/watch?v=…");
      return;
    }
    setBusy("link");
    router.push(`/song/${youtubeSongId(id)}`);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    open(url);
  };

  const onPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      setError(null);
      if (parseYouTubeId(text)) open(text);
    } catch {
      setError("Clipboard access was blocked. Paste with Ctrl/⌘ + V instead.");
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy("file");
    try {
      router.push(`/song/${await importFile(file)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) return void onFile(event.dataTransfer.files[0]);
    const text = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
    if (text) {
      setUrl(text);
      open(text);
    }
  };

  const dragProps = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop,
  };

  return (
    <div>
      <div className={`relative grid gap-3 md:gap-5 ${YOUTUBE_IMPORT ? "md:grid-cols-2" : ""}`}>
        {/* YouTube */}
        {YOUTUBE_IMPORT && (
        <form
          onSubmit={onSubmit}
          className="flex flex-col rounded-3xl border border-white/10 bg-ink-900/80 p-5 shadow-2xl shadow-black/30 sm:p-6"
        >
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-red-500/10">
              <VideoLinkIcon className="size-5 text-red-500" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-zinc-50">From YouTube</h2>
              <p className="text-sm text-zinc-500">Paste the link of a song video</p>
            </div>
          </div>
          <label className="relative mt-5 flex items-center">
            <span className="sr-only">YouTube link</span>
            <input
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              placeholder="https://youtu.be/…"
              className="h-13 w-full rounded-2xl border border-white/10 bg-ink-850 pr-12 pl-4 text-[15px] text-zinc-100 placeholder:text-zinc-600 focus:border-white/30 focus:outline-none"
              aria-invalid={error ? true : undefined}
              disabled={busy !== null}
            />
            <button
              type="button"
              onClick={onPaste}
              className="absolute right-2 rounded-xl p-2 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
              title="Paste from clipboard"
              aria-label="Paste from clipboard"
              disabled={busy !== null}
            >
              <ClipboardPaste className="size-5" />
            </button>
          </label>
          <button
            type="submit"
            disabled={busy !== null || !url.trim()}
            className="mt-3 inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-zinc-50 px-6 text-[15px] font-semibold text-ink-950 transition hover:bg-white disabled:bg-zinc-50/20 disabled:text-zinc-400"
          >
            {busy === "link" ? <Loader2 className="size-5 animate-spin" /> : <ArrowRight className="size-5" />}
            Open song
          </button>
          {ytdlpMissing ? (
            <p className="mt-auto flex items-start gap-2 pt-4 text-xs text-zinc-400">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>
                YouTube links need <code className="font-mono text-zinc-200">yt-dlp</code> on the server
                {health?.ytdlp.error ? ` (${health.ytdlp.error})` : ""}. Run{" "}
                <code className="font-mono text-zinc-200">npm run setup</code>. Audio files always work.
              </span>
            </p>
          ) : (
            <p className="mt-auto pt-4 text-xs text-zinc-500">The audio is fetched once and then kept with your songs.</p>
          )}
        </form>
        )}

        {YOUTUBE_IMPORT && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 z-10 hidden size-10 -translate-1/2 place-items-center rounded-full border border-white/10 bg-ink-950 text-xs font-medium text-zinc-400 md:grid"
        >
          or
        </span>
        )}

        {/* File */}
        <button
          type="button"
          {...dragProps}
          onClick={() => fileInput.current?.click()}
          disabled={busy !== null}
          className={`group relative flex min-h-64 flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed p-6 text-center transition ${
            dragging
              ? "scale-[1.01] border-white/60 bg-white/[0.07]"
              : "border-white/15 bg-ink-900/50 hover:border-white/35 hover:bg-white/[0.03]"
          }`}
        >
          <span
            className={`grid size-16 place-items-center rounded-2xl transition ${
              dragging ? "bg-white text-ink-950" : "bg-white/[0.06] text-zinc-200 group-hover:bg-white/10"
            }`}
          >
            {busy === "file" ? <Loader2 className="size-7 animate-spin" /> : dragging ? <Upload className="size-7" /> : <FileAudio className="size-7" />}
          </span>
          <span>
            <span className="block text-lg font-semibold text-zinc-50">{dragging ? "Drop it" : "Drop an audio file here"}</span>
            <span className="mt-1 block text-sm text-zinc-400">
              or <span className="text-zinc-100 underline decoration-white/30 underline-offset-4">choose one from your computer</span>
            </span>
          </span>
          <span className="text-xs tracking-wide text-zinc-500">MP3 · M4A · WAV · FLAC · OGG</span>
        </button>
        <input ref={fileInput} type="file" accept={ACCEPTED_AUDIO} className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </div>

      {!YOUTUBE_IMPORT && (
        <p className="mt-3 text-center text-xs text-zinc-500">
          This online version works with audio files. Pasting YouTube links works when you run PlayAlong on your own computer.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
