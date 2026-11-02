"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Toggle } from "@/components/ui/Toggle";
import { keyPosition, MAX_FRET, minorRootPosition, OPEN_STRINGS, positionSpan, scaleName, scaleNeck, scalePosition, type FretNote, type Instrument, type ScaleKind } from "@/lib/chords/scales";
import { chordColor, degreeColor } from "@/lib/chords/colors";
import type { DisplayChord } from "@/lib/chords/sheet";
import { chordTones, degreeName, keyName, noteName, relativeKey, usesFlats, type ChordNotation, type Key } from "@/lib/chords/vocabulary";

/**
 * The scale of the key sounding now on a guitar or bass neck, in the five
 * positions guitarists learn. Notes are labelled like the chords: by name or
 * roman numeral. In Solo along mode the chord playing lights up in its colour
 * (its root, or all of its notes), and the next chord fades in before it comes.
 */

const PREFS_KEY = "playalong:scale-view";

type ChordNotes = "root" | "all";

interface Prefs {
  kind: ScaleKind;
  instrument: Instrument;
  /** Solo along: light up only each chord's root, or all its notes. */
  chordNotes: ChordNotes;
  /**
   * The position counted from the minor root position (0 to 4), so the same box stays chosen for a
   * major key and its relative minor: by default position 1 in minor, position 5 in major. Null for
   * none (then the whole neck shows, unframed).
   */
  minorPosition: number | null;
  /** Show the scale on the whole neck, with the position still framed. */
  wholeNeck: boolean;
}

