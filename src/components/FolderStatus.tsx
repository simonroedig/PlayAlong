"use client";

import { FolderOpen, FolderPlus, FolderSync, HardDrive, Loader2, RefreshCw, TriangleAlert, Unplug } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { HeaderPopover } from "@/components/HeaderPopover";
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

const primary =
  "inline-flex items-center gap-1.5 rounded-xl bg-zinc-50 px-3 py-2 text-xs font-semibold text-ink-950 hover:bg-white disabled:opacity-50";
const secondary = "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs text-zinc-300 hover:bg-white/5 disabled:opacity-50";

/** Where songs are kept (this browser, or a folder on the computer), with the why and how. Header, left. */
export function FolderStatus() {
  const folder = useFolder();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void initFolder();
    // Pick up songs added on other computers (e.g. through OneDrive) when coming back to the tab.
    const onVisible = () => document.visibilityState === "visible" && void syncFolder();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const run = (action: () => Promise<void>) => async () => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (folder.status === "checking") return <span className="h-10 w-32" aria-hidden />;

  const ready = folder.status === "ready";
  const trigger = ready ? (
    <>
      {folder.busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : folder.error ? (
        <TriangleAlert className="size-4 text-red-300" />
      ) : (
        <span className="relative grid place-items-center">
          <FolderOpen className="size-4" />
          <span className="absolute -right-1 -bottom-0.5 size-2 rounded-full bg-emerald-400 ring-2 ring-ink-900" />
        </span>
      )}
      <span className="hidden max-w-44 truncate sm:inline">Folder · {folder.name}</span>
    </>
  ) : folder.status === "permission" ? (
    <>
      <FolderSync className="size-4 text-sky-300" />
      <span className="hidden sm:inline">Reopen your folder</span>
    </>
  ) : (
    <>
      <HardDrive className="size-4 text-zinc-400" />
      <span className="hidden sm:inline">Saved in this browser</span>
    </>
  );

  return (
    <HeaderPopover align="left" label="Where your songs are saved" trigger={trigger}>
      <p className="font-semibold text-zinc-50">Your songs stay with you</p>
      <p className="mt-2 leading-relaxed text-zinc-400">
        Nothing you add is uploaded anywhere. PlayAlong keeps your songs with their stems, chords and lyrics either inside
        this browser or as files in a folder on your computer.
      </p>

      <div className="mt-4 rounded-xl bg-white/[0.04] p-3 text-xs leading-relaxed text-zinc-300">
        {folder.status === "unsupported" && (
          <>
            <p className="flex items-center gap-2 font-medium text-zinc-100">
              <HardDrive className="size-3.5" /> Right now: inside this browser
            </p>
            <p className="mt-1.5 text-zinc-400">
              They stay here until you clear this site&apos;s data. To keep them as files you can back up or sync with
              OneDrive or Dropbox, open PlayAlong in Chrome or Edge on a computer: those can save to a folder.
            </p>
          </>
        )}
        {folder.status === "none" && (
          <>
            <p className="flex items-center gap-2 font-medium text-zinc-100">
              <HardDrive className="size-3.5" /> Right now: inside this browser
            </p>
            <p className="mt-1.5 text-zinc-400">
              Choose a folder and every song is also saved there as a .playalong file. Put the folder in OneDrive, Dropbox
              or iCloud Drive and your songs open on all your computers.
            </p>
            <button type="button" onClick={run(connectFolder)} className={`${primary} mt-3`}>
              <FolderPlus className="size-3.5" /> Choose a folder
            </button>
          </>
        )}
        {folder.status === "permission" && (
          <>
            <p className="flex items-center gap-2 font-medium text-zinc-100">
              <FolderSync className="size-3.5" /> Your folder “{folder.name}”
            </p>
            <p className="mt-1.5 text-zinc-400">After a browser restart, the browser asks once more before PlayAlong may open it.</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <button type="button" onClick={run(reconnectFolder)} className={primary}>
                <FolderOpen className="size-3.5" /> Open folder
              </button>
              <button type="button" onClick={run(disconnectFolder)} className={secondary}>
                <Unplug className="size-3.5" /> Stop using it
              </button>
            </div>
          </>
        )}
        {ready && (
          <>
            <p className="flex items-center gap-2 font-medium text-zinc-100">
              <FolderOpen className="size-3.5" /> Saving to “{folder.name}”
            </p>
            <p className="mt-1.5 text-zinc-400">
              {folder.songs} {folder.songs === 1 ? "song" : "songs"} in the folder, one .playalong file each. In OneDrive,
              Dropbox or iCloud Drive they open on every computer.
            </p>
            {folder.busy && (
              <p className="mt-2 flex items-center gap-2 text-zinc-200">
                <Loader2 className="size-3.5 animate-spin" /> {folder.busy}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <button type="button" onClick={run(syncFolder)} disabled={!!folder.busy} className={primary}>
                <RefreshCw className="size-3.5" /> Sync now
              </button>
              <button type="button" onClick={run(connectFolder)} className={secondary}>
                <FolderOpen className="size-3.5" /> Other folder
              </button>
              <button type="button" onClick={run(disconnectFolder)} className={secondary}>
                <Unplug className="size-3.5" /> Stop saving
              </button>
            </div>
          </>
        )}
      </div>

      {((ready && folder.error) || error) && (
        <p className="mt-3 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300">{error ?? (ready ? folder.error : null)}</p>
      )}
    </HeaderPopover>
  );
}
