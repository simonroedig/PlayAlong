"use client";

import { memo } from "react";
import { useChordPlayhead } from "@/hooks/useChordPlayhead";
import type { PlayerEngine } from "@/lib/audio/engine";
import type { ChordAnalysis } from "@/lib/chords/analyze";
import type { DisplayChord } from "@/lib/chords/sheet";

/** Hue per root along the circle of fifths, so related chords look related. */
function hue(root: number) {
  return ((root * 7) % 12) * 30;
}

/** The chords along the song's timeline, under the waveform. Click to jump. */
export function ChordLane({
  engine,
  analysis,
  chords,
  duration,
  onSeek,
}: {
  engine: PlayerEngine | null;
  analysis: ChordAnalysis;
  chords: DisplayChord[];
  duration: number;
  onSeek: (seconds: number) => void;
}) {
  const { chord } = useChordPlayhead(engine, analysis, chords);
  return <Lane chords={chords} current={chord} duration={duration} onSeek={onSeek} />;
}

const Lane = memo(function Lane({
  chords,
  current,
  duration,
  onSeek,
}: {
  chords: DisplayChord[];
  current: number;
  duration: number;
  onSeek: (seconds: number) => void;
}) {
  if (duration <= 0) return null;
  return (
    <div className="relative mt-2 h-7 w-full overflow-hidden rounded-md bg-white/[0.02]" aria-label="Chord timeline">
      {chords.map((c, i) => {
        if (c.root === null) return null;
        const left = (c.start / duration) * 100;
        const width = ((Math.min(c.end, duration) - c.start) / duration) * 100;
        const h = hue(c.root);
        const active = i === current;
        return (
          <button
            key={`${c.startBeat}-${c.label}`}
            type="button"
            tabIndex={-1}
            onClick={() => onSeek(c.start)}
            title={`${c.label}${c.uncertain ? " (uncertain)" : ""}`}
            className={`absolute inset-y-0 overflow-hidden border-l px-1 text-left text-[11px] leading-7 font-semibold whitespace-nowrap transition-colors ${
              c.uncertain ? "italic" : ""
            }`}
            style={{
              left: `${left}%`,
              width: `${width}%`,
              borderColor: `hsl(${h} 70% 62% / ${active ? 0.9 : 0.45})`,
              background: `hsl(${h} 70% 62% / ${active ? 0.32 : c.uncertain ? 0.05 : 0.12})`,
              color: active ? "#fafafa" : c.uncertain ? "rgb(161 161 170 / 0.7)" : `hsl(${h} 70% 82%)`,
            }}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
});
