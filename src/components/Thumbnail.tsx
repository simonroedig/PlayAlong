"use client";

import { Music2 } from "lucide-react";
import { useEffect, useState } from "react";
import { loadThumbnail } from "@/lib/storage/library";

/** Song artwork from the library, or a gradient placeholder. */
export function Thumbnail({
  songId,
  hasThumbnail,
  className = "",
}: {
  songId: string;
  hasThumbnail: boolean;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!hasThumbnail) return;
    let url: string | null = null;
    let alive = true;
    loadThumbnail(songId).then((blob) => {
      if (!alive || !blob) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [songId, hasThumbnail]);

  return (
    <div className={`relative overflow-hidden bg-gradient-to-br from-guitar/25 via-ink-800 to-bass/25 ${className}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL
        <img src={src} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <Music2 className="absolute top-1/2 left-1/2 size-1/3 -translate-1/2 text-white/30" aria-hidden />
      )}
    </div>
  );
}
