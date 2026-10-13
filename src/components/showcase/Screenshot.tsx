/* eslint-disable @next/next/no-img-element -- static screenshots, already sized and compressed */
import type { ReactNode } from "react";

/**
 * A screenshot of the app in a browser window frame, so it reads as a picture
 * of PlayAlong running on someone's computer and not as part of this page.
 */
export function Screenshot({
  src,
  alt,
  width,
  height,
  className = "",
  priority = false,
  children,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  priority?: boolean;
  /** Overlays drawn on top of the picture (e.g. an animated hint). */
  children?: ReactNode;
}) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-white/10 bg-ink-900 shadow-2xl shadow-black/60 ring-1 ring-black/40 select-none ${className}`}>
      <div className="flex h-8 items-center gap-3 border-b border-white/[0.06] bg-white/[0.035] px-3.5" aria-hidden>
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
        </span>
        <span className="mx-auto truncate rounded-md bg-black/40 px-3 py-0.5 font-mono text-[10px] text-zinc-500 sm:px-6">localhost:3000</span>
        <span className="hidden text-[10px] font-medium tracking-[0.14em] text-zinc-600 uppercase sm:inline">Screenshot</span>
      </div>
      <div className="pointer-events-none relative">
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          className="block h-auto w-full"
        />
        {children}
      </div>
    </div>
  );
}
