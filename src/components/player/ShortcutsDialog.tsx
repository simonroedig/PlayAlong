"use client";

import { Keyboard, X } from "lucide-react";
import { useEffect } from "react";

const KEYS: [string, string][] = [
  ["Space", "Play / pause"],
  ["← / →", "Skip 5 s (with Shift: 1 s)"],
  ["Home", "Back to the start (or the loop start)"],
  ["1 to 5", "Full mix · No guitar · Guitar only · No bass · Bass only"],
  ["V", "Vocals on / off"],
  ["G / B", "Mute the guitar / the bass"],
  ["L", "Loop on / off"],
  ["[ / ]", "Set the loop start / end"],
  ["− / +", "Slower / faster"],
  ["?", "Show these shortcuts"],
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="rise w-full max-w-md rounded-3xl border border-white/10 bg-ink-850 p-6 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="shortcuts-title" className="flex items-center gap-2 text-base font-semibold text-zinc-50">
            <Keyboard className="size-4.5" /> Keyboard shortcuts
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-zinc-100">
            <X className="size-4" />
          </button>
        </div>
        <dl className="mt-5 space-y-2.5 text-sm">
          {KEYS.map(([k, v]) => (
            <div key={k} className="flex items-center gap-4">
              <dt className="min-w-16 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-center font-mono text-xs text-zinc-100">{k}</dt>
              <dd className="text-zinc-300">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
