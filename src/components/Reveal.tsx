"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Fades and lifts its content in once it scrolls into (or past) view. */
export function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      // Reached when its top is in the lower part of the window, or anywhere above (a jump past it).
      if (el.getBoundingClientRect().top < window.innerHeight * 0.9) {
        setVisible(true);
        stop();
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    const stop = () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    schedule();
    return stop;
  }, []);
  return (
    <div ref={ref} className={`reveal ${className}`} data-visible={visible}>
      {children}
    </div>
  );
}
