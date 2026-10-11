import { useId, type CSSProperties } from "react";

const STRIPES: { y: number; color: string; to: number; beat: string }[] = [
  { y: 5.5, color: "#f472b6", to: 0.55, beat: "0.46s" },
  // the guitar stripe (y 10) is the missing part
  { y: 14.5, color: "#22d3ee", to: 0.4, beat: "0.69s" },
  { y: 19, color: "#a78bfa", to: 0.7, beat: "0.92s" },
  { y: 23.5, color: "#facc15", to: 0.35, beat: "0.23s" },
];

/** The play triangle cut from the stem colours, one stripe missing (32 × 32 units). */
export function LogoMark({ clip, animated = false }: { clip: string; animated?: boolean }) {
  return (
    <>
      <defs>
        <clipPath id={clip}>
          <path d="M11 7.6c0-1.6 1.7-2.5 3-1.7l12.2 8.4c1.2.8 1.2 2.6 0 3.4L14 26.1c-1.3.8-3-.1-3-1.7Z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        {STRIPES.map((s, i) => (
          <rect
            key={s.y}
            x="9"
            y={s.y}
            width="20"
            height="3.2"
            fill={s.color}
            className={animated ? "brand-stripe" : undefined}
            style={animated ? ({ "--delay": `${i * 0.08}s`, "--to": s.to, "--beat": s.beat } as CSSProperties) : undefined}
          />
        ))}
        {animated && <rect x="9" y="10" width="20" height="3.2" fill="#fb923c" className="brand-fill" />}
        <rect
          x="9"
          y="10"
          width="20"
          height="3.2"
          fill="none"
          stroke="#fb923c"
          strokeWidth="0.9"
          strokeDasharray="1.6 1.2"
          className={animated ? "brand-missing" : undefined}
        />
      </g>
    </>
  );
}

/**
 * A play button cut from the stem colours, with one stripe missing: the song,
 * taken apart, waiting for your part.
 */
export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  const clip = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={className}>
      <rect x="0.5" y="0.5" width="31" height="31" rx="9" fill="#14141c" stroke="rgb(255 255 255 / 0.12)" />
      <LogoMark clip={clip} />
    </svg>
  );
}