function readPrefs(): Prefs {
  const fallback: Prefs = { kind: "pentatonic", instrument: "guitar", chordNotes: "root", minorPosition: 0, wholeNeck: false };
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as (Partial<Prefs> & { position?: number | null }) | null;
    if (!stored) return fallback;
    const p = stored.minorPosition;
    return {
      kind: stored.kind === "scale" || stored.kind === "blues" ? stored.kind : "pentatonic",
      instrument: stored.instrument === "bass" ? "bass" : "guitar",
      chordNotes: stored.chordNotes === "all" ? "all" : "root",
      minorPosition: p === null ? null : typeof p === "number" && p >= 0 && p <= 4 ? p : 0,
      // Earlier versions had "whole neck" as a position (-1).
      wholeNeck: stored.wholeNeck === true || stored.position === -1,
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

/** A chord on the neck: how strongly each of its notes shows (as played, after capo / tuning), root and colour. */
interface ChordOnNeck {
  label: string;
  /** Pitch class to strength: the root 1, then the 3rd, 5th and 7th fainter. */
  tones: Map<number, number>;
  root: number;
  color: string;
}

const mod12 = (n: number) => ((n % 12) + 12) % 12;
const STRENGTH = [1, 0.7, 0.5, 0.3];

function onNeck(chord: DisplayChord | null, shift: number, notes: ChordNotes): ChordOnNeck | null {
  const color = degreeColor(chord?.degree);
  if (!chord || chord.root === null || !color) return null;
  const root = mod12(chord.root + shift);
  const tones = new Map<number, number>();
  const all = chordTones(root, chord.quality);
  (notes === "all" ? all : [root]).forEach((pc, i) => tones.set(pc, STRENGTH[Math.min(i, STRENGTH.length - 1)]));
  return { label: chord.label, tones, root, color };
}

/** Lower case where the key's own chord on that degree is minor or diminished, as in roman numeral chords. */
const MINOR_DEGREES: Record<Key["mode"], Set<number>> = { major: new Set([2, 4, 9, 11]), minor: new Set([0, 2, 5, 7]) };

export interface PlayAlongState {
  current: DisplayChord | null;
  next: DisplayChord | null;
  beatsToNext: number | null;
  beatsPerBar: number;
}

export function ScaleView({
  soundingKey,
  shapeKey,
  capo,
  shift,
  notation,
  playMode,
  playing,
}: {
  soundingKey: Key | null;
  shapeKey: Key | null;
  capo: number;
  /** Semitones from the sounding chords to the shapes played. */
  shift: number;
  notation: ChordNotation;
  playMode: boolean;
  playing: PlayAlongState;
}) {
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
  // The chosen position in this key's own numbering.
  const chosen = key && prefs.minorPosition !== null ? keyPosition(prefs.minorPosition, key.mode) : null;
  const position = useMemo(
    () => (key && chosen !== null ? scalePosition(key, prefs.kind, prefs.instrument, chosen) : null),
    [key, prefs.kind, prefs.instrument, chosen],
  );

  const current = playMode ? onNeck(playing.current, shift, prefs.chordNotes) : null;
  const next = playMode ? onNeck(playing.next, shift, prefs.chordNotes) : null;
  // The next chord fades in over the last bar before it.
  const window = Math.max(1, playing.beatsPerBar);
  const fade =
    next && playing.beatsToNext !== null && playing.beatsToNext > 0 && playing.beatsToNext <= window
      ? (window - playing.beatsToNext + 1) / (window + 1)
      : 0;

  if (!key || !soundingKey) {
    return <p className="mt-4 rounded-2xl bg-white/[0.03] px-4 py-6 text-center text-sm text-zinc-400">No key was detected here, so there is no scale to show.</p>;
  }

  const label = (n: FretNote) => {
    if (notation === "names") return noteName(n.pc, usesFlats(key) ? "flat" : "sharp");
    const numeral = degreeName(n.pc, key, "roman");
    return MINOR_DEGREES[key.mode].has(n.degree) ? numeral.toLowerCase() : numeral;
  };
  const span = position ? positionSpan(position) : null;
  // Without a position there is nothing to frame: the whole neck shows.
  const wholeNeck = prefs.wholeNeck || position === null;
  const relative = relativeKey(key);
  // The position that is the relative key's position 1: 5 in major (the minor root position), 2 in minor.
  const linked = key.mode === "major" ? 4 : 1;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-zinc-100">
            {keyName(key)} {scaleName(key, prefs.kind)}{" "}
            <span className="text-sm font-normal text-zinc-500" title="The relative key: the same notes, starting from another root">
              (relative <span className="text-zinc-300">{keyName(relative.key)}</span>, {relative.numeral})
            </span>
          </p>
          <p className="text-xs text-zinc-500">
            {span && chosen !== null ? `Position ${chosen + 1} · frets ${span[0]} to ${span[1]}` : "The whole neck"}
            {span && prefs.wholeNeck ? " · whole neck" : ""}
            {capo > 0 ? ` · frets counted from the capo` : ""}
            {key.tonic !== soundingKey.tonic ? ` · sounds as ${keyName(soundingKey)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Always in place (dimmed while Solo along is off), so nothing jumps when it is switched on. */}
          <div className={`transition-opacity ${playMode ? "" : "pointer-events-none opacity-35"}`} aria-hidden={!playMode}>
            <Segmented
              label="Chord notes"
              value={prefs.chordNotes}
              options={[
                { value: "root", label: "Root", hint: "Light up the root of each chord" },
                { value: "all", label: "All notes", hint: "Light up every note of the chord, the root strongest" },
              ]}
              onChange={(chordNotes) => setPrefs({ chordNotes })}
            />
          </div>
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
        {[0, 1, 2, 3, 4].map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={chosen === p}
            // A second click turns the position off: then the whole neck shows without a frame.
            onClick={() => setPrefs({ minorPosition: chosen === p ? null : minorRootPosition(p, key.mode) })}
            title={
              p === 0
                ? "Position 1 starts on the root note on the lowest string"
                : p === linked
                  ? `The same box as ${keyName(relative.key)} position 1: the relative ${relative.key.mode} key's root position`
                  : undefined
            }
            className={`h-9 rounded-xl border px-3 text-xs font-semibold transition ${
              chosen === p ? "border-guitar/60 bg-guitar/15 text-zinc-50" : "border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-100"
            }`}
          >
            Position {p + 1}
            {p === linked && <span className="ml-1 font-normal text-zinc-400">(= {keyName(relative.key)} position 1)</span>}
          </button>
        ))}
        <Toggle
          size="sm"
          on={wholeNeck}
          disabled={chosen === null}
          onToggle={() => setPrefs({ wholeNeck: !prefs.wholeNeck })}
          title={
            chosen === null
              ? "No position chosen, so the whole neck shows. Pick a position to frame it."
              : "Show the scale on the whole neck; the chosen position stays framed"
          }
        >
          Whole neck
        </Toggle>
      </div>

      <Fretboard
        instrument={prefs.instrument}
        neck={neck}
        position={position}
        wholeNeck={wholeNeck}
        span={span}
        label={label}
        tonic={key.tonic}
        play={playMode ? { current, next, fade } : null}
      />

      {playMode ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
          {current ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-3 rounded-full" style={{ background: current.color }} />
              <span>
                now{" "}
                <span className="font-semibold" style={{ color: current.color }}>
                  {current.label}
                </span>
                {prefs.chordNotes === "all" ? ", root ringed in white, 3rd, 5th and 7th fainter" : ", its root ringed in white"}
              </span>
            </span>
          ) : (
            <span>Play the song: the notes of each chord light up here.</span>
          )}
          {next && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-3 rounded-full border-2" style={{ borderColor: next.color }} />
              <span>
                next{" "}
                <span className="font-semibold" style={{ color: next.color }}>
                  {next.label}
                </span>
                , fading in before it comes
              </span>
            </span>
          )}
          <span>Dashed: chord notes outside the scale.</span>
        </p>
      ) : (
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-3 rounded-full bg-guitar ring-2 ring-zinc-50" /> root note
          </span>
          <span>Each note in the colour of its degree, like the chords.</span>
          <span className={`inline-flex items-center gap-1.5 ${position ? "" : "hidden"}`}>
            {wholeNeck ? (
              <>
                <span className="inline-block size-3 rounded-full bg-zinc-200/40" /> dimmed: outside the position
              </>
            ) : (
              <>
                <span className="inline-block size-2.5 rounded-full border-[1.5px] border-zinc-400/70" /> elsewhere on the neck
              </>
            )}
          </span>
          <span>Lowest string at the bottom, like in tabs.</span>
        </p>
      )}
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
const PAD_Y = 28;
/** Space left and right of the neck, so it sits centred. */
const PAD_X = 18;

