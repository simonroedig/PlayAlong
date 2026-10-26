"use client";

import { useRef, useState } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import type { PlayerEngine } from "@/lib/audio/engine";
import { sheetPosition, type SheetLine, type SheetPosition } from "@/lib/lyrics/sheet";

/** Current lyric line and word, re-rendering only when either changes. */
export function useSheetPlayhead(engine: PlayerEngine | null, sheet: readonly SheetLine[] | null) {
  const [position, setPosition] = useState<SheetPosition>({ line: -1, word: -1, sung: -1, next: -1 });
  const last = useRef(position);
  useAnimationFrame(
    () => {
      if (!engine || !sheet) return;
      const next = sheetPosition(sheet, engine.currentTime());
      const prev = last.current;
      if (next.line !== prev.line || next.word !== prev.word || next.sung !== prev.sung || next.next !== prev.next) {
        last.current = next;
        setPosition(next);
      }
    },
    engine !== null && sheet !== null,
  );
  return position;
}
