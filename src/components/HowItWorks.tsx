"use client";

import { FolderOpen, Laptop, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { STEM_ICONS } from "@/components/player/Mixer";
import { DISPLAY_ORDER, STEM_INFO } from "@/lib/mixer";
import type { SourceName } from "@/lib/separation/model";

const BARS = 56;

/** Deterministic pseudo-waveforms (same on server and client): a quieter verse, a louder chorus. */
function bars(seed: number, level: number, steady = 0.5): number[] {
  let x = seed;
  let smooth = 0.5;
  return Array.from({ length: BARS }, (_, i) => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    smooth = 0.55 * smooth + 0.45 * (x / 0x7fffffff);
    const section = i >= BARS * 0.45 && i < BARS * 0.8 ? 1 : 0.7;
    return Math.min(1, level * section * (steady + (1 - steady) * smooth));
  });
}

const WAVES: Record<SourceName, number[]> = {
  guitar: bars(7, 0.95, 0.3),
  bass: bars(11, 0.8, 0.55),
  drums: bars(23, 1, 0.7),
  vocals: bars(5, 0.85, 0.2),
  piano: bars(17, 0.6, 0.4),
  other: bars(29, 0.5, 0.35),
};

// An original two-line verse, with the moment (seconds in the loop) each word and chord comes.
const SHEET: { chord?: string; word: string; at: number }[][] = [
  [
    { chord: "G", word: "Turn", at: 0.4 },
    { word: "it", at: 0.9 },
    { word: "up", at: 1.4 },
    { chord: "D", word: "and", at: 2.2 },
    { word: "let", at: 2.7 },
    { word: "the", at: 3.1 },
    { chord: "Em", word: "band", at: 3.8 },
    { word: "play", at: 4.4 },
    { chord: "C", word: "on", at: 5.2 },
  ],
  [
    { chord: "G", word: "every", at: 6.4 },
    { word: "chord", at: 7.0 },
    { word: "you", at: 7.5 },
    { chord: "D", word: "need,", at: 8.1 },
    { word: "every", at: 8.9 },
    { chord: "C", word: "word", at: 9.6 },
    { word: "in", at: 10.2 },
    { word: "time", at: 10.7 },
  ],
];

const STEPS = [
  { title: "Bring a song", text: "Paste a YouTube link or drop an audio file." },
  { title: "AI takes it apart", text: "Guitar, bass, drums, vocals, keys and the rest become six tracks, right on your computer." },
  { title: "Chords and lyrics appear", text: "The chords with a beat counter, and the lyrics word by word, in sync with the song." },
  { title: "Switch any part off", text: "Mute the guitar and play it yourself, or hear the bass alone to learn the line. Loop and slow down the hard bits." },
];

