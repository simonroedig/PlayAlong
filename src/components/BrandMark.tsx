"use client";

import { usePathname } from "next/navigation";
import { useId, useSyncExternalStore } from "react";
import { LogoMark } from "@/components/Logo";
import { activityStore, playingStore } from "@/lib/activity";

/**
 * The header logo: the stem-stripe play button with "PLAYALONG" curving
 * underneath. It slides in on every page change, ripples on hover (and fills
 * in the missing part), ripples slowly while the device is working and
 * dances while music plays.
 */
export function BrandMark({ className = "" }: { className?: string }) {
  const id = useId();
  const pathname = usePathname();
  const playing = useSyncExternalStore(playingStore.subscribe, playingStore.getSnapshot, playingStore.getServerSnapshot);
  const busy = useSyncExternalStore(activityStore.subscribe, activityStore.getSnapshot, activityStore.getServerSnapshot) !== null;
  return (
    <svg
      viewBox="0 0 160 116"
      className={`brand overflow-visible ${className}`}
      role="img"
      aria-label="PlayAlong"
      data-playing={playing}
      data-busy={busy && !playing}
    >
      <defs>
        <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="rgb(255 255 255 / 0.12)" />
          <stop offset="1" stopColor="rgb(255 255 255 / 0)" />
        </radialGradient>
        <path id={`${id}-arc`} d="M 4 76 Q 80 124 156 76" fill="none" />
      </defs>
      <ellipse cx="80" cy="42" rx="56" ry="44" fill={`url(#${id}-glow)`} />
      {/* re-mounted per page so the stripes slide in again */}
      <g transform="translate(29 -2) scale(2.75)">
        <g key={pathname} className="brand-mark">
          <LogoMark clip={`${id}-clip`} animated />
        </g>
      </g>
      <text fill="#fafafa" fontSize="16" fontWeight="800" letterSpacing="3.2" style={{ fontFamily: "var(--font-sans)" }}>
        <textPath href={`#${id}-arc`} startOffset="50%" textAnchor="middle">
          PLAYALONG
        </textPath>
      </text>
    </svg>
  );
}
