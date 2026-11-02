"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { alpha, chordColor, degreeColor } from "@/lib/chords/colors";
import { circleNames, circlePlace, circleTonic, diatonicOnCircle, keySignature, MAJOR_SCALE, MODES, modeDegrees, modeSteps } from "@/lib/chords/theory";
import { Select } from "@/components/ui/Select";
import { keyName, noteName, relativeKey, usesFlats, type ChordNotation, type Key } from "@/lib/chords/vocabulary";

/**
 * Music theory around the song: the circle of fifths with the song's key and
 * its chords, and the seven modes with their whole and half steps. Click any
 * key to explore it; the song's key is where it starts.
 */

const sameKey = (a: Key | null, b: Key | null) => !!a && !!b && a.tonic === b.tonic && a.mode === b.mode;
const mod12 = (n: number) => ((n % 12) + 12) % 12;

export function TheoryView({
  songKey,
  notation,
  used,
}: {
  songKey: Key | null;
  notation: ChordNotation;
  /** Chords of the song (root and whether minor), to mark them on the circle. */
  used: { root: number; minor: boolean }[];
}) {
  const fallback: Key = { tonic: 0, mode: "major" };
  const [picked, setPicked] = useState<Key | null>(null);
  const key = picked ?? songKey ?? fallback;
  const [modeIndex, setModeIndex] = useState<number | null>(null);
  const mode = MODES[modeIndex ?? (key.mode === "major" ? 0 : 5)];
  const pick = (next: Key) => {
    // The mode picked stays: the same mode, now on the new key's tonic.
    setPicked(sameKey(next, songKey) ? null : next);
  };

  const songMode = songKey ? (songKey.mode === "major" ? 0 : 5) : null;
  const spelling = usesFlats(key) ? "flat" : "sharp";

  return (
    <div className="mt-4">
      {/* Which key to look at: the song's, or any other. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        <span>Key</span>
        <Select
          label="Root note"
          align="left"
          value={key.tonic}
          onChange={(tonic) => pick({ tonic, mode: key.mode })}
          options={Array.from({ length: 12 }, (_, pc) => ({ value: pc, label: noteName(pc, spelling) }))}
        />
        <div role="radiogroup" aria-label="Major or minor" className="flex h-9 items-center rounded-xl border border-white/10 bg-white/[0.04] p-0.5 font-medium">
          {(["major", "minor"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={key.mode === m}
              onClick={() => pick({ tonic: key.tonic, mode: m })}
              className={`h-full rounded-[9px] px-3 transition ${key.mode === m ? "bg-zinc-100 text-ink-950" : "text-zinc-400 hover:text-zinc-100"}`}
            >
              {m}
            </button>
          ))}
        </div>
        {songKey && (
          <span className="ml-1">
            This song: <span className="font-semibold text-zinc-200">{keyName(songKey).replace(/m$/, "")} {songKey.mode}</span>
          </span>
        )}
        {picked && songKey && (
          <button
            type="button"
            onClick={() => {
              pick(songKey);
              setModeIndex(null);
            }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-zinc-300 hover:bg-white/5 hover:text-zinc-50"
          >
            <RotateCcw className="size-3" /> Back to the song&apos;s key
          </button>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
          <div className="flex items-center justify-between gap-2 px-1">
            <h3 className="text-sm font-semibold text-zinc-100">Circle of fifths</h3>
          </div>
          <Circle selected={key} songKey={songKey} used={used} onPick={pick} />
          <p className="px-1 text-xs leading-relaxed text-zinc-400">
            Each step clockwise is a fifth up (one more ♯), counter-clockwise a fourth up (one more ♭). A key&apos;s chords
            are its neighbours: in major I, IV and V outside, ii, iii and vi inside. Inside sits each key&apos;s relative
            minor, with the same notes. Click a key to explore it.
          </p>
        </section>

        <section className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">
          <h3 className="text-sm font-semibold text-zinc-100">Modes</h3>
          <p className="mt-1 text-xs text-zinc-400">
            The seven modes use the notes of a major scale, each starting on another of its notes. Shown on{" "}
            <span className="text-zinc-200">{keyName({ tonic: key.tonic, mode: "major" })}</span>.
          </p>
          <div role="radiogroup" aria-label="Mode" className="mt-3 flex flex-wrap gap-1.5">
            {MODES.map((m, i) => (
              <button
                key={m.name}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setModeIndex(i)}
                className={`rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition ${
                  mode === m ? "border-zinc-300/60 bg-white/10 text-zinc-50" : "border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-100"
                }`}
              >
                {m.name}
                {m.alias && <span className="ml-1 font-normal text-zinc-500">{m.alias}</span>}
                {songMode === i && (
                  <span className="ml-1.5 rounded-md bg-guitar/15 px-1 py-px text-[10px] font-semibold text-guitar" title="The mode of the song playing">
                    song
                  </span>
                )}
              </button>
            ))}
          </div>
          <ModeDetail tonic={key.tonic} modeIndex={MODES.indexOf(mode)} notation={notation} />
        </section>
      </div>
    </div>
  );
}

function arc(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
  return `M ${p(r1, a0)} A ${r1} ${r1} 0 0 1 ${p(r1, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 0 0 ${p(r0, a0)} Z`;
}

function Circle({ selected, songKey, used, onPick }: { selected: Key; songKey: Key | null; used: { root: number; minor: boolean }[]; onPick: (k: Key) => void }) {
  const size = 340;
  const c = size / 2;
  const outer = [168, 118];
  const inner = [118, 76];
  const diatonic = diatonicOnCircle(selected);
  const isSong = sameKey(selected, songKey);
  const center = circlePlace(selected);
  const sig = keySignature(center);
  const relative = relativeKey(selected);

  const segment = (place: number, ring: "outer" | "inner") => {
    const [r1, r0] = ring === "outer" ? outer : inner;
    const a0 = ((place * 30 - 15 - 90) * Math.PI) / 180;
    const a1 = ((place * 30 + 15 - 90) * Math.PI) / 180;
    const mid = (a0 + a1) / 2;
    const rText = (r0 + r1) / 2;
    const names = circleNames(place);
    const label = ring === "outer" ? names.major : names.minor;
    const root = ring === "outer" ? circleTonic(place) : mod12(circleTonic(place) + 9);
    const entry = diatonic.find((d) => d.place === place && d.ring === ring);
    const color = entry ? degreeColor(mod12(entry.root - selected.tonic)) : null;
    const tonic = entry && entry.root === selected.tonic && (ring === "outer") === (selected.mode === "major");
    const inSong = isSong && entry && used.some((u) => u.root === root && u.minor === (ring === "inner"));
    const k: Key = ring === "outer" ? { tonic: root, mode: "major" } : { tonic: root, mode: "minor" };
    return (
      <g key={`${ring}${place}`} onClick={() => onPick(k)} className="cursor-pointer" role="button" aria-label={`${label}${entry ? `, ${entry.numeral}` : ""}`}>
        <path
          d={arc(c, c, r0, r1, a0, a1)}
          fill={color ? alpha(color, tonic ? 0.45 : 0.18) : "rgba(255,255,255,0.025)"}
          stroke={tonic ? "#fafafa" : "rgba(255,255,255,0.12)"}
          strokeWidth={tonic ? 2 : 1}
          className="transition-[fill] hover:brightness-150"
        />
        <text
          x={c + rText * Math.cos(mid)}
          y={c + rText * Math.sin(mid) - (entry ? 5 : 0)}
          textAnchor="middle"
          dy="0.35em"
          className={entry ? "fill-zinc-50 font-semibold" : "fill-zinc-500"}
          fontSize={label.length > 4 ? 9 : ring === "outer" ? 14 : 11}
        >
          {label}
        </text>
        {entry && (
          <text x={c + rText * Math.cos(mid)} y={c + rText * Math.sin(mid) + 10} textAnchor="middle" dy="0.35em" fontSize={10} fill={color ?? undefined} className="font-semibold">
            {entry.numeral}
          </text>
        )}
        {inSong && <circle cx={c + (r1 - 7) * Math.cos(mid)} cy={c + (r1 - 7) * Math.sin(mid)} r={2.5} fill="#fafafa" />}
      </g>
    );
  };

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto my-2 block w-full max-w-[340px]" role="group" aria-label="Circle of fifths">
      {Array.from({ length: 12 }, (_, p) => segment(p, "outer"))}
      {Array.from({ length: 12 }, (_, p) => segment(p, "inner"))}
      <text x={c} y={c - 14} textAnchor="middle" className="fill-zinc-50 font-semibold" fontSize={17}>
        {keyName(selected).replace(/m$/, "")} {selected.mode}
      </text>
      <text x={c} y={c + 6} textAnchor="middle" className="fill-zinc-400" fontSize={11}>
        {sig.accidental ? `${sig.count} ${sig.accidental === "♯" ? "sharp" : "flat"}${sig.count > 1 ? "s" : ""}` : "no ♯ or ♭"}
      </text>
      <text x={c} y={c + 22} textAnchor="middle" className="fill-zinc-500" fontSize={10}>
        relative {keyName(relative.key)} ({relative.numeral})
      </text>
      {isSong && (
        <text x={c} y={c + 38} textAnchor="middle" className="fill-zinc-500" fontSize={9}>
          ● chords in the song
        </text>
      )}
    </svg>
  );
}

function ModeDetail({ tonic, modeIndex, notation }: { tonic: number; modeIndex: number; notation: ChordNotation }) {
  const mode = MODES[modeIndex];
  const degrees = modeDegrees(tonic, mode);
  const steps = modeSteps(mode);
  const parentTonic = mod12(tonic - MAJOR_SCALE[mode.start]);
  const ordinal = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"][mode.start];
  const title = `${degrees[0].note} ${mode.name}`;

  return (
    <div className="mt-4">
      <p className="text-lg font-semibold text-zinc-50">
        {title}
        {mode.alias && <span className="ml-2 text-sm font-normal text-zinc-400">({mode.alias.toLowerCase()})</span>}
      </p>
      <p className="mt-0.5 text-sm text-zinc-300">{mode.mood}</p>
      <p className="mt-1 text-xs text-zinc-500">
        {mode.start === 0
          ? "The reference: every other mode is this scale started on another note."
          : `The notes of ${keyName({ tonic: parentTonic, mode: "major" })} major, starting on its ${ordinal} note.`}
        {mode.featureName && (
          <>
            {" "}
            Its colour comes from the <span className="font-semibold text-guitar">{mode.featureName}</span>
            {mode.start < 3 || mode.start === 6 ? " (compared with natural minor or major)." : " (compared with major)."}
          </>
        )}
      </p>

      {/* The notes, with a whole or half step between each two. */}
      <div className="mt-4 flex flex-wrap items-end gap-y-3 pb-1">
        {degrees.map((d, i) => {
          const feature = mode.feature.includes(i);
          const color = chordColor(d.semitones);
          return (
            <div key={i} className="flex shrink-0 items-end">
              <Note
                color={color}
                ring={i === 0 ? "#fafafa" : feature ? "#fb923c" : null}
                main={notation === "roman" ? d.degree : d.note}
                sub={notation === "roman" ? d.note : d.degree}
                title={feature ? `${d.degree}: what gives ${mode.name} its sound` : d.degree}
              />
              <Step half={steps[i] === 1} />
              {i === 6 && <Note color={chordColor(0)} ring="#fafafa" dashed main={notation === "roman" ? "1" : degrees[0].note} sub="octave" />}
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Whole step = two frets, half step = one fret. Pattern:{" "}
        <span className="font-mono text-zinc-300">{steps.map((s) => (s === 2 ? "W" : "H")).join(" ")}</span>
      </p>

      {/* The chord on each degree. */}
      <p className="mt-4 text-xs font-semibold tracking-[0.12em] text-zinc-400 uppercase">Chords in {title}</p>
      <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
        {degrees.map((d, i) => {
          const color = chordColor(d.semitones);
          return (
            <div key={i} className="rounded-xl border px-2 py-1.5 text-center" style={{ borderColor: alpha(color, 0.45), background: alpha(color, 0.08) }}>
              <div className="text-base font-bold" style={{ color }}>
                {notation === "roman" ? d.numeral : d.chord}
              </div>
              <div className="text-[11px] text-zinc-400">{notation === "roman" ? d.chord : d.numeral}</div>
            </div>
          );
        })}
      </div>
      <Keyboard tonic={tonic} semitones={degrees.map((d) => d.semitones)} />
    </div>
  );
}

function Note({ color, ring, main, sub, title, dashed }: { color: string; ring: string | null; main: string; sub: string; title?: string; dashed?: boolean }) {
  return (
    <div
      className={`flex size-12 shrink-0 flex-col items-center justify-center rounded-full border-2 ${dashed ? "border-dashed" : ""}`}
      style={{ background: alpha(color, dashed ? 0.08 : 0.22), borderColor: ring ?? alpha(color, 0.9) }}
      title={title}
    >
      <span className="text-sm leading-tight font-bold" style={{ color }}>
        {main}
      </span>
      <span className="text-[10px] leading-tight text-zinc-300">{sub}</span>
    </div>
  );
}

/** An arrow to the next note, labelled whole or half step. */
function Step({ half }: { half: boolean }) {
  return (
    <div className={`mx-1 flex w-11 shrink-0 flex-col items-center pb-3 ${half ? "text-guitar" : "text-zinc-500"}`} title={half ? "Half step: one fret" : "Whole step: two frets"}>
      <span className="text-[10px] font-semibold">{half ? "half" : "whole"}</span>
      <svg width="40" height="10" viewBox="0 0 40 10" aria-hidden>
        <path d="M2 5 H34 M30 1 L36 5 L30 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** Two octaves of piano keys with the scale marked once, from its root up to the octave. */
function Keyboard({ tonic, semitones }: { tonic: number; semitones: number[] }) {
  const whites = [0, 2, 4, 5, 7, 9, 11];
  const blacks = [1, 3, 6, 8, 10];
  const w = 22;
  const root = mod12(tonic);
  // Key index (0 to 23) of each scale note, and the octave on top.
  const marked = new Map<number, number>([...semitones.map((s) => [root + s, s] as [number, number]), [root + 12, 0]]);
  const mark = (index: number, x: number, y: number) => {
    const s = marked.get(index);
    if (s === undefined) return null;
    // A dark edge and a shadow, so bright dots stand out on white keys too.
    return (
      <g style={{ filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,0.65))" }}>
        {/* The root: ringed in white, with a dark edge around the ring. */}
        {s === 0 && <circle cx={x} cy={y} r={8} fill="#18181b" />}
        <circle cx={x} cy={y} r={6} fill={chordColor(s)} stroke={s === 0 ? "#fafafa" : "#18181b"} strokeWidth={s === 0 ? 2 : 1.2} />
      </g>
    );
  };
  return (
    <svg viewBox={`0 0 ${14 * w + 2} 92`} className="mt-4 block w-full max-w-md" role="img" aria-label="The mode on a keyboard">
      {Array.from({ length: 14 }, (_, i) => {
        const index = Math.floor(i / 7) * 12 + whites[i % 7];
        return (
          <g key={`w${i}`}>
            <rect x={1 + i * w} y={1} width={w - 2} height={88} rx={3} className="fill-zinc-200" />
            {mark(index, 1 + i * w + (w - 2) / 2, 74)}
          </g>
        );
      })}
      {Array.from({ length: 2 }, (_, o) =>
        blacks.map((pc) => {
          const pos = { 1: 1, 3: 2, 6: 4, 8: 5, 10: 6 }[pc]!;
          const x = 1 + (o * 7 + pos) * w - 7;
          return (
            <g key={`b${o}${pc}`}>
              <rect x={x} y={1} width={14} height={54} rx={2} className="fill-ink-950" />
              {mark(o * 12 + pc, x + 7, 44)}
            </g>
          );
        }),
      )}
    </svg>
  );
}
