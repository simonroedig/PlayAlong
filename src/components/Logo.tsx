import { useId } from "react";

const STRIPES: [number, string][] = [
  [5.5, "#f472b6"],
  // the guitar stripe (y 10) is the missing part
  [14.5, "#22d3ee"],
  [19, "#a78bfa"],
  [23.5, "#facc15"],
];

/** The play triangle cut from the stem colours, one stripe missing (32 × 32 units, centred at 18, 16). */
function Mark({ clip }: { clip: string }) {
  return (
    <>
      <defs>
        <clipPath id={clip}>
          <path d="M11 7.6c0-1.6 1.7-2.5 3-1.7l12.2 8.4c1.2.8 1.2 2.6 0 3.4L14 26.1c-1.3.8-3-.1-3-1.7Z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        {STRIPES.map(([y, color]) => (
          <rect key={y} x="9" y={y} width="20" height="3.2" fill={color} />
        ))}
        <rect x="9" y="10" width="20" height="3.2" fill="none" stroke="#fb923c" strokeWidth="0.9" strokeDasharray="1.6 1.2" />
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
      <Mark clip={clip} />
    </svg>
  );
}

/** The round logo with "PlayAlong" curving underneath (the header). */
export function BrandMark({ className = "" }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 140 96" className={className} role="img" aria-label="PlayAlong">
      <defs>
        <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="rgb(255 255 255 / 0.1)" />
          <stop offset="1" stopColor="rgb(255 255 255 / 0)" />
        </radialGradient>
        <path id={`${id}-arc`} d="M 22 66 Q 70 96 118 66" fill="none" />
      </defs>
      <circle cx="70" cy="34" r="34" fill={`url(#${id}-glow)`} />
      <circle cx="70" cy="34" r="27" fill="#14141c" stroke="rgb(255 255 255 / 0.16)" />
      <g transform="translate(49.5 14.5) scale(1.25)">
        <Mark clip={`${id}-clip`} />
      </g>
      <text fill="#f4f4f5" fontSize="13" fontWeight="700" letterSpacing="3" style={{ fontFamily: "var(--font-sans)" }}>
        <textPath href={`#${id}-arc`} startOffset="50%" textAnchor="middle">
          PLAYALONG
        </textPath>
      </text>
    </svg>
  );
}
