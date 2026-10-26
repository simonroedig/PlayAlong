"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { alignToVoice, voiceLevels } from "@/lib/lyrics/align";
import { startLyricsTranscription, type LyricsProgressInfo } from "@/lib/lyrics/client";
import { LYRICS_VERSION, type LyricsAnalysis } from "@/lib/lyrics/transcribe";
import { SAMPLE_RATE, SOURCES } from "@/lib/separation/model";
import { updateSong, type SongRecord } from "@/lib/storage/library";

export type LyricsState =
  | { status: "idle" }
  | ({ status: "running" } & LyricsProgressInfo)
  | { status: "ready"; lyrics: LyricsAnalysis }
  | { status: "error"; message: string };

const AUTO_KEY = "playalong:auto-lyrics";

function readAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== "0";
  } catch {
    return true;
  }
}

function storedLyrics(song: SongRecord): LyricsAnalysis | null {
  return song.lyrics?.version === LYRICS_VERSION ? song.lyrics : null;
}

/**
 * The song's lyrics: from the library, or transcribed from the vocal stem in
 * a worker. Starts by itself (when `canStart`, i.e. after the chords) unless
 * the user turned that off; `transcribe(language)` runs it on demand.
 */
export function useLyrics(song: SongRecord, stems: Int16Array[], frames: number, canStart: boolean) {
  const [state, setState] = useState<LyricsState>(() => {
    const stored = storedLyrics(song);
    return stored ? { status: "ready", lyrics: stored } : { status: "idle" };
  });
  const [auto, setAutoState] = useState(readAuto);
  const [request, setRequest] = useState<{ language: string | null; attempt: number }>({ language: null, attempt: 0 });
  const hasStored = storedLyrics(song) !== null;
  const songId = song.id;
  const wanted = request.attempt > 0 || (!hasStored && auto);

  useEffect(() => {
    if (!wanted || !canStart) return;
    const job = startLyricsTranscription(stems, frames, request.language, (progress) =>
      setState({ status: "running", ...progress }),
    );
    job.promise.then(
      ({ lyrics }) => {
        setState({ status: "ready", lyrics });
        void updateSong(songId, { lyrics });
      },
      (err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => job.cancel();
  }, [wanted, canStart, songId, stems, frames, request]);

  const transcribe = useCallback((language: string | null) => {
    setState({ status: "running", phase: "model", fraction: 0 });
    setRequest((r) => ({ language, attempt: r.attempt + 1 }));
  }, []);

  const setAuto = useCallback((value: boolean) => {
    setAutoState(value);
    try {
      localStorage.setItem(AUTO_KEY, value ? "1" : "0");
    } catch {
      // storage blocked
    }
  }, []);

  // Word starts moved to where the voice comes back after a pause (see align.ts).
  const ready = state.status === "ready";
  const levels = useMemo(() => (ready ? voiceLevels(stems[SOURCES.indexOf("vocals")], frames, SAMPLE_RATE) : null), [ready, stems, frames]);
  const aligned = useMemo<LyricsState>(
    () => (state.status === "ready" && levels ? { ...state, lyrics: { ...state.lyrics, lines: alignToVoice(state.lyrics.lines, levels) } } : state),
    [state, levels],
  );

  return { state: aligned, transcribe, auto, setAuto };
}
