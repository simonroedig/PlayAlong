"use client";

import { LocateFixed, Minus, MoveHorizontal, Plus } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { useChordPlayhead } from "@/hooks/useChordPlayhead";
import type { PlayerEngine } from "@/lib/audio/engine";
import type { ChordAnalysis } from "@/lib/chords/analyze";
import type { DisplayChord } from "@/lib/chords/sheet";

/** Hue per root along the circle of fifths, so related chords look related. */
function hue(root: number) {
  return ((root * 7) % 12) * 30;
}

/** Seconds visible in the zoomed strip. */
const SPANS = [6, 10, 16, 24, 40, 64];
/** Where the playhead sits in the strip while following (fraction from the left). */
const LEAD = 0.25;

/**
 * The chords on a zoomed, moving timeline under the waveform: the playhead
 * stays near the left and the coming chords roll in. Drag (or scroll
 * sideways) to look ahead, Ctrl + scroll or the buttons to zoom, click a chord
 * to jump there. Below, the whole song with the visible part marked.
 */
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
  const { chord: current } = useChordPlayhead(engine, analysis, chords);
  const [spanIndex, setSpanIndex] = useState(2);
  const span = Math.min(SPANS[spanIndex], Math.max(4, duration));
  const [follow, setFollow] = useState(true);
  const [stripWidth, setStripWidth] = useState(0);

  const strip = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const overview = useRef<HTMLDivElement>(null);
  const view = useRef(0);
  const live = useRef({ follow, span });
  useEffect(() => {
    live.current = { follow, span };
  });

  const clampView = useCallback((start: number, s: number) => Math.max(-LEAD * s, Math.min(duration - s * (1 - LEAD), start)), [duration]);

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setStripWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Position everything once per frame (no re-render).
  useAnimationFrame(() => {
    if (!track.current || duration <= 0) return;
    const t = engine?.currentTime() ?? 0;
    const { follow: following, span: s } = live.current;
    const start = following ? t - LEAD * s : view.current;
    if (following) view.current = start;
    track.current.style.width = `${(duration / s) * 100}%`;
    track.current.style.transform = `translateX(${(-start / duration) * 100}%)`;
    if (playhead.current) {
      const x = (t - start) / s;
      playhead.current.style.left = `${x * 100}%`;
      playhead.current.style.opacity = x < 0 || x > 1 ? "0" : "1";
    }
    if (viewport.current) {
      viewport.current.style.left = `${(Math.max(0, start) / duration) * 100}%`;
      viewport.current.style.width = `${(Math.min(s, duration) / duration) * 100}%`;
    }
  });

  // Dragging the strip looks around; a click without moving jumps to that chord.
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, start: view.current, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !stripWidth) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 5) return;
    d.moved = true;
    setFollow(false);
    view.current = clampView(d.start - (dx / stripWidth) * span, span);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || !strip.current) return;
    const rect = strip.current.getBoundingClientRect();
    const time = view.current + ((e.clientX - rect.left) / rect.width) * span;
    const hit = chords.find((c) => c.start <= time && time < c.end);
    onSeek(Math.max(0, hit ? hit.start : time));
  };

  // Sideways scrolling pans, Ctrl / ⌘ + scroll zooms; vertical scrolling stays with the page.
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { span: s } = live.current;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setSpanIndex((i) => Math.max(0, Math.min(SPANS.length - 1, i + (e.deltaY > 0 ? 1 : -1))));
        return;
      }
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (!dx) return;
      e.preventDefault();
      setFollow(false);
      view.current = clampView(view.current + (dx / el.clientWidth) * s, s);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [clampView]);

  // Clicking the overview moves the view there.
  const onOverview = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const time = ((e.clientX - rect.left) / rect.width) * duration;
    setFollow(false);
    view.current = clampView(time - span / 2, span);
  };

  if (duration <= 0) return null;
  const pxPerSecond = stripWidth / span;

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <MoveHorizontal className="size-3.5" /> Drag to look ahead · click a chord to jump
        </span>
        <span className="flex items-center gap-1">
          {!follow && (
            <button
              type="button"
              onClick={() => setFollow(true)}
              className="mr-1 inline-flex h-6 items-center gap-1 rounded-full bg-zinc-50 px-2.5 font-semibold text-ink-950 hover:bg-white"
            >
              <LocateFixed className="size-3" /> Back to now
            </button>
          )}
          <button
            type="button"
            aria-label="Show more of the song"
            title="Zoom out (Ctrl + scroll)"
            onClick={() => setSpanIndex((i) => Math.min(SPANS.length - 1, i + 1))}
            disabled={spanIndex === SPANS.length - 1}
            className="grid size-6 place-items-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-zinc-100 disabled:opacity-30"
          >
            <Minus className="size-3" />
          </button>
          <span className="w-9 text-center font-mono tabular-nums">{span} s</span>
          <button
            type="button"
            aria-label="Show less of the song"
            title="Zoom in (Ctrl + scroll)"
            onClick={() => setSpanIndex((i) => Math.max(0, i - 1))}
            disabled={spanIndex === 0}
            className="grid size-6 place-items-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-zinc-100 disabled:opacity-30"
          >
            <Plus className="size-3" />
          </button>
        </span>
      </div>

      <div
        ref={strip}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        className="relative h-12 w-full cursor-grab touch-pan-y overflow-hidden rounded-xl border border-white/5 bg-black/30 select-none active:cursor-grabbing"
        aria-label="Chord timeline"
      >
        <div ref={track} className="absolute inset-y-0 left-0 will-change-transform">
          <Chords chords={chords} current={current} duration={duration} pxPerSecond={pxPerSecond} />
        </div>
        <div ref={playhead} className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-zinc-50 shadow-[0_0_10px_rgba(255,255,255,0.7)]" />
      </div>

      <div
        ref={overview}
        onPointerDown={onOverview}
        className="relative mt-1.5 h-2.5 w-full cursor-pointer overflow-hidden rounded-full bg-white/[0.04]"
        title="The whole song: click to look there"
      >
        {chords.map((c) =>
          c.root === null ? null : (
            <span
              key={`${c.startBeat}-${c.label}`}
              className="absolute inset-y-0"
              style={{
                left: `${(c.start / duration) * 100}%`,
                width: `${((Math.min(c.end, duration) - c.start) / duration) * 100}%`,
                background: `hsl(${hue(c.root)} 70% 62% / 0.45)`,
              }}
            />
          ),
        )}
        <div ref={viewport} className="pointer-events-none absolute inset-y-0 rounded-full border border-white/80 bg-white/15" />
      </div>
    </div>
  );
}

