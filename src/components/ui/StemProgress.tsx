"use client";

import type { CSSProperties } from "react";

export interface Lane {
  color: string;
  label?: string;
}

/**
 * Progress as rows of blocks in the stem colours, filling left to right with a
 * glowing head (each row slightly behind the one above, like parts coming in).
 * Without a fraction, a soft light sweeps along each row.
 */
export function StemProgress({
  lanes,
  fraction,
  blocks = 32,
  size = "md",
}: {
  lanes: Lane[];
  fraction: number | null;
  blocks?: number;
  size?: "sm" | "md";
}) {
  const height = size === "sm" ? "h-2" : "h-3.5";
  const gap = size === "sm" ? "gap-[2px]" : "gap-[3px]";
  return (
    <div className={size === "sm" ? "space-y-1" : "space-y-2"} role="presentation">
      {lanes.map((lane, i) => {
        const filled = fraction === null ? 0 : Math.max(0, Math.min(blocks, fraction * blocks * 1.04 - i * 0.35));
        return (
          <div key={lane.label ?? i} className="flex items-center gap-3">
            {lane.label && (
              <span className="w-12 shrink-0 text-[11px] font-semibold" style={{ color: lane.color }}>
                {lane.label}
              </span>
            )}
            {fraction === null ? (
              <div className={`relative flex-1 overflow-hidden rounded-full bg-white/[0.05] ${height}`}>
                <span
                  className="absolute inset-y-0 left-0 w-1/4 rounded-full motion-safe:animate-[sweep_1.8s_ease-in-out_infinite]"
                  style={{
                    background: `linear-gradient(90deg, transparent, ${lane.color}, transparent)`,
                    animationDelay: `${i * 0.15}s`,
                  }}
                />
              </div>
            ) : (
              <div className={`flex flex-1 ${gap}`}>
                {Array.from({ length: blocks }, (_, b) => {
                  const done = b < Math.floor(filled);
                  const head = b === Math.floor(filled) && filled < blocks;
                  return (
                    <span
                      key={b}
                      className={`flex-1 rounded-[3px] transition-[background-color,box-shadow] duration-500 ${height} ${
                        head ? "motion-safe:animate-[block-pulse_0.9s_ease-in-out_infinite]" : ""
                      }`}
                      style={
                        {
                          background: done || head ? lane.color : "rgba(255,255,255,0.06)",
                          opacity: done ? 0.92 : head ? 1 : 1,
                          boxShadow: head ? `0 0 12px ${lane.color}` : undefined,
                        } as CSSProperties
                      }
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