/** Landing page explainer with a small interactive mock of the player. */
export function HowItWorks() {
  const [on, setOn] = useState<Record<SourceName, boolean>>({
    guitar: false,
    bass: true,
    drums: true,
    vocals: true,
    piano: true,
    other: true,
  });

  return (
    <section aria-labelledby="how-heading" className="mt-20">
      <div className="max-w-2xl">
        <p className="text-xs font-medium tracking-[0.18em] text-zinc-500 uppercase">How it works</p>
        <h2 id="how-heading" className="mt-2 text-2xl font-semibold tracking-tight text-balance text-zinc-50 sm:text-3xl">
          One song in. Every part on its own switch.
        </h2>
      </div>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[0.85fr_1.15fr]">
        <ol className="space-y-5">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/15 font-mono text-xs text-zinc-300">
                {i + 1}
              </span>
              <div>
                <p className="font-medium text-zinc-100">{step.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-zinc-400">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>

        <figure className="rounded-3xl border border-white/10 bg-ink-900/80 p-4 shadow-2xl shadow-black/40 sm:p-5">
          <figcaption className="mb-3 flex items-center justify-between text-xs text-zinc-500">
            <span>Try it: switch the parts</span>
            <span className="font-mono">6 stems · chords · lyrics</span>
          </figcaption>

          <div className="relative space-y-1.5">
            {DISPLAY_ORDER.map((name) => {
              const info = STEM_INFO[name];
              const Icon = STEM_ICONS[name];
              const active = on[name];
              const yours = !active && (name === "guitar" || name === "bass");
              return (
                <div key={name} className="flex items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={active}
                    aria-label={info.label}
                    onClick={() => setOn((s) => ({ ...s, [name]: !s[name] }))}
                    className="flex w-28 shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs font-medium transition hover:bg-white/5 sm:w-32"
                  >
                    <span
                      className={`h-4 w-7 shrink-0 rounded-full p-0.5 transition ${active ? "" : "bg-white/15"}`}
                      style={active ? { background: info.color } : undefined}
                    >
                      <span className={`block size-3 rounded-full bg-white transition ${active ? "translate-x-3" : ""}`} />
                    </span>
                    <Icon className="size-3.5 shrink-0" style={{ color: active ? info.color : "#71717a" }} />
                    <span className={active ? "text-zinc-200" : "text-zinc-500"}>{info.label}</span>
                  </button>
                  <div className="relative flex h-8 flex-1 items-center gap-[2px] overflow-hidden">
                    {WAVES[name].map((h, i) => (
                      <span
                        key={i}
                        className="flex-1 rounded-full transition-[opacity,background-color] duration-300"
                        style={{
                          height: `${h * 100}%`,
                          background: active ? info.color : "rgba(255,255,255,0.08)",
                          opacity: active ? 0.85 : 1,
                        }}
                      />
                    ))}
                    {yours && (
                      <span
                        className="absolute inset-y-1 left-1/2 -translate-x-1/2 rounded-full border px-2.5 text-[11px] leading-6 font-semibold whitespace-nowrap backdrop-blur"
                        style={{ borderColor: `${info.color}80`, color: info.color, background: "rgba(7,7,10,0.75)" }}
                      >
                        you play this
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {/* playhead over the waveforms */}
            <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 left-[calc(7rem+0.75rem)] sm:left-[calc(8rem+0.75rem)]">
              <span className="absolute inset-y-0 left-0 w-px bg-white/70 shadow-[0_0_8px_rgba(255,255,255,0.6)] motion-safe:animate-[playhead_12s_linear_infinite]" />
            </span>
          </div>

          <div className="mt-5 space-y-3 rounded-2xl border border-white/5 bg-black/25 px-4 py-3">
            {SHEET.map((line, l) => (
              <p key={l} className="flex flex-wrap gap-x-2 gap-y-1">
                {line.map((w, i) => (
                  <span key={i} className="inline-flex flex-col">
                    <span
                      className="h-4 text-[12px] font-semibold text-zinc-300 motion-safe:animate-[sheet-chord_12s_linear_infinite]"
                      style={{ animationDelay: `${w.at}s` }}
                    >
                      {w.chord ?? ""}
                    </span>
                    <span
                      className="text-[15px] text-zinc-500 motion-safe:animate-[sheet-word_12s_linear_infinite]"
                      style={{ animationDelay: `${w.at}s` }}
                    >
                      {w.word}
                    </span>
                  </span>
                ))}
              </p>
            ))}
          </div>
        </figure>
      </div>

      <ul className="mt-10 grid gap-3 sm:grid-cols-3">
        {[
          { icon: Laptop, title: "Runs on your computer", text: "Separation, chords and lyrics are computed in your browser." },
          { icon: ShieldCheck, title: "No upload, no account", text: "Your audio files never leave your device." },
          { icon: FolderOpen, title: "Your songs, your folder", text: "Keep them in a folder you choose, even in OneDrive or Dropbox." },
        ].map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-4">
            <Icon className="mt-0.5 size-4 shrink-0 text-zinc-300" />
            <div>
              <p className="text-sm font-medium text-zinc-100">{title}</p>
              <p className="mt-0.5 text-sm text-zinc-500">{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
