"use client";

import { usePathname } from "next/navigation";
import { useId, useSyncExternalStore } from "react";
import { LogoMark } from "@/components/Logo";
import { activityStore, playingStore } from "@/lib/activity";

/**
 * The header wordmark: "Play" [stem-stripe play button] "Along". The words
 * slide apart on hover while the stripes ripple and the missing part fills
 * in; on every page change the stripes slide in again; they ripple slowly
 * while the device is working and dance while music plays.
 */
export function BrandMark() {
  const id = useId();
  const pathname = usePathname();
  const playing = useSyncExternalStore(playingStore.subscribe, playingStore.getSnapshot, playingStore.getServerSnapshot);
  const busy = useSyncExternalStore(activityStore.subscribe, activityStore.getSnapshot, activityStore.getServerSnapshot) !== null;
  const word = "text-[21px] leading-none font-extrabold tracking-tight text-zinc-50 transition-transform duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] sm:text-[34px]";
  return (
    <span className="brand group flex items-center gap-1 sm:gap-2" data-playing={playing} data-busy={busy && !playing}>
      <span key={`play-${pathname}`} className={`rise ${word} group-hover:-translate-x-1.5`}>
        Play
      </span>
      <svg viewBox="7 3 24 26" aria-hidden className="size-10 overflow-visible sm:size-16">
        <defs>
          <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="rgb(255 255 255 / 0.14)" />
            <stop offset="1" stopColor="rgb(255 255 255 / 0)" />
          </radialGradient>
        </defs>
        <circle cx="19" cy="16" r="15" fill={`url(#${id}-glow)`} />
        {/* re-mounted per page so the stripes slide in again */}
        <g key={pathname} className="brand-mark">
          <LogoMark clip={`${id}-clip`} animated />
        </g>
      </svg>
      <span
        key={`along-${pathname}`}
        className={`rise ${word} group-hover:translate-x-1.5`}
        style={{ "--delay": "0.12s" } as React.CSSProperties}
      >
        Along
      </span>
    </span>
  );
}
