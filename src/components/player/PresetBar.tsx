"use client";

import { STEM_ICONS } from "@/components/player/Mixer";
import { PRESETS, STEM_INFO, type PresetId } from "@/lib/mixer";

interface Props {
  active: PresetId | null;
  vocals: boolean;
  onSelect: (id: PresetId) => void;
  onVocals: (on: boolean) => void;
}

const key = (id: PresetId) => PRESETS.findIndex((p) => p.id === id) + 1;

/**
 * Quick practice modes: the full mix, then guitar and bass (play it yourself /
 * hear it alone), and a vocals switch that works on top of any of them.
 */
export function PresetBar({ active, vocals, onSelect, onVocals }: Props) {
  // Clicking the active mode again goes back to the full mix.
  const choose = (id: PresetId) => onSelect(active === id && id !== "full" ? "full" : id);
  const full = active === "full";

  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-[1fr_1.7fr_1.7fr_1fr]">
      <div role="radiogroup" aria-label="Practice mode" className="contents">
        <button
          type="button"
          role="radio"
          aria-checked={full}
          onClick={() => choose("full")}
          title={`Everything, as recorded (${key("full")})`}
          className={`rounded-2xl border px-4 py-3 text-left transition ${
            full ? "border-white/40 bg-white/[0.08] shadow-[0_8px_30px_-12px_rgba(255,255,255,0.35)]" : "border-white/5 bg-ink-900/60 hover:border-white/15 hover:bg-ink-850"
          }`}
        >
          <span className={`block text-sm font-semibold ${full ? "text-zinc-50" : "text-zinc-200"}`}>Full mix</span>
          <span className="mt-0.5 block text-xs text-zinc-500">Everything, as recorded</span>
        </button>

        {(["guitar", "bass"] as const).map((name) => {
          const info = STEM_INFO[name];
          const Icon = STEM_ICONS[name];
          const options: { id: PresetId; label: string; hint: string }[] =
            name === "guitar"
              ? [
                  { id: "no-guitar", label: "Without", hint: "you play it" },
                  { id: "guitar-only", label: "Only", hint: "learn the part" },
                ]
              : [
                  { id: "no-bass", label: "Without", hint: "you play it" },
                  { id: "bass-only", label: "Only", hint: "learn the line" },
                ];
          const engaged = options.some((o) => o.id === active);
          return (
            <div
              key={name}
              className={`col-span-2 rounded-2xl border p-1.5 transition sm:col-span-1 ${engaged ? "bg-white/[0.04]" : "border-white/5 bg-ink-900/60"}`}
              style={engaged ? { borderColor: `${info.color}55` } : undefined}
            >
              <div className="flex items-center gap-1.5">
                <span className="flex w-20 shrink-0 items-center gap-1.5 pl-2 text-sm font-semibold" style={{ color: info.color }}>
                  <Icon className="size-4" /> {info.label}
                </span>
                {options.map((option) => {
                  const selected = active === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={option.id.startsWith("no-") ? `No ${info.label.toLowerCase()}` : `${info.label} only`}
                      onClick={() => choose(option.id)}
                      title={`${option.id.startsWith("no-") ? `Mute the ${info.label.toLowerCase()} and play it yourself` : `Hear only the ${info.label.toLowerCase()}`} (${key(option.id)})`}
                      className={`flex-1 rounded-xl px-3 py-2 text-left transition ${selected ? "" : "hover:bg-white/5"}`}
                      style={selected ? { background: `${info.color}24`, boxShadow: `inset 0 0 0 1px ${info.color}80` } : undefined}
                    >
                      <span className="block text-sm font-semibold" style={{ color: selected ? info.color : "#e4e4e7" }}>
                        {option.label}
                      </span>
                      <span className="block text-[11px] text-zinc-500">{option.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={vocals}
        onClick={() => onVocals(!vocals)}
        title={`${vocals ? "Mute" : "Bring back"} the vocals, in any mode (V)`}
        className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${
          vocals ? "border-white/5 bg-ink-900/60 hover:border-white/15" : "border-white/15 bg-white/[0.04]"
        }`}
      >
        <span>
          <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: vocals ? STEM_INFO.vocals.color : "#a1a1aa" }}>
            <VocalsIcon /> Vocals
          </span>
          <span className="mt-0.5 block text-xs text-zinc-500">{vocals ? "On" : "Off"}</span>
        </span>
        <span className={`h-5 w-9 shrink-0 rounded-full p-0.5 transition ${vocals ? "" : "bg-white/15"}`} style={vocals ? { background: STEM_INFO.vocals.color } : undefined} aria-hidden>
          <span className={`block size-4 rounded-full bg-white shadow transition ${vocals ? "translate-x-4" : ""}`} />
        </span>
      </button>
    </div>
  );
}

function VocalsIcon() {
  const Icon = STEM_ICONS.vocals;
  return <Icon className="size-4" />;
}
