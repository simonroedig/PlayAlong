"use client";

import { Grid3x3, ListMusic, Loader2, Minus, MoveDown, Plus, RotateCcw, TextQuote, TriangleAlert } from "lucide-react";
import { Fragment, memo, useMemo, useRef, useState } from "react";
import { BackToNow } from "@/components/player/BackToNow";
import { LyricsView } from "@/components/player/LyricsView";
import { KeyChangeTag, SongHeading, SongSwitcher, clock } from "@/components/player/SongParts";
import { Select } from "@/components/ui/Select";
import { StemProgress } from "@/components/ui/StemProgress";
import { STEM_INFO } from "@/lib/mixer";
import type { ChordState } from "@/hooks/useChords";
import type { LyricsState } from "@/hooks/useLyrics";
import { useChordPlayhead } from "@/hooks/useChordPlayhead";
import { readFollowPreference, useFollowScroll, writeFollowPreference } from "@/hooks/useFollowScroll";
import type { LoopRegion, PlayerEngine } from "@/lib/audio/engine";
import type { ChordAnalysis, SongPart } from "@/lib/chords/analyze";
import type { ChordPhase } from "@/lib/chords/protocol";
import {
  beatInBar,
  chordBars,
  displayKey,
  keyAt,
  partOfBeat,
  referencePitch,
  shapeShift,
  songParts,
  type Bar,
  type ChordView,
  type DisplayChord,
} from "@/lib/chords/sheet";
import { keyName } from "@/lib/chords/vocabulary";

interface Props {
  engine: PlayerEngine | null;
  state: ChordState;
  chords: DisplayChord[] | null;
  duration: number;
  view: ChordView;
  onViewChange: (view: ChordView) => void;
  /** The active loop, if any (highlighted in the chart). */
  loop: LoopRegion | null;
  onSeek: (seconds: number) => void;
  onLoop: (region: LoopRegion) => void;
  onReanalyze: () => void;
  lyrics: LyricsState;
  lyricsAuto: boolean;
  onLyricsAuto: (auto: boolean) => void;
  onTranscribe: (language: string | null) => void;
}

type Tab = "chart" | "lyrics";
const TAB_KEY = "playalong:sheet-tab";

function readTab(): Tab {
  try {
    return localStorage.getItem(TAB_KEY) === "lyrics" ? "lyrics" : "chart";
  } catch {
    return "chart";
  }
}

const PHASES: Record<ChordPhase, { label: string; from: number; to: number }> = {
  model: { label: "Loading the chord model", from: 0, to: 0.08 },
  prepare: { label: "Finding the beat and the tuning", from: 0.08, to: 0.3 },
  recognise: { label: "Recognising chords", from: 0.3, to: 0.95 },
  decode: { label: "Writing the chord chart", from: 0.95, to: 1 },
};

const TUNINGS = [
  { value: 0, label: "Standard tuning" },
  { value: 1, label: "Half step down (E♭)" },
  { value: 2, label: "Whole step down (D)" },
];

/**
 * Play-along display: the chord now and next with a beat counter, and the
 * whole song as a bar chart or as lyrics with chords, following the playhead.
 */
export function ChordPanel(props: Props) {
  const { state } = props;
  return (
    <section className="rounded-3xl border border-white/10 bg-ink-900/70 p-4 sm:p-5" aria-label="Chords">
      {state.status === "ready" && props.chords ? (
        <ChordChart {...props} analysis={state.analysis} chords={props.chords} />
      ) : (
        <>
          <Header />
          {state.status === "running" && <Progress phase={state.phase} fraction={state.fraction} />}
          {state.status === "error" && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl bg-red-500/[0.06] px-4 py-3 text-sm text-red-200">
              <TriangleAlert className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">Chord detection failed: {state.message}</span>
              <button
                type="button"
                onClick={props.onReanalyze}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-zinc-100 hover:bg-white/15"
              >
                <RotateCcw className="size-3.5" /> Try again
              </button>
            </div>
          )}
          {state.status === "error" && (
            <LyricsView
              engine={props.engine}
              state={props.lyrics}
              chords={null}
              currentChord={-1}
              duration={props.duration}
              follow
              auto={props.lyricsAuto}
              onAuto={props.onLyricsAuto}
              onTranscribe={props.onTranscribe}
              onSeek={props.onSeek}
              onLoop={props.onLoop}
            />
          )}
        </>
      )}
    </section>
  );
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-200">
        <ListMusic className="size-4 text-zinc-400" /> Chords &amp; lyrics
      </h2>
      {children}
    </div>
  );
}

