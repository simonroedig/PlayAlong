"use client";

import { Languages, Loader2, Mic, Music2, RotateCcw, TriangleAlert } from "lucide-react";
import { memo, useMemo, useRef, useState } from "react";
import { BackToNow } from "@/components/player/BackToNow";
import { Select } from "@/components/ui/Select";
import { useFollowScroll } from "@/hooks/useFollowScroll";
import type { LyricsState } from "@/hooks/useLyrics";
import { useSheetPlayhead } from "@/hooks/useSheetPlayhead";
import type { LoopRegion, PlayerEngine } from "@/lib/audio/engine";
import type { DisplayChord } from "@/lib/chords/sheet";
import { LYRICS_LANGUAGES, LYRICS_MODEL_LABEL, languageName } from "@/lib/lyrics/model";
import { lyricsLanguages, lyricsSheet, type SheetLine } from "@/lib/lyrics/sheet";

interface Props {
  engine: PlayerEngine | null;
  state: LyricsState;
  chords: DisplayChord[] | null;
  currentChord: number;
  duration: number;
  follow: boolean;
  auto: boolean;
  onAuto: (auto: boolean) => void;
  onTranscribe: (language: string | null) => void;
  onSeek: (seconds: number) => void;
  onLoop: (region: LoopRegion) => void;
}

const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

/** Lyrics with the chords above the words, following the playhead. */
export function LyricsView(props: Props) {
  const { state } = props;
  if (state.status === "ready") return <LyricsSheet {...props} lyrics={state.lyrics} />;
  return (
    <div className="mt-2 rounded-2xl border border-white/5 bg-black/20 p-5">
      {state.status === "idle" && <Start {...props} />}
      {state.status === "running" && <Running state={state} />}
      {state.status === "error" && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-red-200">
          <TriangleAlert className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">Lyrics transcription failed: {state.message}</span>
          <button
            type="button"
            onClick={() => props.onTranscribe(null)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-zinc-100 hover:bg-white/15"
          >
            <RotateCcw className="size-3.5" /> Try again
          </button>
        </div>
      )}
    </div>
  );
}

const LANGUAGE_OPTIONS = [{ value: "", label: "Detect language" }, ...LYRICS_LANGUAGES.map((l) => ({ value: l.code, label: l.name }))];

function LanguageSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return <Select label={label} value={value} onChange={onChange} options={LANGUAGE_OPTIONS} />;
}

function Start({ auto, onAuto, onTranscribe }: Props) {
  const [language, setLanguage] = useState("");
  return (
    <div className="space-y-3 text-sm">
      <p className="flex items-start gap-2 text-zinc-300">
        <Mic className="mt-0.5 size-4 shrink-0 text-zinc-400" />
        <span>
          Transcribe the lyrics from the separated vocals with {LYRICS_MODEL_LABEL}, word by word and in sync with the chords.
          It runs on this device; the first time downloads the speech model (about 1 GB).
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <LanguageSelect value={language} onChange={setLanguage} label="Lyrics language" />
        <button
          type="button"
          onClick={() => onTranscribe(language || null)}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-zinc-100 px-3.5 text-xs font-semibold text-ink-950 hover:bg-white"
        >
          <Languages className="size-3.5" /> Transcribe lyrics
        </button>
        <label className="ml-auto inline-flex items-center gap-2 text-xs text-zinc-400">
          <input type="checkbox" checked={auto} onChange={(e) => onAuto(e.target.checked)} className="size-4 accent-zinc-100" />
          Transcribe new songs automatically
        </label>
      </div>
    </div>
  );
}

function Running({ state }: { state: Extract<LyricsState, { status: "running" }> }) {
  const label =
    state.phase === "model"
      ? state.cached
        ? "Loading the lyrics model"
        : state.total
          ? `Downloading the lyrics model · ${mb(state.loaded ?? 0)} of ${mb(state.total)} (one time)`
          : "Loading the lyrics model"
      : state.phase === "load"
        ? "Starting the speech model"
        : state.phase === "prepare"
          ? "Finding the vocals"
          : `Transcribing the vocals · ${Math.round(state.fraction * 100)} %`;
  const overall =
    state.phase === "model" ? 0.15 * state.fraction : state.phase === "load" ? 0.15 + 0.05 * state.fraction : state.phase === "prepare" ? 0.2 : 0.2 + 0.8 * state.fraction;
  return (
    <div role="status" className="text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-zinc-300">
          <Loader2 className="size-3.5 animate-spin" /> {label}
        </span>
        <span className="text-xs text-zinc-500">takes a minute or two · keep playing meanwhile</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full bg-zinc-200 transition-[width] duration-300" style={{ width: `${overall * 100}%` }} />
      </div>
    </div>
  );
}