function Fretboard({
  instrument,
  neck,
  position,
  wholeNeck,
  span,
  label,
  tonic,
  play,
}: {
  instrument: Instrument;
  neck: FretNote[];
  position: FretNote[] | null;
  wholeNeck: boolean;
  span: [number, number] | null;
  label: (n: FretNote) => string;
  tonic: number;
  play: { current: ChordOnNeck | null; next: ChordOnNeck | null; fade: number } | null;
}) {
  const strings = OPEN_STRINGS[instrument].length;
  const neckEnd = OPEN_W + MAX_FRET * FRET_W;
  const width = neckEnd + 2 * PAD_X;
  const height = PAD_Y * 2 + (strings - 1) * STRING_GAP + 18;
  // Lowest string at the bottom.
  const y = (string: number) => PAD_Y + (strings - 1 - string) * STRING_GAP;
  const x = (fret: number) => (fret === 0 ? OPEN_W - 17 : OPEN_W + (fret - 0.5) * FRET_W);
  const inPosition = new Set((position ?? []).map((n) => `${n.string}:${n.fret}`));
  const scaleNotes = wholeNeck || !position ? neck : position;
  // Chord notes outside the scale (a V7 in minor, a borrowed chord) within the same frets.
  const extra: FretNote[] = [];
  if (play && (play.current || play.next)) {
    const shown = new Set(scaleNotes.map((n) => `${n.string}:${n.fret}`));
    const [lo, hi] = span && !wholeNeck ? span : [0, MAX_FRET];
    OPEN_STRINGS[instrument].forEach((open, string) => {
      for (let fret = lo; fret <= hi; fret++) {
        const pc = (open + fret) % 12;
        const wanted = play.current?.tones.has(pc) || (play.next?.tones.has(pc) && play.fade > 0);
        if (wanted && !shown.has(`${string}:${fret}`)) extra.push({ string, fret, pc, degree: (pc - tonic + 12) % 12 });
      }
    });
  }
  const highlighted = [...scaleNotes, ...extra];
  const outsideScale = new Set(extra.map((n) => `${n.string}:${n.fret}`));
  const bottom = y(0);
  const top = y(strings - 1);

  // On a narrow screen, scroll the chosen position into view.
  const scroller = useRef<HTMLDivElement>(null);
  const from = span?.[0] ?? 0;
  const to = span?.[1] ?? 0;
  useEffect(() => {
    const el = scroller.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const center = span ? PAD_X + (x(Math.max(from, 0)) + x(to)) / 2 : 0;
    el.scrollTo({ left: Math.max(0, center - el.clientWidth / 2), behavior: "smooth" });
    // x depends only on constants
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, span === null]);

  return (
    <div ref={scroller} className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-ink-950/60">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="mx-auto block" role="img" aria-label="Scale on the fretboard">
        <g transform={`translate(${PAD_X} 0)`}>
        {span && (
          <rect
            x={span[0] === 0 ? 14 : OPEN_W + (span[0] - 1) * FRET_W}
            y={top - 20}
            width={(span[0] === 0 ? OPEN_W - 14 : 0) + (span[1] - Math.max(span[0], 1) + 1) * FRET_W}
            height={bottom - top + 40}
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
          <line key={s} x1={OPEN_W} x2={neckEnd} y1={y(s)} y2={y(s)} className="stroke-zinc-500" strokeWidth={(instrument === "bass" ? 2.4 : 1.8) - s * 0.2} />
        ))}
        {/* Fret numbers */}
        {Array.from({ length: MAX_FRET }, (_, i) => i + 1).map((f) => (
          <text key={f} x={OPEN_W + (f - 0.5) * FRET_W} y={height - 6} textAnchor="middle" className={`font-mono text-[10px] ${span && f >= span[0] && f <= span[1] ? "fill-zinc-300" : "fill-zinc-600"}`}>
            {f}
          </text>
        ))}
        {/* Scale notes outside the chosen position */}
        {position &&
          !wholeNeck &&
          neck
            .filter((n) => !inPosition.has(`${n.string}:${n.fret}`))
            .map((n) => (
              <circle
                key={`d${n.string}:${n.fret}`}
                cx={x(n.fret)}
                cy={y(n.string)}
                r={4.5}
                className="fill-ink-950"
                stroke={chordColor(n.degree)}
                strokeOpacity={0.7}
                strokeWidth={1.5}
              />
            ))}
        {/* The position (or the whole neck), labelled */}
        {highlighted.map((n) => {
          const id = `${n.string}:${n.fret}`;
          const text = label(n);
          const size = text.length > 2 ? "text-[8.5px]" : "text-[10px]";
          // On the whole neck, notes outside the framed position step back a little.
          const away = wholeNeck && position !== null && !inPosition.has(id);
          if (!play) {
            const root = n.degree === 0;
            return (
              // Every note in the colour of its scale degree, as the chords; the root ringed in white.
              <g key={`n${id}`} opacity={away ? 0.5 : 1}>
                <circle
                  cx={x(n.fret)}
                  cy={y(n.string)}
                  r={root ? 10.25 : 11.5}
                  fill={chordColor(n.degree)}
                  stroke={root ? "#fafafa" : "none"}
                  strokeWidth={2.5}
                />
                <text x={x(n.fret)} y={y(n.string)} dy="0.35em" textAnchor="middle" className={`fill-ink-950 font-semibold ${size}`}>
                  {text}
                </text>
              </g>
            );
          }
          const now = play.current?.tones.has(n.pc) ? play.current : null;
          const strength = now?.tones.get(n.pc) ?? 0;
          const coming = play.next?.tones.has(n.pc) ? play.next : null;
          const comingStrength = coming?.tones.get(n.pc) ?? 0;
          const outside = outsideScale.has(id);
          const isRoot = !!now && n.pc === now.root;
          return (
            <g
              key={`n${id}`}
              style={outside && !now ? { opacity: play.fade, transition: "opacity 400ms" } : away && !now && !coming ? { opacity: 0.6 } : undefined}
            >
              {coming && (
                <circle
                  cx={x(n.fret)}
                  cy={y(n.string)}
                  r={14.5}
                  fill="none"
                  stroke={coming.color}
                  strokeWidth={3}
                  style={{ opacity: play.fade * Math.max(comingStrength, 0.5), transition: "opacity 400ms" }}
                />
              )}
              <circle
                cx={x(n.fret)}
                cy={y(n.string)}
                r={11.5}
                fill="#27272a"
                stroke={isRoot ? "#fafafa" : outside ? "#a1a1aa" : "none"}
                strokeWidth={isRoot ? 2.5 : 1.5}
                strokeDasharray={outside && !isRoot ? "3 2" : undefined}
              />
              {/* The note's own colour, dimmed: Solo along keeps the colours and lights up what is played. */}
              <circle cx={x(n.fret)} cy={y(n.string)} r={isRoot ? 10.25 : 11.5} fill={chordColor(n.degree)} opacity={0.3} />
              <circle
                cx={x(n.fret)}
                cy={y(n.string)}
                r={isRoot ? 10.25 : 11.5}
                style={{ fill: now?.color ?? "#27272a", opacity: strength, transition: "opacity 250ms, fill 250ms" }}
              />
              <text
                x={x(n.fret)}
                y={y(n.string)}
                dy="0.35em"
                textAnchor="middle"
                className={`font-semibold ${size} ${strength >= 0.5 ? "fill-ink-950" : "fill-zinc-300"}`}
              >
                {text}
              </text>
            </g>
          );
        })}
        {/* String names */}
        {STRING_NAMES[instrument].map((name, s) => (
          <text key={name + s} x={-6} y={y(s)} dy="0.35em" className="fill-zinc-600 font-mono text-[10px]">
            {name}
          </text>
        ))}
        </g>
      </svg>
    </div>
  );
}
