"use client";

import { Check, FolderOpen, FolderPlus, FolderSync, HardDrive, Loader2, RefreshCw, TriangleAlert, Unplug } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  connectFolder,
  disconnectFolder,
  folderStore,
  initFolder,
  reconnectFolder,
  syncFolder,
  type FolderState,
} from "@/lib/storage/folder";

export function useFolder(): FolderState {
  return useSyncExternalStore(folderStore.subscribe, folderStore.getSnapshot, folderStore.getServerSnapshot);
}

const chip =
  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-white/40";

/** Where the library is kept: this browser only, or a folder on the computer (header, top right). */
export function FolderStatus() {
  const folder = useFolder();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void initFolder();
    // Pick up songs added on other computers (e.g. through OneDrive) when coming back to the tab.
    const onVisible = () => document.visibilityState === "visible" && void syncFolder();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const run = (action: () => Promise<void>) => async () => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (folder.status === "checking") return <span className="h-8 w-28" aria-hidden />;

  if (folder.status === "unsupported") {
    return (
      <span
        className={`${chip} border-white/10 bg-white/[0.03] text-zinc-400`}
        title="Songs are kept in this browser. Saving to a folder needs Chrome or Edge on a computer."
      >
        <HardDrive className="size-3.5" />
        <span className="hidden sm:inline">In this browser</span>
      </span>
    );
  }

  if (folder.status === "none") {
    return (
      <button
        type="button"
        onClick={run(connectFolder)}
        className={`${chip} border-white/15 bg-white/[0.04] text-zinc-200 hover:border-white/25 hover:bg-white/[0.08]`}
        title="Keep your songs in a folder on this computer, e.g. inside OneDrive or Dropbox to use them on all your computers"
      >
        <FolderPlus className="size-3.5" />
        <span className="hidden sm:inline">Save to a folder</span>
      </button>
    );
  }

  if (folder.status === "permission") {
    return (
      <button
        type="button"
        onClick={run(reconnectFolder)}
        className={`${chip} border-sky-300/30 bg-sky-300/10 text-sky-100 hover:bg-sky-300/15`}
        title={`Allow PlayAlong to open your “${folder.name}” folder again`}
      >
        <FolderSync className="size-3.5" />
        <span className="hidden sm:inline">Open folder “{folder.name}”</span>
      </button>
    );
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`${chip} border-white/10 bg-white/[0.04] text-zinc-200 hover:border-white/20 hover:bg-white/[0.07]`}
        title={folder.busy ?? `Your songs are saved in the folder “${folder.name}”`}
      >
        {folder.busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : folder.error ? (
          <TriangleAlert className="size-3.5 text-red-300" />
        ) : (
          <span className="relative grid place-items-center">
            <FolderOpen className="size-3.5" />
            <span className="absolute -right-1 -bottom-0.5 size-1.5 rounded-full bg-emerald-400 ring-2 ring-ink-950" />
          </span>
        )}
        <span className="hidden max-w-40 truncate sm:inline">{folder.name}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-2xl border border-white/10 bg-ink-850 p-4 text-sm shadow-2xl shadow-black/60">
          <p className="flex items-center gap-2 font-medium text-zinc-100">
            <Check className="size-4 text-emerald-400" /> Saving to “{folder.name}”
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
            {folder.songs} {folder.songs === 1 ? "song" : "songs"} in the folder, one .playalong file each with the stems,
            chords and lyrics. Put the folder in OneDrive, Dropbox or iCloud Drive and your songs open on every computer.
          </p>
          {folder.busy && (
            <p className="mt-3 flex items-center gap-2 text-xs text-zinc-300">
              <Loader2 className="size-3.5 animate-spin" /> {folder.busy}
            </p>
          )}
          {(folder.error || error) && (
            <p className="mt-3 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300">{folder.error ?? error}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={run(syncFolder)}
              disabled={!!folder.busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-medium text-zinc-100 hover:bg-white/15 disabled:opacity-50"
            >
              <RefreshCw className="size-3.5" /> Sync now
            </button>
            <button
              type="button"
              onClick={run(connectFolder)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-white/5"
            >
              <FolderOpen className="size-3.5" /> Other folder
            </button>
            <button
              type="button"
              onClick={run(async () => {
                await disconnectFolder();
                setOpen(false);
              })}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
            >
              <Unplug className="size-3.5" /> Stop saving
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
