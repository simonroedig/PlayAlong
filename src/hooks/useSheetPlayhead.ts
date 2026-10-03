"use client";

import { useRef, useState } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import type { PlayerEngine } from "@/lib/audio/engine";
import { sheetPosition, type SheetLine } from "@/lib/lyrics/sheet";

/** Current lyric line and word, re-rendering only when either changes. */
export function useSheetPlayhead(engine: PlayerEngine | null, sheet: readonly SheetLine[] | null) {
  const [position, setPosition] = useState({ line: -1, word: -1 });
  const last = useRef(position);
  useAnimationFrame(
    () => {
      if (!engine || !sheet) return;
      const next = sheetPosition(sheet, engine.currentTime());
      if (next.line !== last.current.line || next.word !== last.current.word) {
        last.current = next;
        setPosition(next);
      }
    },
    engine !== null && sheet !== null,
  );
  return position;
}
