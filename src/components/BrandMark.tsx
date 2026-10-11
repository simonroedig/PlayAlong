"use client";

import { usePathname } from "next/navigation";
import { useId, useSyncExternalStore } from "react";
import { LogoMark } from "@/components/Logo";
import { playingStore } from "@/lib/activity";

/**
 * The header logo: round mark with "PLAYALONG" curving underneath. Its stripes
 * slide in on every page change and dance while music plays.
 */
export function BrandMark({ className = "" }: { className?: string }) {
  const id = useId();
  const pathname = usePathname();
  const playing = useSyncExternalStore(playingStore.subscribe, playingStore.getSnapshot, playingStore.getServerSnapshot);
  return (
    <svg viewBox="0 0 160 112" className={`brand ${className}`} role="img" aria-label="PlayAlong" data-playing={playing}>
      <defs>
        <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="rgb(255 255 255 / 0.13)" />
          <stop offset="1" stopColor="rgb(255 255 255 / 0)" />
        </radialGradient>
        <path id={`${id}-arc`} d="M 20 76 Q 80 112 140 76" fill="none" />
      </defs>
      <circle cx="80" cy="40" r="40" fill={`url(#${id}-glow)`} />
      <circle cx="80" cy="40" r="32" fill="#14141c" stroke="rgb(255 255 255 / 0.18)" strokeWidth="1.2" />
      {/* re-mounted per page so the stripes slide in again */}
      <g key={pathname} transform="translate(55.5 16) scale(1.5)">
        <LogoMark clip={`${id}-clip`} animated />
      </g>
      <text fill="#fafafa" fontSize="16" fontWeight="800" letterSpacing="3.6" style={{ fontFamily: "var(--font-sans)" }}>
        <textPath href={`#${id}-arc`} startOffset="50%" textAnchor="middle">
          PLAYALONG
        </textPath>
      </text>
    </svg>
  );
}
