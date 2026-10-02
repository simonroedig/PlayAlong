"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import type { LoopRegion, PlayerEngine } from "@/lib/audio/engine";
import { DISPLAY_ORDER, STEM_INFO, stemIndex } from "@/lib/mixer";
import { formatTime } from "@/lib/songs";

const BAR = 2;
const GAP = 1;
const MIN_LOOP = 0.5;

interface Props {
  engine: PlayerEngine | null;
  envelopes: Float32Array[];
  gains: number[];
  duration: number;
  loop: LoopRegion | null;
  loopEnabled: boolean;
  onSeek: (seconds: number) => void;
  onLoopChange: (loop: LoopRegion) => void;
}

/**
 * Song overview: per-stem loudness stacked outward from the centre line, so
 * you can see where the guitar or bass plays. Muted stems turn grey.
 * Click to seek, drag to select a loop.
 */
export function Waveform({ engine, envelopes, gains, duration, loop, loopEnabled, onSeek, onLoopChange }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const drag = useRef<{ x: number; t: number; moved: boolean } | null>(null);
  const draft = useRef<LoopRegion | null>(null);
  const hover = useRef<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Static layer: the stacked envelopes.
  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const buckets = envelopes[0]?.length ?? 0;
    const cols = Math.floor(size.w / (BAR + GAP));
    if (!buckets || !cols) return;
    const order = DISPLAY_ORDER.map((name) => ({ index: stemIndex(name), color: STEM_INFO[name].color }));
    const values = new Float32Array(cols * order.length);
    const totals = new Float32Array(cols);
    for (let c = 0; c < cols; c++) {
      const b0 = Math.floor((c * buckets) / cols);
      const b1 = Math.max(b0 + 1, Math.floor(((c + 1) * buckets) / cols));
      order.forEach(({ index }, k) => {
        let peak = 0;
        for (let b = b0; b < b1; b++) peak = Math.max(peak, envelopes[index][b]);
        values[c * order.length + k] = peak;
        totals[c] += peak;
      });
    }
    const sorted = Array.from(totals).sort((a, b) => a - b);
    const ref = sorted[Math.floor(sorted.length * 0.98)] || 1;
    const mid = size.h / 2;
    const maxHalf = mid - 3;
    for (let c = 0; c < cols; c++) {
      const total = totals[c];
      if (total <= 0) continue;
      const half = Math.min(1, Math.pow(total / ref, 0.7)) * maxHalf;
      let offset = 0;
      const x = c * (BAR + GAP);
      order.forEach(({ index, color }, k) => {
        const h = (half * values[c * order.length + k]) / total;
        if (h <= 0.05) return;
        ctx.fillStyle = gains[index] > 0 ? color : "rgba(255,255,255,0.13)";
        ctx.globalAlpha = gains[index] > 0 ? 0.92 : 1;
        ctx.fillRect(x, mid - offset - h, BAR, h);
        ctx.fillRect(x, mid + offset, BAR, h);
        offset += h;
      });
    }
    ctx.globalAlpha = 1;
  }, [envelopes, gains, size]);

  // Dynamic layer: playhead, loop region, hover.
  useAnimationFrame(() => {
    const canvas = overlayRef.current;
    if (!canvas || size.w === 0 || duration <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== size.w * dpr || canvas.height !== size.h * dpr) {
      canvas.width = size.w * dpr;
      canvas.height = size.h * dpr;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const x = (t: number) => (t / duration) * size.w;

    const region = draft.current ?? loop;
    if (region) {
      const x0 = x(region.start);
      const x1 = x(region.end);
      const active = draft.current !== null || loopEnabled;
      if (active) {
        ctx.fillStyle = "rgba(7,7,10,0.55)";
        ctx.fillRect(0, 0, x0, size.h);
        ctx.fillRect(x1, 0, size.w - x1, size.h);
      }
      ctx.fillStyle = active ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)";
      ctx.fillRect(x0, 0, x1 - x0, size.h);
      ctx.fillStyle = active ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.25)";
      ctx.fillRect(x0, 0, 1.5, size.h);
      ctx.fillRect(x1 - 1.5, 0, 1.5, size.h);
    }

    if (hover.current !== null && !drag.current) {
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(Math.round(x(hover.current)), 0, 1, size.h);
    }

    const px = Math.round(x(engine?.currentTime() ?? 0));
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(px - 1, 0, 2, size.h);
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 6);
    ctx.closePath();
    ctx.fill();
  });

  const timeAt = (clientX: number) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, t: timeAt(e.clientX), moved: false };
  };
  const onPointerMove = (e: PointerEvent) => {
    const t = timeAt(e.clientX);
    hover.current = t;
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.x) > 4) d.moved = true;
    if (d.moved) draft.current = { start: Math.min(d.t, t), end: Math.max(d.t, t) };
  };
  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    const region = draft.current;
    draft.current = null;
    if (!d) return;
    if (d.moved && region && region.end - region.start >= MIN_LOOP) onLoopChange(region);
    else if (!d.moved) onSeek(timeAt(e.clientX));
  };

  const step = rulerStep(duration, size.w);
  const ticks: number[] = [];
  for (let t = 0; t <= duration - step * 0.25; t += step) ticks.push(t);

  return (
    <div>
      <div
        ref={wrapRef}
        role="slider"
        aria-label="Song position — click to seek, drag to set a loop"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={0}
        tabIndex={-1}
        className="relative h-36 w-full cursor-crosshair touch-none select-none sm:h-44"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          draft.current = null;
        }}
        onPointerLeave={() => {
          hover.current = null;
        }}
      >
        <canvas ref={baseRef} className="absolute inset-0 size-full" />
        <canvas ref={overlayRef} className="absolute inset-0 size-full" />
      </div>
      <div className="relative mt-1 h-4 font-mono text-[10px] text-zinc-500">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2 first:translate-x-0" style={{ left: `${(t / duration) * 100}%` }}>
            {formatTime(t)}
          </span>
        ))}
      </div>
    </div>
  );
}

function rulerStep(duration: number, width: number): number {
  const steps = [5, 10, 15, 20, 30, 60, 120, 300];
  for (const s of steps) if ((s / duration) * width >= 70) return s;
  return 600;
}