const Chords = memo(function Chords({
  chords,
  current,
  duration,
  pxPerSecond,
}: {
  chords: DisplayChord[];
  current: number;
  duration: number;
  pxPerSecond: number;
}) {
  return (
    <>
      {chords.map((c, i) => {
        if (c.root === null) return null;
        const length = Math.min(c.end, duration) - c.start;
        const h = hue(c.root);
        const active = i === current;
        const past = i < current;
        // Only full names: a chord too short to show its name shows a colour block.
        const fits = length * pxPerSecond >= c.label.length * 9 + 10;
        return (
          <span
            key={`${c.startBeat}-${c.label}`}
            title={`${c.label}${c.uncertain ? " (uncertain)" : ""}`}
            className={`absolute inset-y-1 flex items-center overflow-hidden rounded-lg border px-2 text-sm font-semibold whitespace-nowrap transition-colors ${
              c.uncertain ? "italic" : ""
            }`}
            style={{
              left: `${(c.start / duration) * 100}%`,
              width: `calc(${(length / duration) * 100}% - 3px)`,
              borderColor: `hsl(${h} 70% 62% / ${active ? 0.95 : 0.35})`,
              background: `hsl(${h} 70% 62% / ${active ? 0.35 : past ? 0.07 : 0.14})`,
              color: active ? "#fafafa" : past ? `hsl(${h} 30% 60%)` : `hsl(${h} 75% 84%)`,
              boxShadow: active ? `0 0 18px hsl(${h} 70% 62% / 0.45)` : undefined,
            }}
          >
            {fits ? c.label : ""}
          </span>
        );
      })}
    </>
  );
});
