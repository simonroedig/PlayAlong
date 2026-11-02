"use client";

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { ChordDiagram } from "@/components/player/ChordDiagram";
import { chordColor } from "@/lib/chords/colors";
import type { DisplayChord } from "@/lib/chords/sheet";
import { chordLabel, usesFlats, type ChordNotation, type Key } from "@/lib/chords/vocabulary";
import { pickVoicing } from "@/lib/chords/voicings";

/**
 * Every chord the song uses, once, in order of appearance: in its colour,
 * how often it comes, and how to finger it. The arrows switch to another
 * fingering; the choice is kept with the song and used everywhere.
 */

const OPEN_KEY = "playalong:chord-overview";

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

export interface VoicingChoice {
  choice: Readonly<Record<string, number>>;
  onChoice: (key: string, index: number) => void;
}

export function ChordOverview({
  chords,
  part,
  shift,
  shapeKey,
  notation,
  voicings,
}: {
  chords: DisplayChord[];
  /** Only the chords of this song of the recording. */
  part: number;
  /** Semitones from sounding chords to the shapes played (capo, tuning). */
  shift: number;
  shapeKey: Key | null;
  notation: ChordNotation;
  voicings: VoicingChoice;
}) {
  const [open, setOpenState] = useState(readOpen);
  const setOpen = (value: boolean) => {
    setOpenState(value);
    try {
      localStorage.setItem(OPEN_KEY, value ? "1" : "0");
    } catch {
      // storage blocked
    }
  };

  const distinct = useMemo(() => {
    const byKey = new Map<string, { chord: DisplayChord; count: number }>();
    for (const c of chords) {
      if (c.part !== part || c.root === null) continue;
      const k = `${c.root}:${c.quality}`;
      const seen = byKey.get(k);
      if (seen) seen.count++;
      else byKey.set(k, { chord: c, count: 1 });
    }
    return [...byKey.values()];
  }, [chords, part]);

  if (distinct.length === 0) return null;
  const spelling = shapeKey ? (usesFlats(shapeKey) ? "flat" : "sharp") : "shape";

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-zinc-400 uppercase hover:text-zinc-200"
      >
        <ChevronDown className={`size-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
        {distinct.length} {distinct.length === 1 ? "chord" : "chords"} in this song
        {!open && (
          <span className="ml-1 flex gap-2 font-semibold tracking-normal normal-case">
            {distinct.map(({ chord }) => (
              <span key={`${chord.root}:${chord.quality}`} style={{ color: chordColor(chord.degree) }}>
                {chord.label}
              </span>
            ))}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {distinct.map(({ chord, count }) => {
            const color = chordColor(chord.degree);
            const { voicing, index, all, key } = pickVoicing((chord.root ?? 0) + shift, chord.quality, voicings.choice);
            const name = chordLabel({ root: chord.root, quality: chord.quality, bass: null }, { transpose: shift, spelling });
            return (
              <div key={`${chord.root}:${chord.quality}`} className="flex shrink-0 flex-col items-center rounded-2xl border border-white/10 bg-white/[0.03] px-2.5 pt-2 pb-1.5">
                <div className="flex w-full items-baseline justify-between gap-2">
                  <span className="text-lg font-bold tracking-tight" style={{ color }}>
                    {notation === "roman" ? chord.label.split("/")[0] : name}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-500" title="How often it comes in this song">
                    ×{count}
                  </span>
                </div>
                {notation === "roman" && <span className="-mt-0.5 self-start text-[11px] text-zinc-400">{name}</span>}
                <ChordDiagram voicing={voicing} color={color} />
                <div className="flex items-center gap-1" title={voicing.name}>
                  <button
                    type="button"
                    onClick={() => voicings.onChoice(key, (index - 1 + all.length) % all.length)}
                    disabled={all.length < 2}
                    aria-label={`Previous fingering for ${name}`}
                    className="rounded-md p-0.5 text-zinc-500 hover:bg-white/10 hover:text-zinc-100 disabled:opacity-30"
                  >
                    <ChevronLeft className="size-3.5" />
                  </button>
                  <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
                    {index + 1}/{all.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => voicings.onChoice(key, (index + 1) % all.length)}
                    disabled={all.length < 2}
                    aria-label={`Next fingering for ${name}`}
                    className="rounded-md p-0.5 text-zinc-500 hover:bg-white/10 hover:text-zinc-100 disabled:opacity-30"
                  >
                    <ChevronRight className="size-3.5" />
                  </button>
                </div>
                <span className="max-w-28 truncate text-center text-[10px] text-zinc-500">{voicing.name}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
