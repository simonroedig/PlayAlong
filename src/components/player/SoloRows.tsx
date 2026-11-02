"use client";

import { useMemo, useSyncExternalStore } from "react";
import { ChordDiagram } from "@/components/player/ChordDiagram";
import { alpha, chordColor } from "@/lib/chords/colors";
import type { Voicing } from "@/lib/chords/voicings";
import type { Bar, DisplayChord } from "@/lib/chords/sheet";

/**
 * Solo along: two rows of the chord chart in place of "now and next". The
 * row being played is always on top with the current bar lit in its chord's
 * colour, the next row below; when the music reaches it, the rows slide up.
 * Fixed places make it easy to keep track of what came before and what comes.
 */

const ROW_HEIGHT = 64;
const GAP = 6;

const wide = (onChange: () => void) => {
  const query = window.matchMedia("(min-width: 640px)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/** Bars per row, as in the chord chart: four, or two on a phone. */
function useColumns(): number {
  return useSyncExternalStore(
    wide,
    () => (window.matchMedia("(min-width: 640px)").matches ? 4 : 2),
    () => 4,
  );
}

export function SoloRows({
  bars,
  chords,
  currentBar,
  currentChord,
  beat,
  onSeek,
  fingering,
}: {
  bars: Bar[];
  chords: DisplayChord[];
  currentBar: number;
  currentChord: number;
  /** Beat within the bar, -1 before the music starts. */
  beat: number;
  onSeek: (seconds: number) => void;
  /** How to finger the chord now, shown beside the rows. */
  fingering: { voicing: Voicing; color: string } | null;
}) {
  const columns = useColumns();
  // Rows as in the chart: every song starts a new row.
  const rows = useMemo(() => {
    const out: number[][] = [];
    bars.forEach((bar, i) => {
      const row = out[out.length - 1];
      if (row && row.length < columns && bars[row[0]].part === bar.part) row.push(i);
      else out.push([i]);
    });
    return out;
  }, [bars, columns]);
  const currentRow = Math.max(
    0,
    rows.findIndex((row) => row.includes(currentBar)),
  );

  return (
    <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-2">
      {/* Exactly two rows visible; the rest slides past outside this frame. */}
      <div className="min-w-0 flex-1 overflow-hidden rounded-xl" style={{ height: 2 * ROW_HEIGHT + GAP }}>
        <div className="flex flex-col transition-transform duration-500 ease-out" style={{ gap: GAP, transform: `translateY(-${currentRow * (ROW_HEIGHT + GAP)}px)` }}>
          {rows.map((row, r) => (
            <div key={bars[row[0]].startBeat} className="grid gap-1.5" style={{ height: ROW_HEIGHT, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {row.map((i) => (
                <SoloBar key={i} bar={bars[i]} chords={chords} active={i === currentBar} past={r === currentRow && i < currentBar} currentChord={currentChord} beat={beat} onSeek={onSeek} />
              ))}
            </div>
          ))}
        </div>
      </div>
      {fingering && (
        <div className="hidden shrink-0 pr-2 sm:block">
          <ChordDiagram voicing={fingering.voicing} color={fingering.color} />
        </div>
      )}
    </div>
  );
}

function SoloBar({
  bar,
  chords,
  active,
  past,
  currentChord,
  beat,
  onSeek,
}: {
  bar: Bar;
  chords: DisplayChord[];
  active: boolean;
  past: boolean;
  currentChord: number;
  beat: number;
  onSeek: (seconds: number) => void;
}) {
  const playing = active && currentChord >= 0 ? chords[currentChord] : null;
  const color = playing ? chordColor(playing.degree) : null;
  return (
    <button
      type="button"
      onClick={() => onSeek(bar.start)}
      title={`Bar ${bar.number}: click to jump there`}
      className={`relative flex min-w-0 items-stretch overflow-hidden rounded-xl border text-left transition-[background-color,border-color,opacity] duration-300 ${
        past ? "opacity-45" : ""
      } ${active ? "" : "border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05]"}`}
      style={active && color ? { borderColor: alpha(color, 0.9), background: alpha(color, 0.14), boxShadow: `0 0 16px ${alpha(color, 0.25)}` } : undefined}
    >
      <span className="absolute top-1 left-1.5 font-mono text-[9px] text-zinc-500">{bar.number || "pick-up"}</span>
      {bar.cells.length === 0 && <span className="flex-1" />}
      {bar.cells.map((cell) => {
        const chord = chords[cell.chordIndex];
        const c = chord?.root === null ? null : chordColor(chord?.degree);
        const now = active && cell.chordIndex === currentChord;
        return (
          <span
            key={cell.offset}
            style={{ flexGrow: cell.beats, flexBasis: 0 }}
            className={`flex min-w-0 items-end pb-2 pl-1.5 ${cell.offset > 0 ? "border-l border-white/5" : ""}`}
          >
            <span
              className={`min-w-0 truncate pr-[0.2em] tracking-tight ${now ? "text-2xl font-bold sm:text-3xl" : "text-lg font-semibold sm:text-xl"} ${cell.uncertain ? "italic" : ""}`}
              style={{ color: c ?? "#a1a1aa", opacity: cell.continued && !now ? 0.55 : 1 }}
            >
              {cell.label}
            </span>
          </span>
        );
      })}
      {active && beat >= 0 && (
        <span className="absolute top-1.5 right-1.5 flex gap-1" aria-label={`Beat ${beat + 1} of ${bar.beats}`}>
          {Array.from({ length: bar.beats }, (_, i) => (
            <span key={i} className="size-1.5 rounded-full" style={{ background: i <= beat ? (color ?? "#fafafa") : "rgba(255,255,255,0.15)" }} />
          ))}
        </span>
      )}
    </button>
  );
}
