"use client";

import { Pause, Play, Repeat, RotateCcw, SkipBack, SkipForward, Turtle, Volume2, VolumeX, X } from "lucide-react";
import { useRef } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import type { LoopRegion, PlayerEngine } from "@/lib/audio/engine";
import { formatTime } from "@/lib/songs";

interface Props {
  engine: PlayerEngine | null;
  playing: boolean;
  duration: number;
  loop: LoopRegion | null;
  loopEnabled: boolean;
  onToggleLoop: () => void;
  onClearLoop: () => void;
  rate: number;
  onRate: (rate: number) => void;
  master: number;
  onMaster: (value: number) => void;
}

const RATE_MIN = 0.5;
const RATE_MAX = 1.25;

export function Transport(props: Props) {
  const { engine, playing, duration, loop, loopEnabled, rate, master } = props;
  const timeRef = useRef<HTMLSpanElement>(null);

  useAnimationFrame(() => {
    if (timeRef.current && engine) timeRef.current.textContent = formatTime(engine.currentTime(), true);
  }, engine !== null);

  const restart = () => engine?.seek(loop && loopEnabled ? loop.start : 0);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-2">
        <IconButton label="Back to start (Home)" onClick={restart} disabled={!engine}>
          <RotateCcw className="size-4" />
        </IconButton>
        <IconButton label="Back 5 seconds (←)" onClick={() => engine?.skip(-5)} disabled={!engine}>
          <SkipBack className="size-4" />
        </IconButton>
        <button
          type="button"
          onClick={() => engine?.toggle()}
          disabled={!engine}
          aria-label={playing ? "Pause (Space)" : "Play (Space)"}
          title={playing ? "Pause (Space)" : "Play (Space)"}
          className="grid size-14 place-items-center rounded-full bg-zinc-50 text-ink-950 shadow-lg shadow-white/10 transition hover:scale-105 active:scale-95 disabled:opacity-40"
        >
          {playing ? <Pause className="size-6" fill="currentColor" /> : <Play className="ml-0.5 size-6" fill="currentColor" />}
        </button>
        <IconButton label="Forward 5 seconds (→)" onClick={() => engine?.skip(5)} disabled={!engine}>
          <SkipForward className="size-4" />
        </IconButton>
        <div className="ml-2 font-mono text-sm tabular-nums">
          <span ref={timeRef} className="text-zinc-100">
            0:00.0
          </span>
          <span className="text-zinc-500"> / {formatTime(duration)}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={props.onToggleLoop}
            disabled={!engine}
            title={loop ? "Toggle loop (L)" : "Loop the next 8 seconds (L), or drag across the waveform"}
            className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium transition ${
              loop && loopEnabled
                ? "bg-zinc-100 text-ink-950"
                : "bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-zinc-100"
            }`}
          >
            <Repeat className="size-4" />
            {loop ? (
              <span className="font-mono text-xs tabular-nums">
                {formatTime(loop.start, true)} → {formatTime(loop.end, true)}
              </span>
            ) : (
              "Loop"
            )}
          </button>
          {loop && (
            <IconButton label="Clear loop" onClick={props.onClearLoop} small>
              <X className="size-3.5" />
            </IconButton>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-zinc-400" title="Practice tempo (the pitch stays the same)">
          <Turtle className="size-4" />
          <input
            type="range"
            className="slider w-28"
            min={RATE_MIN}
            max={RATE_MAX}
            step={0.05}
            value={rate}
            onChange={(e) => props.onRate(Number(e.target.value))}
            onDoubleClick={() => props.onRate(1)}
            style={{ "--fill": `${((rate - RATE_MIN) / (RATE_MAX - RATE_MIN)) * 100}%`, "--accent": "#fafafa" } as React.CSSProperties}
            aria-label="Playback speed"
          />
          <button
            type="button"
            onClick={() => props.onRate(1)}
            className={`w-12 rounded-md py-0.5 text-left font-mono text-xs tabular-nums ${rate === 1 ? "text-zinc-400" : "text-guitar"}`}
            title="Reset to 100 %"
          >
            {Math.round(rate * 100)}%
          </button>
        </label>

        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <button
            type="button"
            onClick={() => props.onMaster(master > 0 ? 0 : 1)}
            className="rounded-md p-0.5 hover:text-zinc-100"
            aria-label={master > 0 ? "Mute all" : "Unmute"}
          >
            {master > 0 ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          </button>
          <input
            type="range"
            className="slider w-24"
            min={0}
            max={1}
            step={0.01}
            value={master}
            onChange={(e) => props.onMaster(Number(e.target.value))}
            style={{ "--fill": `${master * 100}%`, "--accent": "#fafafa" } as React.CSSProperties}
            aria-label="Master volume"
          />
        </label>
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  small,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  small?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid place-items-center rounded-xl bg-white/5 text-zinc-300 transition hover:bg-white/10 hover:text-zinc-50 disabled:opacity-40 ${
        small ? "size-7" : "size-10"
      }`}
    >
      {children}
    </button>
  );
}
