"use client";

import { LocateFixed } from "lucide-react";

/** Floating button that scrolls a sheet back to where the music is. */
export function BackToNow({ show, onClick }: { show: boolean; onClick: () => void }) {
  if (!show) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute right-3 bottom-3 z-10 inline-flex h-9 items-center gap-1.5 rounded-full bg-zinc-50 px-3.5 text-xs font-semibold text-ink-950 shadow-lg shadow-black/50 transition hover:bg-white"
    >
      <LocateFixed className="size-3.5" /> Back to now
    </button>
  );
}
