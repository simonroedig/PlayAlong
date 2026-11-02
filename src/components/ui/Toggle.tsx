"use client";

import type { ReactNode } from "react";

/**
 * An on/off switch with a label, as "Follow the music": a soft frame, the
 * label, and the switch on the right. `size="sm"` fits a row of small controls.
 */
export function Toggle({
  on,
  onToggle,
  children,
  icon,
  title,
  disabled,
  size = "md",
}: {
  on: boolean;
  onToggle: () => void;
  children: ReactNode;
  icon?: ReactNode;
  title?: string;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const md = size === "md";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center font-semibold transition disabled:cursor-default ${
        md ? "h-11 gap-2.5 rounded-2xl px-4 text-sm" : "h-9 gap-2 rounded-xl px-3 text-xs"
      } border ${on ? "border-white/15 bg-white/[0.07] text-zinc-50" : "border-white/10 text-zinc-400 hover:bg-white/5 hover:text-zinc-200"}`}
    >
      {icon}
      {children}
      <span className={`rounded-full p-0.5 transition ${md ? "h-5 w-9" : "h-4 w-7"} ${on ? "bg-guitar" : "bg-white/15"}`} aria-hidden>
        <span className={`block rounded-full bg-white shadow transition ${md ? "size-4" : "size-3"} ${on ? (md ? "translate-x-4" : "translate-x-3") : ""}`} />
      </span>
    </button>
  );
}
