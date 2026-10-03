"use client";

import { useRef, useState } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import type { PlayerEngine } from "@/lib/audio/engine";
import type { ChordAnalysis } from "@/lib/chords/analyze";
import { beatIndexAt, chordIndexAt, type DisplayChord } from "@/lib/chords/sheet";

export interface ChordPlayhead {
  /** Index into the display chords, -1 before the first one. */
  chord: number;
  /** Index into analysis.beats, -1 before the first beat. */
  beat: number;
}

/** Current chord and beat, re-rendering only when either changes. */
export function useChordPlayhead(
  engine: PlayerEngine | null,
  analysis: ChordAnalysis | null,
  chords: readonly DisplayChord[] | null,
): ChordPlayhead {
  const [position, setPosition] = useState<ChordPlayhead>({ chord: -1, beat: -1 });
  const last = useRef(position);
  useAnimationFrame(
    () => {
      if (!engine || !analysis || !chords) return;
      const t = engine.currentTime();
      const next = { chord: chordIndexAt(chords, t), beat: beatIndexAt(analysis.beats, t) };
      if (next.chord !== last.current.chord || next.beat !== last.current.beat) {
        last.current = next;
        setPosition(next);
      }
    },
    engine !== null && analysis !== null && chords !== null,
  );
  return position;
}
