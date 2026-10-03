"use client";

import { useCallback, useEffect, useState } from "react";
import { CHORD_ANALYSIS_VERSION, type ChordAnalysis } from "@/lib/chords/analyze";
import { startChordAnalysis } from "@/lib/chords/client";
import type { ChordPhase } from "@/lib/chords/protocol";
import { updateSong, type SongRecord } from "@/lib/storage/library";

export type ChordState =
  | { status: "ready"; analysis: ChordAnalysis }
  | { status: "running"; phase: ChordPhase; fraction: number }
  | { status: "error"; message: string };

function storedAnalysis(song: SongRecord): ChordAnalysis | null {
  return song.chords?.version === CHORD_ANALYSIS_VERSION ? song.chords : null;
}

/**
 * The song's chords: from the library, or detected in a worker (once, then
 * stored). Detection starts as soon as the stems are available, so the
 * player is usable while it runs.
 */
export function useChords(song: SongRecord, stems: Int16Array[], frames: number) {
  const [state, setState] = useState<ChordState>(() => {
    const stored = storedAnalysis(song);
    return stored ? { status: "ready", analysis: stored } : { status: "running", phase: "model", fraction: 0 };
  });
  const [attempt, setAttempt] = useState(0);
  const needsAnalysis = attempt > 0 || storedAnalysis(song) === null;
  const songId = song.id;

  useEffect(() => {
    if (!needsAnalysis) return;
    const job = startChordAnalysis(stems, frames, (phase, fraction) => setState({ status: "running", phase, fraction }));
    job.promise.then(
      ({ analysis }) => {
        setState({ status: "ready", analysis });
        void updateSong(songId, { chords: analysis });
      },
      (err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => job.cancel();
  }, [needsAnalysis, songId, stems, frames, attempt]);

  const reanalyze = useCallback(() => {
    setState({ status: "running", phase: "model", fraction: 0 });
    setAttempt((a) => a + 1);
  }, []);

  return { state, reanalyze };
}
