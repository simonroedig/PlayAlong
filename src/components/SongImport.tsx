"use client";

import { ArrowRight, ClipboardPaste, FileAudio, Loader2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { VideoLinkIcon } from "@/components/icons";
import { useHealth } from "@/hooks/useCapabilities";
import { ACCEPTED_AUDIO, importFile, youtubeSongId } from "@/lib/songs";
import { parseYouTubeId } from "@/lib/youtube";

export function SongImport() {
  const router = useRouter();
  const health = useHealth();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const ytdlpMissing = health !== null && !health.ytdlp.available;

  const open = (input: string) => {
    const id = parseYouTubeId(input);
    if (!id) {
      setError("That doesn't look like a YouTube video link — try something like youtube.com/watch?v=…");
      return;
    }
    setBusy(true);
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
      setError("Clipboard access was blocked — paste with Ctrl/⌘ + V instead.");
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      router.push(`/song/${await importFile(file)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const text = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
    if (event.dataTransfer.files.length) void onFile(event.dataTransfer.files[0]);
    else if (text) {
      setUrl(text);
      open(text);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`relative rounded-3xl border bg-ink-900/80 p-2 shadow-2xl shadow-black/40 backdrop-blur transition ${
        dragging ? "border-guitar/60 ring-4 ring-guitar/15" : "border-white/10"
      }`}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
        <label className="relative flex flex-1 items-center">
          <span className="sr-only">YouTube link</span>
          <VideoLinkIcon className="pointer-events-none absolute left-4 size-5 text-red-500" />
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
            placeholder="Paste a YouTube link — e.g. https://youtu.be/…"
            className="h-14 w-full rounded-2xl border border-white/5 bg-ink-850 pr-12 pl-12 text-[15px] text-zinc-100 placeholder:text-zinc-500 focus:border-white/20 focus:outline-none"
            aria-invalid={error ? true : undefined}
            disabled={busy}
          />
          <button
            type="button"
            onClick={onPaste}
            className="absolute right-2 rounded-xl p-2 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
            title="Paste from clipboard"
            disabled={busy}
          >
            <ClipboardPaste className="size-5" />
          </button>
        </label>
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-guitar to-bass px-6 text-[15px] font-semibold text-ink-950 shadow-lg shadow-guitar/10 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : <ArrowRight className="size-5" />}
          Separate
        </button>
      </form>

      <div className="flex flex-col items-center justify-between gap-2 px-3 pt-3 pb-1.5 text-sm text-zinc-400 sm:flex-row">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg px-2 py-1 transition hover:bg-white/5 hover:text-zinc-200"
          disabled={busy}
        >
          <FileAudio className="size-4" />
          <span>
            or <span className="text-zinc-200 underline decoration-white/20 underline-offset-4">choose an audio file</span>{" "}
            / drop it here
          </span>
        </button>
        <span className="text-xs text-zinc-500">MP3 · M4A · WAV · FLAC · OGG</span>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_AUDIO}
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </div>

      {(error || ytdlpMissing) && (
        <div className="mx-2 mt-2 mb-1 space-y-2">
          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          )}
          {ytdlpMissing && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                YouTube import needs <code className="font-mono text-amber-100">yt-dlp</code> on the server
                {health?.ytdlp.error ? ` (${health.ytdlp.error})` : ""}. Run{" "}
                <code className="font-mono text-amber-100">npm run setup</code> — audio files work either way.
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
