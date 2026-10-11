import { useId } from "react";

/**
 * A play button cut from the stem colours, with one stripe missing: the song,
 * taken apart, waiting for your part.
 */
export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  const clip = useId();
  const stripes: [number, string][] = [
    [5.5, "#f472b6"],
    // the guitar stripe (y 10) is the missing part
    [14.5, "#22d3ee"],
    [19, "#a78bfa"],
    [23.5, "#facc15"],
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={className}>
      <rect x="0.5" y="0.5" width="31" height="31" rx="9" fill="#14141c" stroke="rgb(255 255 255 / 0.12)" />
      <defs>
        <clipPath id={clip}>
          <path d="M11 7.6c0-1.6 1.7-2.5 3-1.7l12.2 8.4c1.2.8 1.2 2.6 0 3.4L14 26.1c-1.3.8-3-.1-3-1.7Z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        {stripes.map(([y, color]) => (
          <rect key={y} x="9" y={y} width="20" height="3.2" fill={color} />
        ))}
        <rect x="9" y="10" width="20" height="3.2" fill="none" stroke="#fb923c" strokeWidth="0.9" strokeDasharray="1.6 1.2" />
      </g>
    </svg>
  );
}
