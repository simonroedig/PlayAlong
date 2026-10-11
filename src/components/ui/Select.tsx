"use client";

import { ChevronDown } from "lucide-react";

/** A styled native select: same height and corners as the buttons around it, with a chevron. */
export function Select<T extends string | number>({
  value,
  onChange,
  options,
  label,
  className = "",
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <span className={`relative inline-flex ${className}`}>
      <select
        aria-label={label}
        title={label}
        value={String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          onChange((typeof value === "number" ? Number(raw) : raw) as T);
        }}
        className="h-9 w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-white/[0.04] pr-8 pl-3 text-xs font-medium text-zinc-200 transition outline-none hover:border-white/20 hover:bg-white/[0.08] focus-visible:border-white/40"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)} className="bg-ink-900 text-zinc-200">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-zinc-400" />
    </span>
  );
}
