"use client";

import { useEffect } from "react";

/** Tells the local server a PlayAlong tab is open (the desktop launcher stops it when none is). */
export function Heartbeat() {
  useEffect(() => {
    const ping = () => void fetch("/api/heartbeat", { cache: "no-store" }).catch(() => {});
    ping();
    const timer = setInterval(ping, 60_000);
    return () => clearInterval(timer);
  }, []);
  return null;
}
