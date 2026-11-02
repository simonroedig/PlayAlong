"use client";

import { voicingNotes, type Voicing } from "@/lib/chords/voicings";

/**
 * A chord box: strings from low E (left) to high e, the nut or the starting
 * fret on top, × for strings not played, ○ for open strings. Root notes in
 * the chord's colour.
 */
export function ChordDiagram({ voicing, color, size = "md" }: { voicing: Voicing; color: string; size?: "sm" | "md" }) {
  const scale = size === "sm" ? 0.72 : 1;
  const gapX = 13 * scale;
  const gapY = 16 * scale;
  const left = 16 * scale;
  const top = 16 * scale;
  const played = voicing.frets.filter((f): f is number => f !== null && f > 0);
  const maxFret = played.length ? Math.max(...played) : 0;
  const minFret = played.length ? Math.min(...played) : 0;
  // From the nut when it fits in four frets, otherwise from the lowest fret used.
  const base = maxFret <= 4 ? 1 : minFret;
  const rows = Math.max(4, maxFret - base + 1);
  const width = left + 5 * gapX + 10 * scale;
  const height = top + rows * gapY + 6 * scale;
  const x = (s: number) => left + s * gapX;
  const y = (fret: number) => top + (fret - base + 0.5) * gapY;
  const notes = voicingNotes(voicing.frets);
  const root = notes[0];
  let n = 0;
  const pcs = voicing.frets.map((f) => (f === null ? null : notes[n++]));
  const barreStrings = voicing.barre === null ? [] : voicing.frets.flatMap((f, s) => (f === voicing.barre ? [s] : []));

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Fingering: ${voicing.frets.map((f) => (f === null ? "x" : f)).join(" ")}`}>
      {/* Nut or starting fret */}
      {base === 1 ? (
        <rect x={x(0) - 1} y={top - 3 * scale} width={5 * gapX + 2} height={3 * scale} rx={1} className="fill-zinc-300" />
      ) : (
        <text x={x(0) - 5 * scale} y={y(base)} dy="0.35em" textAnchor="end" className="fill-zinc-500 font-mono" fontSize={9 * scale}>
          {base}
        </text>
      )}
      {Array.from({ length: rows + 1 }, (_, r) => (
        <line key={`f${r}`} x1={x(0)} x2={x(5)} y1={top + r * gapY} y2={top + r * gapY} className="stroke-white/20" strokeWidth={1} />
      ))}
      {Array.from({ length: 6 }, (_, s) => (
        <line key={`s${s}`} x1={x(s)} x2={x(s)} y1={top} y2={top + rows * gapY} className="stroke-zinc-500" strokeWidth={1} />
      ))}
      {barreStrings.length >= 2 && voicing.barre !== null && (
        <rect
          x={x(barreStrings[0]) - 4.5 * scale}
          y={y(voicing.barre) - 4.5 * scale}
          width={x(barreStrings[barreStrings.length - 1]) - x(barreStrings[0]) + 9 * scale}
          height={9 * scale}
          rx={4.5 * scale}
          className="fill-zinc-200"
        />
      )}
      {voicing.frets.map((f, s) =>
        f === null ? (
          <text key={s} x={x(s)} y={top - 7 * scale} textAnchor="middle" className="fill-zinc-500" fontSize={9 * scale}>
            ×
          </text>
        ) : f === 0 ? (
          <circle key={s} cx={x(s)} cy={top - 8 * scale} r={3 * scale} fill="none" stroke={pcs[s] === root ? color : "#a1a1aa"} strokeWidth={1.3} />
        ) : (
          <circle key={s} cx={x(s)} cy={y(f)} r={4.5 * scale} fill={pcs[s] === root ? color : "#e4e4e7"} />
        ),
      )}
    </svg>
  );
}
