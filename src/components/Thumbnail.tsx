"use client";

import { Music2 } from "lucide-react";
import { useEffect, useState } from "react";
import { loadThumbnail } from "@/lib/storage/library";

/** Song artwork from the library (or another source), or a placeholder. */
export function Thumbnail({
  songId,
  hasThumbnail,
  className = "",
  load = loadThumbnail,
}: {
  songId: string;
  hasThumbnail: boolean;
  className?: string;
  load?: (id: string) => Promise<Blob | null | undefined>;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!hasThumbnail) return;
    let url: string | null = null;
    let alive = true;
    load(songId).then((blob) => {
      if (!alive || !blob) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [songId, hasThumbnail, load]);

  return (
    <div className={`relative overflow-hidden bg-ink-800 ${className}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL
        <img src={src} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <>
          <span className="stem-rule absolute inset-x-[18%] bottom-[22%] h-[6%] opacity-70" aria-hidden>
            {["#f472b6", "#fb923c", "#22d3ee", "#a78bfa", "#facc15", "#4ade80"].map((c) => (
              <span key={c} style={{ background: c }} />
            ))}
          </span>
          <Music2 className="absolute top-[42%] left-1/2 size-1/4 -translate-1/2 text-white/25" aria-hidden />
        </>
      )}
    </div>
  );
}
