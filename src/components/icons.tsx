import type { SVGProps } from "react";

/** Video-play glyph used for YouTube links (lucide dropped brand icons). */
export function VideoLinkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <rect x="2" y="5" width="20" height="14" rx="4.5" fill="currentColor" />
      <path d="M10 9.2v5.6l4.8-2.8L10 9.2Z" fill="#07070a" />
    </svg>
  );
}
