"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** A header chip that opens an explanation panel below it. */
export function HeaderPopover({
  trigger,
  align,
  label,
  children,
  ring = false,
}: {
  trigger: ReactNode;
  align: "left" | "right";
  label: string;
  children: ReactNode;
  /** Animated stem-colour ring (while the device is working). */
  ring?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <span className={`relative inline-flex overflow-hidden rounded-full p-[1.5px] ${ring ? "" : "bg-white/10"}`}>
        {ring && (
          <span
            aria-hidden
            className="absolute inset-[-150%] animate-[spin_2.4s_linear_infinite] bg-[conic-gradient(#f472b6,#fb923c,#facc15,#4ade80,#22d3ee,#a78bfa,#f472b6)]"
          />
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={label}
          className="relative inline-flex h-10 items-center gap-2 rounded-full bg-ink-900 px-3.5 text-sm font-medium text-zinc-200 transition hover:bg-ink-800 sm:px-4"
        >
          {trigger}
          <ChevronDown className={`size-3.5 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </span>
      {open && (
        <div
          className={`absolute z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-ink-850/95 p-5 text-sm shadow-2xl shadow-black/60 backdrop-blur-xl ${
            align === "left" ? "left-0" : "right-0"
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
