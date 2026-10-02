"use client";

import { AudioWaveform, Download, Drum, Guitar, MicVocal, Piano, Sparkles, type LucideIcon } from "lucide-react";
import { useRef } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import type { PlayerEngine } from "@/lib/audio/engine";
import { DISPLAY_ORDER, STEM_INFO, stemIndex, type MixerSettings } from "@/lib/mixer";
import type { SourceName } from "@/lib/separation/model";

const ICONS: Record<SourceName, LucideIcon> = {
  guitar: Guitar,
  bass: AudioWaveform,
  drums: Drum,
  vocals: MicVocal,
  piano: Piano,
  other: Sparkles,
};

interface Props {
  engine: PlayerEngine | null;
  mixer: MixerSettings;
  gains: number[];
  onChange: (mixer: MixerSettings) => void;
  onDownloadStem: (index: number) => void;
}

/** One channel strip per stem: mute, solo, volume and a pre-fader level meter. */
export function Mixer({ engine, mixer, gains, onChange, onDownloadStem }: Props) {
  const meters = useRef<(HTMLDivElement | null)[]>([]);
  const levels = useRef<number[]>([]);

  useAnimationFrame(() => {
    const peaks = engine?.peaks ?? [];
    meters.current.forEach((el, i) => {
      if (!el) return;
      const target = peaks[i] ?? 0;
      // Fast attack, slow release.
      const prev = levels.current[i] ?? 0;
      const level = target > prev ? target : prev * 0.9;
      levels.current[i] = level;
      const db = level > 0 ? 20 * Math.log10(level) : -90;
      const fill = Math.max(0, Math.min(1, (db + 48) / 48));
      el.style.transform = `scaleX(${fill})`;
    });
  }, engine !== null);

  const set = (patch: (m: MixerSettings) => void) => {
    const next: MixerSettings = {
      ...mixer,
      volumes: [...mixer.volumes],
      muted: [...mixer.muted],
      solo: [...mixer.solo],
    };
    patch(next);
    onChange(next);
  };

  const anySolo = mixer.solo.some(Boolean);

  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {DISPLAY_ORDER.map((name) => {
        const i = stemIndex(name);
        const info = STEM_INFO[name];
        const Icon = ICONS[name];
        const audible = gains[i] > 0;
        const volume = mixer.volumes[i];
        const muted = mixer.muted[i];
        const solo = mixer.solo[i];
        return (
          <div
            key={name}
            className={`relative overflow-hidden rounded-2xl border bg-ink-900/80 p-3.5 transition ${
              audible ? "border-white/10" : "border-white/5 opacity-75"
            }`}
            style={{ boxShadow: audible ? `inset 3px 0 0 ${info.color}` : "inset 3px 0 0 rgba(255,255,255,0.08)" }}
          >
            <div className="flex items-center gap-2.5">
              <span
                className="grid size-8 place-items-center rounded-lg"
                style={{ background: `${info.color}1f`, color: audible ? info.color : "#71717a" }}
              >
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${audible ? "text-zinc-100" : "text-zinc-500 line-through decoration-zinc-600"}`}>
                  {info.label}
                </p>
                <p className="text-[11px] text-zinc-500">
                  {!audible ? (anySolo && !solo ? "not soloed" : "removed") : `${Math.round(volume * 100)}%`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => set((m) => (m.muted[i] = !m.muted[i]))}
                aria-pressed={muted}
                title={`Mute ${info.label}${name === "guitar" ? " (G)" : name === "bass" ? " (B)" : ""}`}
                className={`h-8 w-9 rounded-lg text-xs font-bold transition ${
                  muted ? "bg-red-500/90 text-white" : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
                }`}
              >
                M
              </button>
              <button
                type="button"
                onClick={() => set((m) => (m.solo[i] = !m.solo[i]))}
                aria-pressed={solo}
                title={`Solo ${info.label}`}
                className={`h-8 w-9 rounded-lg text-xs font-bold transition ${
                  solo ? "bg-amber-400 text-ink-950" : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
                }`}
              >
                S
              </button>
              <button
                type="button"
                onClick={() => onDownloadStem(i)}
                title={`Download the ${info.label.toLowerCase()} stem (.wav)`}
                aria-label={`Download ${info.label} stem`}
                className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 transition hover:bg-white/10 hover:text-zinc-100"
              >
                <Download className="size-3.5" />
              </button>
            </div>

            <div className="mt-3 flex items-center gap-3">
              <input
                type="range"
                className="slider flex-1"
                min={0}
                max={1.5}
                step={0.01}
                value={volume}
                onChange={(e) => set((m) => (m.volumes[i] = Number(e.target.value)))}
                onDoubleClick={() => set((m) => (m.volumes[i] = 1))}
                aria-label={`${info.label} volume`}
                style={{ "--fill": `${(volume / 1.5) * 100}%`, "--accent": info.color } as React.CSSProperties}
              />
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/5">
              <div
                ref={(el) => {
                  meters.current[i] = el;
                }}
                className="h-full origin-left rounded-full"
                style={{ background: audible ? info.color : "#52525b", transform: "scaleX(0)" }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
