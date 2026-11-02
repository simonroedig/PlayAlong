"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { alpha, chordColor, degreeColor } from "@/lib/chords/colors";
import { circleNames, circlePlace, circleTonic, diatonicOnCircle, keySignature, MAJOR_SCALE, MODES, modeDegrees, modeSteps } from "@/lib/chords/theory";
import { keyName, relativeKey, type ChordNotation, type Key } from "@/lib/chords/vocabulary";

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

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
        <div className="flex items-center justify-between gap-2 px-1">
          <h3 className="text-sm font-semibold text-zinc-100">Circle of fifths</h3>
          {picked && songKey && (
            <button
              type="button"
              onClick={() => pick(songKey)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
            >
              <RotateCcw className="size-3" /> Song key ({keyName(songKey)})
            </button>
          )}
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
            </button>
          ))}
        </div>
        <ModeDetail tonic={key.tonic} modeIndex={MODES.indexOf(mode)} notation={notation} />
      </section>
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

      {/* Notes with the whole (W) and half (H) steps between them. */}
      <div className="mt-4 flex items-center overflow-x-auto pb-1">
        {degrees.map((d, i) => {
          const feature = mode.feature.includes(i);
          return (
            <div key={i} className="flex shrink-0 items-center">
              <div
                className={`flex size-12 flex-col items-center justify-center rounded-full border-2 ${feature ? "border-guitar" : i === 0 ? "border-zinc-200" : "border-white/15"}`}
                style={{ background: alpha(chordColor(d.semitones), 0.14) }}
                title={feature ? `${d.degree}: what gives ${mode.name} its sound` : d.degree}
              >
                <span className="text-sm font-bold text-zinc-50">{notation === "roman" ? d.degree : d.note}</span>
                <span className="text-[10px] text-zinc-400">{notation === "roman" ? d.note : d.degree}</span>
              </div>
              <span
                className={`mx-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold ${steps[i] === 1 ? "bg-guitar/20 text-guitar" : "text-zinc-500"}`}
                title={steps[i] === 1 ? "Half step: one fret" : "Whole step: two frets"}
              >
                {steps[i] === 1 ? "H" : "W"}
              </span>
              {i === 6 && (
                <div className="flex size-12 shrink-0 flex-col items-center justify-center rounded-full border-2 border-dashed border-white/15">
                  <span className="text-sm font-bold text-zinc-400">{notation === "roman" ? "1" : degrees[0].note}</span>
                  <span className="text-[10px] text-zinc-500">octave</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        W = whole step (two frets), H = half step (one fret). Pattern: <span className="font-mono text-zinc-300">{steps.map((s) => (s === 2 ? "W" : "H")).join(" ")}</span>
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
      <Keyboard tonic={tonic} semitones={degrees.map((d) => d.semitones)} feature={mode.feature.map((i) => degrees[i].semitones)} />
    </div>
  );
}

/** Two octaves of piano keys with the mode's notes marked. */
function Keyboard({ tonic, semitones, feature }: { tonic: number; semitones: number[]; feature: number[] }) {
  const whites = [0, 2, 4, 5, 7, 9, 11];
  const blacks = [1, 3, 6, 8, 10];
  const w = 22;
  const notes = new Set(semitones.map((s) => mod12(tonic + s)));
  const special = new Set(feature.map((s) => mod12(tonic + s)));
  const mark = (pc: number, x: number, y: number) =>
    notes.has(pc) ? (
      <circle cx={x} cy={y} r={5} fill={pc === mod12(tonic) ? "#fafafa" : special.has(pc) ? "#fb923c" : chordColor(mod12(pc - tonic))} />
    ) : null;
  return (
    <svg viewBox={`0 0 ${14 * w + 2} 92`} className="mt-4 block w-full max-w-md" role="img" aria-label="The mode on a keyboard">
      {Array.from({ length: 14 }, (_, i) => {
        const pc = whites[i % 7];
        return (
          <g key={`w${i}`}>
            <rect x={1 + i * w} y={1} width={w - 2} height={88} rx={3} className="fill-zinc-200" />
            {mark(pc, 1 + i * w + (w - 2) / 2, 74)}
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
              {mark(pc, x + 7, 44)}
            </g>
          );
        }),
      )}
    </svg>
  );
}
