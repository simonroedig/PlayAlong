"use client";

import { useMemo, useSyncExternalStore } from "react";
import { ChordDiagram } from "@/components/player/ChordDiagram";
import { alpha, chordColor } from "@/lib/chords/colors";
import type { Bar, DisplayChord } from "@/lib/chords/sheet";
import type { Voicing } from "@/lib/chords/voicings";

/**
 * Two rows of the chord chart in place of "now and next", each chord with
 * the fingering picked for it. The row being played is always on top with
 * the current bar framed in its chord's colour, as in the chart; when the
 * music reaches the next row, the rows slide up. Fixed places make it easy to
 * keep track of what came before and what comes.
 */

const ROW_HEIGHT = 84;
const GAP = 6;
const QUERY = "(min-width: 640px)";

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/** Bars per row, as in the chord chart: four, or two on a phone. */
function useColumns(): number {
  return useSyncExternalStore(
    subscribe,
    () => (window.matchMedia(QUERY).matches ? 4 : 2),
    () => 4,
  );
}

type Fingering = { voicing: Voicing; color: string } | null;

export function SoloRows({
  bars,
  chords,
  currentBar,
  currentChord,
  beat,
  onSeek,
  fingerOf,
}: {
  bars: Bar[];
  chords: DisplayChord[];
  currentBar: number;
  currentChord: number;
  /** Beat within the bar, -1 before the music starts. */
  beat: number;
  onSeek: (seconds: number) => void;
  /** How to finger a chord (the fingering picked for this song). */
  fingerOf: (chord: DisplayChord | null) => Fingering;
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
  // Only the rows near the playhead are drawn (each holds chord diagrams).
  const from = Math.max(0, currentRow - 1);
  const to = Math.min(rows.length, currentRow + 3);

  return (
    <div className="mt-2 rounded-2xl border border-white/5 bg-black/20 p-1.5">
      {/* Exactly two rows visible; the rest slides past outside this frame. */}
      <div className="overflow-hidden rounded-xl" style={{ height: 2 * ROW_HEIGHT + GAP }}>
        <div
          className="relative transition-transform duration-500 ease-out"
          style={{ height: rows.length * (ROW_HEIGHT + GAP), transform: `translateY(-${currentRow * (ROW_HEIGHT + GAP)}px)` }}
        >
          {rows.slice(from, to).map((row, k) => {
            const r = from + k;
            return (
              <div
                key={bars[row[0]].startBeat}
                className="absolute inset-x-0 grid gap-1.5"
                style={{ top: r * (ROW_HEIGHT + GAP), height: ROW_HEIGHT, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
              >
                {row.map((i) => (
                  <RowBar
                    key={i}
                    bar={bars[i]}
                    chords={chords}
                    active={i === currentBar}
                    past={r === currentRow && i < currentBar}
                    currentChord={currentChord}
                    beat={beat}
                    onSeek={onSeek}
                    fingerOf={fingerOf}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RowBar({
  bar,
  chords,
  active,
  past,
  currentChord,
  beat,
  onSeek,
  fingerOf,
}: {
  bar: Bar;
  chords: DisplayChord[];
  active: boolean;
  past: boolean;
  currentChord: number;
  beat: number;
  onSeek: (seconds: number) => void;
  fingerOf: (chord: DisplayChord | null) => Fingering;
}) {
  const color = active && currentChord >= 0 ? chordColor(chords[currentChord].degree) : null;
  return (
    <button
      type="button"
      onClick={() => onSeek(bar.start)}
      title={`Bar ${bar.number}: click to jump there`}
      // Framed like the bar being played in the chart: in its chord's colour.
      style={color ? { borderColor: alpha(color, 0.8), background: alpha(color, 0.1), boxShadow: `0 0 0 1px ${alpha(color, 0.35)}` } : undefined}
      className={`relative flex min-w-0 items-stretch overflow-hidden rounded-xl border text-left transition ${past ? "opacity-45" : ""} ${
        active ? "" : "border-white/5 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]"
      }`}
    >
      <span className="absolute top-1 left-1.5 font-mono text-[9px] text-zinc-600">{bar.number || "pick-up"}</span>
      {bar.cells.length === 0 && <span className="flex-1" />}
      {bar.cells.map((cell) => {
        const chord = chords[cell.chordIndex] ?? null;
        const c = chordColor(chord?.degree);
        const playing = active && cell.chordIndex === currentChord;
        // The fingering sits on the right of the chord, where a bar has room for it.
        const roomy = cell.beats >= 3 || bar.cells.length === 1;
        const fingering = chord && roomy && !cell.continued ? fingerOf(chord) : null;
        return (
          <span
            key={cell.offset}
            style={{ flexGrow: cell.beats, flexBasis: 0 }}
            className={`flex min-w-0 items-end justify-between gap-1 pr-1 pb-1.5 pl-1.5 ${cell.offset > 0 ? "border-l border-white/5" : ""}`}
          >
            <span
              className={`min-w-0 truncate pr-[0.2em] text-base font-semibold tracking-tight sm:text-lg ${cell.uncertain ? "italic" : ""}`}
              style={{ color: c, opacity: cell.continued && !playing ? 0.55 : 1 }}
            >
              {cell.label}
            </span>
            {fingering && (
              <span className="shrink-0 self-center pt-2">
                <ChordDiagram voicing={fingering.voicing} color={fingering.color} size="sm" />
              </span>
            )}
          </span>
        );
      })}
      {active && beat >= 0 && (
        <span className="absolute top-1.5 left-1/2 flex -translate-x-1/2 gap-1" aria-label={`Beat ${beat + 1} of ${bar.beats}`}>
          {Array.from({ length: bar.beats }, (_, i) => (
            <span key={i} className="size-1.5 rounded-full" style={{ background: i <= beat ? (color ?? "#fafafa") : "rgba(255,255,255,0.15)" }} />
          ))}
        </span>
      )}
    </button>
  );
}
