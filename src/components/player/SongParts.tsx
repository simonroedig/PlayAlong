"use client";

import type { SongPart } from "@/lib/chords/analyze";
import { keyName, type Key } from "@/lib/chords/vocabulary";

/** The songs of a live set or medley in the player: switcher, headings, key changes. */

export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export const partSummary = (part: SongPart) => [part.key ? keyName(part.key) : null, `${Math.round(part.bpm)} BPM`, part.beatsPerBar !== 4 ? `${part.beatsPerBar}/4` : null].filter(Boolean).join(" · ");

/** The songs of a live set or medley: where each starts, its key and tempo. Click to jump. */
export function SongSwitcher({ parts, current, onSeek }: { parts: SongPart[]; current: number; onSeek: (seconds: number) => void }) {
  return (
    <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-2">
      <p className="px-1.5 pb-1.5 text-xs text-zinc-500">
        This recording holds {parts.length} songs. Each has its own key and tempo; the chart follows along.
      </p>
      <div className="flex gap-1.5 overflow-x-auto">
        {parts.map((p, i) => (
          <button
            key={p.startBeat}
            type="button"
            onClick={() => onSeek(p.start)}
            aria-current={i === current}
            className={`flex shrink-0 flex-col items-start rounded-xl border px-3 py-1.5 text-left transition ${
              i === current ? "border-guitar/60 bg-guitar/10 text-zinc-50" : "border-white/10 text-zinc-300 hover:border-white/25 hover:bg-white/[0.05]"
            }`}
          >
            <span className="text-sm font-semibold">
              Song {i + 1} <span className="font-mono text-[11px] font-normal text-zinc-500">{clock(p.start)}</span>
            </span>
            <span className="text-[11px] text-zinc-400">{partSummary(p)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A heading between the songs of a live set or medley. */
export function SongHeading({ part, index }: { part: SongPart; index: number }) {
  return (
    <div className="col-span-full flex items-baseline gap-2 px-1.5 pt-3 pb-1 first:pt-1">
      <span className="text-sm font-semibold text-zinc-100">Song {index + 1}</span>
      <span className="text-xs text-zinc-500">{partSummary(part)}</span>
    </div>
  );
}

export function KeyChangeTag({ value }: { value: Key }) {
  return (
    <span className="absolute top-1 right-1.5 rounded bg-guitar/15 px-1 font-mono text-[9px] text-guitar" title="The song changes key here">
      → {keyName(value)}
    </span>
  );
}
