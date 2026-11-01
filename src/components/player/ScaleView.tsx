"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_FRET, OPEN_STRINGS, positionSpan, scaleName, scaleNeck, scalePosition, type FretNote, type Instrument, type ScaleKind } from "@/lib/chords/scales";
import { degreeName, keyName, noteName, usesFlats, type ChordNotation, type Key } from "@/lib/chords/vocabulary";

/**
 * The scale of the key sounding now on a guitar or bass neck, in the five
 * positions guitarists learn. Notes are labelled like the chords: by name,
 * roman numeral or number.
 */

const PREFS_KEY = "playalong:scale-view";

interface Prefs {
  kind: ScaleKind;
  instrument: Instrument;
  /** 0 to 4, or -1 for the whole neck. */
  position: number;
}

function readPrefs(): Prefs {
  const fallback: Prefs = { kind: "pentatonic", instrument: "guitar", position: 0 };
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
    if (!stored) return fallback;
    return {
      kind: stored.kind === "scale" || stored.kind === "blues" ? stored.kind : "pentatonic",
      instrument: stored.instrument === "bass" ? "bass" : "guitar",
      position: typeof stored.position === "number" && stored.position >= -1 && stored.position <= 4 ? stored.position : 0,
    };
  } catch {
    return fallback;
  }
}

const KINDS: { value: ScaleKind; label: string; hint: string }[] = [
  { value: "pentatonic", label: "Pentatonic", hint: "Five notes, the safe choice for solos" },
  { value: "scale", label: "Full scale", hint: "All seven notes of the key" },
  { value: "blues", label: "Blues", hint: "Pentatonic plus the blue note" },
];

const STRING_NAMES: Record<Instrument, string[]> = { guitar: ["E", "A", "D", "G", "B", "e"], bass: ["E", "A", "D", "G"] };
const MARKERS = [3, 5, 7, 9, 15, 17];

