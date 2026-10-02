"use client";

import { PRESETS, STEM_INFO, type PresetId } from "@/lib/mixer";

const ACCENT: Record<PresetId, string> = {
  "no-guitar": STEM_INFO.guitar.color,
  "no-bass": STEM_INFO.bass.color,
  full: "#e4e4e7",
  "guitar-only": STEM_INFO.guitar.color,
  "bass-only": STEM_INFO.bass.color,
};

/** The practice modes: one click to remove (or isolate) guitar or bass. */
export function PresetBar({ active, onSelect }: { active: PresetId | null; onSelect: (id: PresetId) => void }) {
  return (
    <div role="radiogroup" aria-label="Practice mode" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {PRESETS.map((preset, i) => {
        const selected = active === preset.id;
        const accent = ACCENT[preset.id];
        return (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(preset.id)}
            title={`${preset.hint} (${i + 1})`}
            className={`group rounded-2xl border px-3.5 py-3 text-left transition ${
              selected ? "bg-white/[0.06]" : "border-white/5 bg-ink-900/60 hover:border-white/15 hover:bg-ink-850"
            } ${i === 0 ? "col-span-2 sm:col-span-1" : ""}`}
            style={selected ? { borderColor: `${accent}80`, boxShadow: `0 0 0 1px ${accent}40, 0 8px 30px -12px ${accent}80` } : undefined}
          >
            <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: selected ? accent : "#e4e4e7" }}>
              <span
                className="size-2 rounded-full"
                style={{ background: selected ? accent : "rgba(255,255,255,0.15)" }}
                aria-hidden
              />
              {preset.label}
            </span>
            <span className="mt-0.5 block text-xs text-zinc-500">{preset.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