function LyricsSheet({
  engine,
  lyrics,
  chords,
  currentChord,
  duration,
  follow,
  onTranscribe,
  onSeek,
  onLoop,
}: Props & { lyrics: Extract<LyricsState, { status: "ready" }>["lyrics"] }) {
  const sheet = useMemo(() => lyricsSheet(lyrics.lines, chords, duration), [lyrics, chords, duration]);
  const languages = useMemo(() => lyricsLanguages(lyrics.lines, lyrics.language), [lyrics]);
  const position = useSheetPlayhead(engine, sheet);
  const { ref, onUserScroll, onScroll, away, recenter } = useFollowScroll<HTMLDivElement>(
    follow,
    position.line >= 0 ? `[data-line="${position.line}"]` : null,
  );
  const anchor = useRef<number | null>(null);
  const [language, setLanguage] = useState("");

  const click = (index: number, shift: boolean) => {
    const line = sheet[index];
    if (shift && anchor.current !== null) {
      const a = sheet[Math.min(anchor.current, index)];
      const b = sheet[Math.max(anchor.current, index)];
      onLoop({ start: Math.max(0, a.start - 0.3), end: Math.min(duration, b.end + 0.3) });
    } else {
      anchor.current = index;
      onSeek(Math.max(0, line.start - 0.4));
    }
  };

  return (
    <>
      <div className="relative mt-3">
      <div
        ref={ref}
        onWheel={onUserScroll}
        onTouchMove={onUserScroll}
        onScroll={onScroll}
        className="relative max-h-[26rem] space-y-1 overflow-y-auto rounded-2xl border border-white/5 bg-black/20 p-2"
      >
        {lyrics.lines.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-zinc-500">No sung vocals found in this song.</p>
        )}
        {sheet.map((line, i) => (
          <SheetRow
            key={`${line.kind}-${line.start}`}
            line={line}
            index={i}
            active={i === position.line}
            past={i < position.line}
            word={i === position.line ? position.word : -1}
            currentChord={currentChord}
            onClick={click}
          />
        ))}
      </div>
      <BackToNow show={away} onClick={recenter} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-zinc-500">
        <span>
          {languages.map(languageName).join(" & ")}
          {!lyrics.detected
            ? " · chosen"
            : languages.length > 1
              ? " · detected per line"
              : ` · detected (${Math.round(lyrics.languageProbability * 100)} %)`}{" "}
          · transcribed by{" "}
          {LYRICS_MODEL_LABEL}. Underlined words are unsure. Click a line to jump there, Shift+click another to loop.
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <LanguageSelect value={language} onChange={setLanguage} label="Transcribe again in language" />
          <button
            type="button"
            onClick={() => onTranscribe(language || null)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 px-3 text-zinc-300 hover:bg-white/5 hover:text-zinc-100"
          >
            <RotateCcw className="size-3" /> Transcribe again
          </button>
        </span>
      </div>
    </>
  );
}

const SheetRow = memo(function SheetRow({
  line,
  index,
  active,
  past,
  word,
  currentChord,
  onClick,
}: {
  line: SheetLine;
  index: number;
  active: boolean;
  past: boolean;
  word: number;
  currentChord: number;
  onClick: (index: number, shift: boolean) => void;
}) {
  // The current line stands out: lit background, an accent bar and full brightness.
  const base = `relative block w-full rounded-xl px-4 text-left transition-colors ${
    active
      ? "bg-white/[0.09] shadow-[inset_3px_0_0_var(--color-guitar)]"
      : past
        ? "opacity-60 hover:bg-white/[0.03] hover:opacity-100"
        : "hover:bg-white/[0.03]"
  }`;
  if (line.kind === "instrumental") {
    return (
      <button type="button" data-line={index} onClick={(e) => onClick(index, e.shiftKey)} className={`${base} py-1.5`}>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <Music2 className="size-3.5 text-zinc-600" />
          {line.chords.map((c) => (
            <span
              key={c.index}
              className={`pr-[0.15em] font-semibold ${c.index === currentChord ? "text-guitar" : "text-orange-200/90"} ${c.uncertain ? "italic" : ""}`}
            >
              {c.label}
            </span>
          ))}
        </span>
      </button>
    );
  }
  return (
    <button type="button" data-line={index} onClick={(e) => onClick(index, e.shiftKey)} className={`${base} py-1`}>
      <span className="flex flex-wrap gap-x-[0.4em] text-[17px] leading-snug">
        {line.words.map((w, k) => (
          <span key={k} className="inline-flex flex-col">
            {line.hasChords && (
              <span className="h-5 text-[13px] font-semibold whitespace-nowrap">
                {w.chords.map((c) => (
                  <span
                    key={c.index}
                    className={`mr-1.5 pr-[0.1em] ${c.index === currentChord && active ? "text-guitar" : "text-orange-200/90"} ${
                      c.uncertain ? "italic" : ""
                    }`}
                  >
                    {c.label}
                  </span>
                ))}
              </span>
            )}
            <span
              className={`${
                active ? (k === word ? "text-guitar" : k < word ? "text-zinc-50" : "text-zinc-300") : "text-zinc-300"
              } ${w.uncertain ? "underline decoration-zinc-600 decoration-dotted underline-offset-4" : ""}`}
              title={w.uncertain ? "Unsure, check by ear" : undefined}
            >
              {w.text}
            </span>
          </span>
        ))}
      </span>
    </button>
  );
});
