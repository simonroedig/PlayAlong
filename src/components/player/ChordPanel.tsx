"use client";

import { ListMusic, Loader2, Minus, MoveDown, Plus, RotateCcw, TriangleAlert } from "lucide-react";
import { memo, useMemo, useRef, useState } from "react";
import { LyricsView } from "@/components/player/LyricsView";
import type { ChordState } from "@/hooks/useChords";
import type { LyricsState } from "@/hooks/useLyrics";
import { useChordPlayhead } from "@/hooks/useChordPlayhead";
import { readFollowPreference, useFollowScroll, writeFollowPreference } from "@/hooks/useFollowScroll";
import type { LoopRegion, PlayerEngine } from "@/lib/audio/engine";
import type { ChordAnalysis } from "@/lib/chords/analyze";
import type { ChordPhase } from "@/lib/chords/protocol";
import {
  beatInBar,
  chordBars,
  displayKey,
  referencePitch,
  shapeShift,
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
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full bg-zinc-200 transition-[width] duration-300" style={{ width: `${overall * 100}%` }} />
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
  const soundingKey = analysis.key ? keyName(analysis.key) : null;
  const shapeKey = displayKey(analysis.key, view);
  const cents = analysis.tuningCents;

  return (
    <>
      <Header>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Chord detail" className="flex rounded-xl bg-white/5 p-0.5 text-xs font-medium">
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
                className={`rounded-[10px] px-2.5 py-1 transition ${
                  view.simple === o.simple ? "bg-zinc-100 text-ink-950" : "text-zinc-400 hover:text-zinc-100"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-0.5 rounded-xl bg-white/5 p-0.5 text-xs" title="Show the chord shapes to play with a capo">
            <StepButton label="Capo down" onClick={() => onViewChange({ ...view, capo: Math.max(0, view.capo - 1) })} disabled={view.capo === 0}>
              <Minus className="size-3" />
            </StepButton>
            <span className="w-14 text-center font-medium text-zinc-300">{view.capo === 0 ? "No capo" : `Capo ${view.capo}`}</span>
            <StepButton label="Capo up" onClick={() => onViewChange({ ...view, capo: Math.min(9, view.capo + 1) })} disabled={view.capo === 9}>
              <Plus className="size-3" />
            </StepButton>
          </div>
          <select
            aria-label="Guitar tuning"
            value={view.tuneDown}
            onChange={(e) => onViewChange({ ...view, tuneDown: Number(e.target.value) })}
            className="h-7 rounded-xl border-0 bg-white/5 px-2 text-xs font-medium text-zinc-300 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-zinc-400"
          >
            {TUNINGS.map((t) => (
              <option key={t.value} value={t.value} className="bg-ink-900">
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </Header>

      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
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
          <span className="text-zinc-300">{Math.round(analysis.bpm)}</span> BPM · {analysis.beatsPerBar}/4
        </span>
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
        beatsPerBar={analysis.beatsPerBar}
        bar={currentBar >= 0 ? bars[currentBar].number : null}
      />

      <div className="mt-4 flex items-center justify-between gap-2">
        <div role="tablist" aria-label="Show" className="flex rounded-xl bg-white/5 p-0.5 text-xs font-medium">
          {(
            [
              ["chart", "Chart"],
              ["lyrics", "Lyrics"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1 transition ${
                tab === id ? "bg-zinc-100 text-ink-950" : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              {label}
              {id === "lyrics" && lyrics.status === "running" && <Loader2 className="size-3 animate-spin" />}
            </button>
          ))}
        </div>
        <FollowToggle follow={follow} onToggle={toggleFollow} />
      </div>
      {tab === "chart" ? (
        <>
          <ChordSheet
            bars={bars}
            currentBar={currentBar}
            currentChord={position.chord}
            follow={follow}
            loop={loop}
            onSeek={onSeek}
            onLoop={onLoop}
          />
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
            <span>
              Detected automatically. <span className="text-zinc-400 italic">grey italic</span> chords are uncertain. Click a bar
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
      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition ${
        follow ? "bg-white/10 text-zinc-100" : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
      }`}
    >
      <MoveDown className="size-3.5" />
      Follow
      <span className={`h-3.5 w-6 rounded-full p-0.5 transition ${follow ? "bg-guitar" : "bg-white/15"}`} aria-hidden>
        <span className={`block size-2.5 rounded-full bg-white transition ${follow ? "translate-x-2.5" : ""}`} />
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
      className="grid size-6 place-items-center rounded-[9px] text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100 disabled:opacity-30"
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
  return (
    <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3">
      <div className="min-w-0">
        <div className="text-[11px] font-medium tracking-wider text-zinc-500 uppercase">Now</div>
        <div
          className={`truncate text-5xl font-semibold tracking-tight sm:text-6xl ${
            current?.uncertain ? "text-zinc-400 italic" : "text-zinc-50"
          }`}
          aria-live="off"
          title={current?.uncertain ? "Uncertain, check by ear" : undefined}
        >
          {current?.label ?? "·"}
        </div>
      </div>
      <div className="min-w-0 pb-1">
        <div className="text-[11px] font-medium tracking-wider text-zinc-500 uppercase">
          Next{beatsToNext !== null && beatsToNext > 0 ? ` · in ${beatsToNext} ${beatsToNext === 1 ? "beat" : "beats"}` : ""}
        </div>
        <div className={`truncate text-2xl font-semibold sm:text-3xl ${next?.uncertain ? "text-zinc-500 italic" : "text-zinc-300"}`}>
          {next?.label ?? "·"}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-3 pb-2">
        <div className="flex gap-1.5" aria-label={beat >= 0 ? `Beat ${beat + 1} of ${beatsPerBar}` : undefined}>
          {Array.from({ length: beatsPerBar }, (_, i) => (
            <span
              key={i}
              className={`size-2.5 rounded-full transition-colors duration-75 ${
                i === beat ? (i === 0 ? "bg-guitar" : "bg-zinc-100") : "bg-white/10"
              }`}
            />
          ))}
        </div>
        {bar !== null && <span className="w-14 font-mono text-xs text-zinc-500 tabular-nums">bar {bar}</span>}
      </div>
    </div>
  );
}

const ChordSheet = memo(function ChordSheet({
  bars,
  currentBar,
  currentChord,
  follow,
  loop,
  onSeek,
  onLoop,
}: {
  bars: Bar[];
  currentBar: number;
  currentChord: number;
  follow: boolean;
  loop: LoopRegion | null;
  onSeek: (seconds: number) => void;
  onLoop: (region: LoopRegion) => void;
}) {
  const anchor = useRef<number | null>(null);
  const { ref, onUserScroll } = useFollowScroll<HTMLDivElement>(follow, currentBar >= 0 ? `[data-bar="${currentBar}"]` : null);

  return (
    <div
      ref={ref}
      onWheel={onUserScroll}
      onTouchMove={onUserScroll}
      className="relative mt-2 max-h-[19rem] overflow-y-auto rounded-2xl border border-white/5 bg-black/20 p-1.5"
    >
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {bars.map((bar, i) => {
          const active = i === currentBar;
          // Bars mostly inside the loop.
          const looped = loop !== null && Math.min(bar.end, loop.end) - Math.max(bar.start, loop.start) > 0.5 * (bar.end - bar.start);
          return (
            <button
              key={bar.startBeat}
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
                  ? "border-guitar/50 bg-white/[0.07]"
                  : looped
                    ? "border-white/25 bg-white/[0.05] hover:bg-white/[0.07]"
                    : "border-white/5 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]"
              }`}
            >
              <span className="absolute top-1 left-1.5 font-mono text-[9px] text-zinc-600">{bar.number || "pick-up"}</span>
              {bar.cells.length === 0 && <span className="flex-1" />}
              {bar.cells.map((cell) => {
                const playing = active && cell.chordIndex === currentChord;
                return (
                  <span
                    key={cell.offset}
                    style={{ flexGrow: cell.beats, flexBasis: 0 }}
                    className={`flex min-w-0 items-end px-1.5 pb-1.5 ${cell.offset > 0 ? "border-l border-white/5" : ""}`}
                  >
                    <span
                      className={`truncate text-base font-semibold sm:text-lg ${
                        playing
                          ? "text-guitar"
                          : cell.uncertain
                            ? "text-zinc-500 italic"
                            : cell.continued
                              ? "text-zinc-600"
                              : "text-zinc-200"
                      }`}
                      title={cell.uncertain ? "Uncertain, check by ear" : undefined}
                    >
                      {cell.label}
                    </span>
                  </span>
                );
              })}
            </button>
          );
        })}
      </div>
    </div>
  );
});