function Progress({ phase, fraction }: { phase: ChordPhase; fraction: number }) {
  const { label, from, to } = PHASES[phase];
  const overall = from + (to - from) * Math.max(0, Math.min(1, fraction));
  return (
    <div className="mt-4" role="status">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-zinc-300">
          {label}
          {phase === "recognise" || phase === "model" ? ` · ${Math.round(fraction * 100)} %` : "…"}
        </span>
        <span className="text-xs text-zinc-500">the player already works meanwhile</span>
      </div>
      <div className="mt-3">
        <StemProgress
          lanes={[
            { color: STEM_INFO.guitar.color, label: "Guitar" },
            { color: STEM_INFO.bass.color, label: "Bass" },
            { color: STEM_INFO.piano.color, label: "Keys" },
          ]}
          fraction={overall}
          blocks={40}
          size="sm"
        />
      </div>
    </div>
  );
}

function ChordChart({
  engine,
  analysis,
  chords,
  duration,
  view,
  onViewChange,
  loop,
  onSeek,
  onLoop,
  onReanalyze,
  lyrics,
  lyricsAuto,
  onLyricsAuto,
  onTranscribe,
}: Props & { analysis: ChordAnalysis; chords: DisplayChord[] }) {
  const position = useChordPlayhead(engine, analysis, chords);
  const bars = useMemo(() => chordBars(analysis, chords, duration), [analysis, chords, duration]);
  const barStarts = useMemo(() => bars.map((b) => b.startBeat), [bars]);
  const currentBar = position.beat < 0 ? -1 : upperIndex(barStarts, position.beat);
  const current = position.chord >= 0 ? chords[position.chord] : null;
  const next = position.chord + 1 < chords.length ? chords[position.chord + 1] : null;
  const beatsToNext = next && position.beat >= 0 ? next.startBeat - position.beat : null;
  const beatNow = position.beat >= 0 ? beatInBar(analysis, position.beat) : -1;
  // A live set or medley holds several songs, each with its own key, tempo and metre.
  const parts = useMemo(() => songParts(analysis), [analysis]);
  const partIndex = position.beat >= 0 ? partOfBeat(parts, position.beat) : 0;
  const part = parts[partIndex];
  const now = position.beat >= 0 ? analysis.beats[position.beat] : 0;
  const partKey = keyAt(part, now);
  const nextChange = part.keyChanges.find((c) => c.start > now) ?? null;

  const [follow, setFollow] = useState(readFollowPreference);
  const toggleFollow = () =>
    setFollow((f) => {
      writeFollowPreference(!f);
      return !f;
    });
  const [tab, setTabState] = useState<Tab>(readTab);
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // storage blocked
    }
  };

  const shift = shapeShift(view);
  const soundingKey = partKey ? keyName(partKey) : null;
  const shapeKey = displayKey(partKey, view);
  const cents = analysis.tuningCents;

  return (
    <>
      <Header>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Chord detail" className="flex h-9 items-center rounded-xl border border-white/10 bg-white/[0.04] p-0.5 text-xs font-medium">
            {[
              { simple: true, label: "Simple", hint: "Major and minor chords only" },
              { simple: false, label: "Full", hint: "With 7ths, sus chords and bass notes (slash chords)" },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={view.simple === o.simple}
                title={o.hint}
                onClick={() => onViewChange({ ...view, simple: o.simple })}
                className={`h-full rounded-[9px] px-3 transition ${
                  view.simple === o.simple ? "bg-zinc-100 text-ink-950" : "text-zinc-400 hover:text-zinc-100"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex h-9 items-center gap-0.5 rounded-xl border border-white/10 bg-white/[0.04] p-0.5 text-xs" title="Show the chord shapes to play with a capo">
            <StepButton label="Capo down" onClick={() => onViewChange({ ...view, capo: Math.max(0, view.capo - 1) })} disabled={view.capo === 0}>
              <Minus className="size-3" />
            </StepButton>
            <span className="w-14 text-center font-medium text-zinc-300">{view.capo === 0 ? "No capo" : `Capo ${view.capo}`}</span>
            <StepButton label="Capo up" onClick={() => onViewChange({ ...view, capo: Math.min(9, view.capo + 1) })} disabled={view.capo === 9}>
              <Plus className="size-3" />
            </StepButton>
          </div>
          <Select label="Guitar tuning" value={view.tuneDown} onChange={(tuneDown) => onViewChange({ ...view, tuneDown })} options={TUNINGS} />
        </div>
      </Header>

      {parts.length > 1 && <SongSwitcher parts={parts} current={partIndex} onSeek={onSeek} />}

      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
        {parts.length > 1 && <span className="font-semibold text-zinc-300">Song {partIndex + 1}</span>}
        {soundingKey && (
          <span>
            Key <span className="text-zinc-300">{soundingKey}</span>
            {shift !== 0 && shapeKey && (
              <>
                {" "}
                · play in <span className="text-zinc-300">{keyName(shapeKey)}</span> shapes
              </>
            )}
          </span>
        )}
        <span>
          <span className="text-zinc-300">{Math.round(part.bpm)}</span> BPM · {part.beatsPerBar}/4
        </span>
        {nextChange && (
          <span title="The song changes key here">
            Key change to <span className="text-zinc-300">{keyName(nextChange.key)}</span> at {clock(nextChange.start)}
          </span>
        )}
        {Math.abs(cents) >= 10 && (
          <span title="The recording is not tuned to A = 440 Hz. Tune your instrument to this reference to match it.">
            Recording {cents > 0 ? "+" : "−"}
            {Math.abs(cents)} cents · tune to <span className="text-zinc-300">A = {referencePitch(cents)} Hz</span>
          </span>
        )}
      </p>

      <NowNext
        current={current}
        next={next}
        beatsToNext={beatsToNext}
        beat={beatNow}
        beatsPerBar={part.beatsPerBar}
        bar={currentBar >= 0 ? bars[currentBar].number : null}
      />

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Show" className="flex rounded-2xl border border-white/10 bg-white/[0.04] p-1 text-sm font-semibold">
          {(
            [
              ["chart", "Chord chart", Grid3x3],
              ["lyrics", "Chords + lyrics", TextQuote],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`inline-flex h-10 items-center gap-2 rounded-xl px-4 transition ${
                tab === id ? "bg-zinc-50 text-ink-950 shadow" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              }`}
            >
              <Icon className="size-4" />
              {label}
              {id === "lyrics" && lyrics.status === "running" && <Loader2 className="size-3.5 animate-spin" />}
            </button>
          ))}
        </div>
        <FollowToggle follow={follow} onToggle={toggleFollow} />
      </div>
      {tab === "chart" ? (
        <>
          <ChordSheet
            bars={bars}
            parts={parts}
            currentBar={currentBar}
            currentChord={position.chord}
            follow={follow}
            loop={loop}
            onSeek={onSeek}
            onLoop={onLoop}
          />
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
            <span>
              Detected automatically. Chords in <span className="text-zinc-300 italic">italics</span> are uncertain. Click a bar
              to jump there, Shift+click another bar to loop the passage.
            </span>
            <button
              type="button"
              onClick={onReanalyze}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-white/5 hover:text-zinc-300"
            >
              <RotateCcw className="size-3" /> Detect again
            </button>
          </p>
        </>
      ) : (
        <LyricsView
          engine={engine}
          parts={parts}
          state={lyrics}
          chords={chords}
          currentChord={position.chord}
          duration={duration}
          follow={follow}
          auto={lyricsAuto}
          onAuto={onLyricsAuto}
          onTranscribe={onTranscribe}
          onSeek={onSeek}
          onLoop={onLoop}
        />
      )}
    </>
  );
}

/** Index of the last bar starting at or before `beat`. */
function upperIndex(starts: number[], beat: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= beat) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export function FollowToggle({ follow, onToggle }: { follow: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={follow}
      onClick={onToggle}
      title={follow ? "The chart scrolls along with the music. Click to stop" : "Scroll the chart along with the music"}
      className={`inline-flex h-11 items-center gap-2.5 rounded-2xl border px-4 text-sm font-semibold transition ${
        follow ? "border-white/15 bg-white/[0.07] text-zinc-50" : "border-white/10 text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
      }`}
    >
      <MoveDown className="size-4" />
      Follow the music
      <span className={`h-5 w-9 rounded-full p-0.5 transition ${follow ? "bg-guitar" : "bg-white/15"}`} aria-hidden>
        <span className={`block size-4 rounded-full bg-white shadow transition ${follow ? "translate-x-4" : ""}`} />
      </span>
    </button>
  );
}

function StepButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-8 place-items-center rounded-[9px] text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function NowNext({
  current,
  next,
  beatsToNext,
  beat,
  beatsPerBar,
  bar,
}: {
  current: DisplayChord | null;
  next: DisplayChord | null;
  beatsToNext: number | null;
  beat: number;
  beatsPerBar: number;
  bar: number | null;
}) {
  const counting = beatsToNext !== null && beatsToNext > 0 && beatsToNext <= beatsPerBar;
  return (
    <div className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-8 sm:p-5">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold tracking-[0.16em] text-zinc-400 uppercase">Now</div>
        <div
          className={`overflow-visible pr-[0.15em] text-6xl leading-none font-bold tracking-tight whitespace-nowrap text-zinc-50 sm:text-7xl ${
            current?.uncertain ? "italic" : ""
          }`}
          aria-live="off"
          title={current?.uncertain ? "Uncertain, check by ear" : undefined}
        >
          {current?.label ?? "·"}
        </div>
      </div>
      <div className="min-w-0 border-white/10 sm:border-l sm:pl-8">
        <div className="text-[11px] font-semibold tracking-[0.16em] text-zinc-400 uppercase">
          Next{beatsToNext !== null && beatsToNext > 0 ? ` · in ${beatsToNext} ${beatsToNext === 1 ? "beat" : "beats"}` : ""}
        </div>
        <div className={`pr-[0.15em] text-3xl font-semibold whitespace-nowrap text-zinc-300 sm:text-4xl ${next?.uncertain ? "italic" : ""}`}>
          {next?.label ?? "·"}
        </div>
        {counting && (
          <div className="mt-2 flex gap-1" aria-hidden>
            {Array.from({ length: beatsToNext }, (_, i) => (
              <span key={i} className="h-1 w-5 rounded-full bg-zinc-400/60" />
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex gap-2" aria-label={beat >= 0 ? `Beat ${beat + 1} of ${beatsPerBar}` : undefined}>
          {Array.from({ length: beatsPerBar }, (_, i) => (
            <span
              key={i}
              className={`size-3.5 rounded-full transition-colors duration-75 ${
                i === beat ? (i === 0 ? "bg-guitar shadow-[0_0_12px_rgba(251,146,60,0.7)]" : "bg-zinc-50") : "bg-white/10"
              }`}
            />
          ))}
        </div>
        {bar !== null && <span className="w-14 font-mono text-xs text-zinc-500 tabular-nums">{bar ? `bar ${bar}` : "pick-up"}</span>}
      </div>
    </div>
  );
}

const ChordSheet = memo(function ChordSheet({
  bars,
  parts,
  currentBar,
  currentChord,
  follow,
  loop,
  onSeek,
  onLoop,
}: {
  bars: Bar[];
  parts: SongPart[];
  currentBar: number;
  currentChord: number;
  follow: boolean;
  loop: LoopRegion | null;
  onSeek: (seconds: number) => void;
  onLoop: (region: LoopRegion) => void;
}) {
  const anchor = useRef<number | null>(null);
  const { ref, onUserScroll, onScroll, away, recenter } = useFollowScroll<HTMLDivElement>(
    follow,
    currentBar >= 0 ? `[data-bar="${currentBar}"]` : null,
  );

  return (
    <div className="relative mt-3">
    <div
      ref={ref}
      onWheel={onUserScroll}
      onTouchMove={onUserScroll}
      onScroll={onScroll}
      className="relative max-h-[19rem] overflow-y-auto rounded-2xl border border-white/5 bg-black/20 p-1.5"
    >
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {bars.map((bar, i) => {
          const active = i === currentBar;
          const firstOfSong = parts.length > 1 && (i === 0 || bars[i - 1].part !== bar.part);
          const change = parts[bar.part]?.keyChanges.find((c) => c.startBeat >= bar.startBeat && c.startBeat < bar.startBeat + bar.beats) ?? null;
          // Bars mostly inside the loop.
          const looped = loop !== null && Math.min(bar.end, loop.end) - Math.max(bar.start, loop.start) > 0.5 * (bar.end - bar.start);
          return (
            <Fragment key={bar.startBeat}>
            {firstOfSong && <SongHeading part={parts[bar.part]} index={bar.part} />}
            <button
              type="button"
              data-bar={i}
              onClick={(e) => {
                if (e.shiftKey && anchor.current !== null) {
                  const a = bars[Math.min(anchor.current, i)];
                  const b = bars[Math.max(anchor.current, i)];
                  onLoop({ start: a.start, end: b.end });
                } else {
                  anchor.current = i;
                  onSeek(bar.start);
                }
              }}
              title={`Bar ${bar.number}: click to jump, Shift+click to loop from the last clicked bar`}
              className={`relative flex h-14 items-stretch overflow-hidden rounded-xl border text-left transition ${
                active
                  ? "border-guitar/70 bg-guitar/[0.08] shadow-[0_0_0_1px_rgba(251,146,60,0.35)]"
                  : looped
                    ? "border-white/25 bg-white/[0.05] hover:bg-white/[0.07]"
                    : "border-white/5 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]"
              }`}
            >
              <span className="absolute top-1 left-1.5 font-mono text-[9px] text-zinc-600">{bar.number || "pick-up"}</span>
              {change && <KeyChangeTag value={change.key} />}
              {bar.cells.length === 0 && <span className="flex-1" />}
              {bar.cells.map((cell) => {
                const playing = active && cell.chordIndex === currentChord;
                const narrow = cell.beats < 3 && bar.cells.length > 1;
                return (
                  <span
                    key={cell.offset}
                    style={{ flexGrow: cell.beats, flexBasis: 0 }}
                    className={`flex min-w-0 items-end pb-1.5 ${narrow ? "pl-1" : "pl-1.5"} ${cell.offset > 0 ? "border-l border-white/5" : ""}`}
                  >
                    <span
                      className={`min-w-0 truncate pr-[0.2em] font-semibold tracking-tight ${narrow ? "text-sm sm:text-base" : "text-base sm:text-lg"} ${
                        playing ? "text-guitar" : cell.continued ? "text-zinc-400" : "text-zinc-100"
                      } ${cell.uncertain ? "italic" : ""}`}
                      title={cell.uncertain ? "Uncertain, check by ear" : undefined}
                    >
                      {cell.label}
                    </span>
                  </span>
                );
              })}
            </button>
            </Fragment>
          );
        })}
      </div>
    </div>
    <BackToNow show={away} onClick={recenter} />
    </div>
  );
});