export function ScaleView({ soundingKey, shapeKey, capo, notation }: { soundingKey: Key | null; shapeKey: Key | null; capo: number; notation: ChordNotation }) {
  const [prefs, setPrefsState] = useState<Prefs>(readPrefs);
  const setPrefs = (next: Partial<Prefs>) =>
    setPrefsState((p) => {
      const merged = { ...p, ...next };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
      } catch {
        // storage blocked
      }
      return merged;
    });

  // The neck is drawn for the shapes played (with capo or down-tuning), like the chord names.
  const key = shapeKey;
  const neck = useMemo(() => (key ? scaleNeck(key, prefs.kind, prefs.instrument) : []), [key, prefs.kind, prefs.instrument]);
  const position = useMemo(
    () => (key && prefs.position >= 0 ? scalePosition(key, prefs.kind, prefs.instrument, prefs.position) : null),
    [key, prefs.kind, prefs.instrument, prefs.position],
  );

  if (!key || !soundingKey) {
    return <p className="mt-4 rounded-2xl bg-white/[0.03] px-4 py-6 text-center text-sm text-zinc-400">No key was detected here, so there is no scale to show.</p>;
  }

  const label = (n: FretNote) => (notation === "names" ? noteName(n.pc, usesFlats(key) ? "flat" : "sharp") : degreeName(n.pc, key, notation));
  const span = position ? positionSpan(position) : null;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-zinc-100">
            {keyName(key)} {scaleName(key, prefs.kind)}
          </p>
          <p className="text-xs text-zinc-500">
            {span ? `Position ${prefs.position + 1} · frets ${span[0]} to ${span[1]}` : "The whole neck"}
            {capo > 0 ? ` · frets counted from the capo` : ""}
            {key.tonic !== soundingKey.tonic ? ` · sounds as ${keyName(soundingKey)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Scale"
            value={prefs.kind}
            options={KINDS}
            onChange={(kind) => setPrefs({ kind })}
          />
          <Segmented
            label="Instrument"
            value={prefs.instrument}
            options={[
              { value: "guitar", label: "Guitar", hint: "Six strings, standard tuning" },
              { value: "bass", label: "Bass", hint: "Four strings, standard tuning" },
            ]}
            onChange={(instrument) => setPrefs({ instrument })}
          />
        </div>
      </div>

      <div role="radiogroup" aria-label="Position" className="mt-3 flex flex-wrap gap-1.5">
        {[0, 1, 2, 3, 4, -1].map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={prefs.position === p}
            onClick={() => setPrefs({ position: p })}
            title={p === 0 ? "Position 1 starts on the root note on the lowest string" : undefined}
            className={`h-9 rounded-xl border px-3 text-xs font-semibold transition ${
              prefs.position === p ? "border-guitar/60 bg-guitar/15 text-zinc-50" : "border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-100"
            }`}
          >
            {p === -1 ? "Whole neck" : `Position ${p + 1}`}
          </button>
        ))}
      </div>

      <Fretboard instrument={prefs.instrument} neck={neck} position={position} span={span} label={label} />

      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-full bg-guitar" /> root note
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-full bg-zinc-200" /> in this position
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full border-[1.5px] border-zinc-400/70" /> elsewhere on the neck
        </span>
        <span>Lowest string at the bottom, like in tabs.</span>
      </p>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; hint: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex h-9 items-center rounded-xl border border-white/10 bg-white/[0.04] p-0.5 text-xs font-medium">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={`h-full rounded-[9px] px-3 transition ${value === o.value ? "bg-zinc-100 text-ink-950" : "text-zinc-400 hover:text-zinc-100"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const FRET_W = 52;
const OPEN_W = 50;
const STRING_GAP = 28;
const PAD_Y = 20;

function Fretboard({
  instrument,
  neck,
  position,
  span,
  label,
}: {
  instrument: Instrument;
  neck: FretNote[];
  position: FretNote[] | null;
  span: [number, number] | null;
  label: (n: FretNote) => string;
}) {
  const strings = OPEN_STRINGS[instrument].length;
  const width = OPEN_W + MAX_FRET * FRET_W + 8;
  const height = PAD_Y * 2 + (strings - 1) * STRING_GAP + 18;
  // Lowest string at the bottom.
  const y = (string: number) => PAD_Y + (strings - 1 - string) * STRING_GAP;
  const x = (fret: number) => (fret === 0 ? OPEN_W - 17 : OPEN_W + (fret - 0.5) * FRET_W);
  const inPosition = new Set((position ?? []).map((n) => `${n.string}:${n.fret}`));
  const highlighted = position ?? neck;
  const bottom = y(0);
  const top = y(strings - 1);

  // On a narrow screen, scroll the chosen position into view.
  const scroller = useRef<HTMLDivElement>(null);
  const from = span?.[0] ?? 0;
  const to = span?.[1] ?? 0;
  useEffect(() => {
    const el = scroller.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const center = span ? (x(Math.max(from, 0)) + x(to)) / 2 : 0;
    el.scrollTo({ left: Math.max(0, center - el.clientWidth / 2), behavior: "smooth" });
    // x depends only on constants
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, span === null]);

  return (
    <div ref={scroller} className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-ink-950/60">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block" role="img" aria-label="Scale on the fretboard">
        {span && (
          <rect
            x={span[0] === 0 ? 14 : OPEN_W + (span[0] - 1) * FRET_W}
            y={top - 14}
            width={(span[0] === 0 ? OPEN_W - 14 : 0) + (span[1] - Math.max(span[0], 1) + 1) * FRET_W}
            height={bottom - top + 28}
            rx={10}
            className="fill-guitar/[0.07] stroke-guitar/40"
            strokeWidth={1}
          />
        )}
        {/* Fret markers */}
        {MARKERS.map((f) => (
          <circle key={f} cx={OPEN_W + (f - 0.5) * FRET_W} cy={(top + bottom) / 2} r={5} className="fill-white/[0.06]" />
        ))}
        <circle cx={OPEN_W + 11.5 * FRET_W} cy={top + STRING_GAP * 0.5} r={5} className="fill-white/[0.06]" />
        <circle cx={OPEN_W + 11.5 * FRET_W} cy={bottom - STRING_GAP * 0.5} r={5} className="fill-white/[0.06]" />
        {/* Nut and frets */}
        <line x1={OPEN_W} x2={OPEN_W} y1={top} y2={bottom} className="stroke-zinc-300" strokeWidth={4} />
        {Array.from({ length: MAX_FRET }, (_, i) => (
          <line key={i} x1={OPEN_W + (i + 1) * FRET_W} x2={OPEN_W + (i + 1) * FRET_W} y1={top} y2={bottom} className="stroke-white/15" strokeWidth={1.5} />
        ))}
        {/* Strings */}
        {Array.from({ length: strings }, (_, s) => (
          <line key={s} x1={OPEN_W} x2={width} y1={y(s)} y2={y(s)} className="stroke-zinc-500" strokeWidth={(instrument === "bass" ? 2.4 : 1.8) - s * 0.2} />
        ))}
        {/* Fret numbers */}
        {Array.from({ length: MAX_FRET }, (_, i) => i + 1).map((f) => (
          <text key={f} x={OPEN_W + (f - 0.5) * FRET_W} y={height - 6} textAnchor="middle" className={`font-mono text-[10px] ${span && f >= span[0] && f <= span[1] ? "fill-zinc-300" : "fill-zinc-600"}`}>
            {f}
          </text>
        ))}
        {/* Scale notes outside the chosen position */}
        {position &&
          neck
            .filter((n) => !inPosition.has(`${n.string}:${n.fret}`))
            .map((n) => (
              <circle
                key={`d${n.string}:${n.fret}`}
                cx={x(n.fret)}
                cy={y(n.string)}
                r={4.5}
                className={n.degree === 0 ? "fill-ink-950 stroke-guitar/70" : "fill-ink-950 stroke-zinc-400/70"}
                strokeWidth={1.5}
              />
            ))}
        {/* The position (or the whole neck), labelled */}
        {highlighted.map((n) => {
          const root = n.degree === 0;
          return (
            <g key={`n${n.string}:${n.fret}`}>
              <circle cx={x(n.fret)} cy={y(n.string)} r={11.5} className={root ? "fill-guitar" : "fill-zinc-200"} />
              <text
                x={x(n.fret)}
                y={y(n.string)}
                dy="0.35em"
                textAnchor="middle"
                className={`fill-ink-950 font-semibold ${label(n).length > 2 ? "text-[8.5px]" : "text-[10px]"}`}
              >
                {label(n)}
              </text>
            </g>
          );
        })}
        {/* String names */}
        {STRING_NAMES[instrument].map((name, s) => (
          <text key={name + s} x={4} y={y(s)} dy="0.35em" className="fill-zinc-600 font-mono text-[10px]">
            {name}
          </text>
        ))}
      </svg>
    </div>
  );
}
