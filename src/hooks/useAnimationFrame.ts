"use client";

import { useEffect, useRef } from "react";

/** Calls `callback` on every animation frame while `active`. */
export function useAnimationFrame(callback: (now: number) => void, active = true) {
  const ref = useRef(callback);
  useEffect(() => {
    ref.current = callback;
  });
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const loop = (now: number) => {
      ref.current(now);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [active]);
}
