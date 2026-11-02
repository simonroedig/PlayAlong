"use client";

import { Loader2, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Tells the local server a PlayAlong tab is open (the desktop launcher stops
 * it when none is), and offers the update when the code changed underneath
 * ("git pull"): one click rebuilds, then the page reloads with the new version.
 */
export function Heartbeat() {
  const [update, setUpdate] = useState<"none" | "ready" | "dismissed" | "updating">("none");

  useEffect(() => {
    const ping = () =>
      void fetch("/api/heartbeat", { cache: "no-store" })
        .then((r) => r.json())
        .then((data: { update?: boolean }) => setUpdate((u) => (data.update ? (u === "none" ? "ready" : u) : u === "updating" ? u : "none")))
        .catch(() => {});
    ping();
    const timer = setInterval(ping, 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (update !== "updating") return;
    // The server goes away while it rebuilds; reload once it is back with the new version.
    let wentAway = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/heartbeat?peek", { cache: "no-store" });
        const data = (await res.json()) as { update?: boolean };
        if (wentAway || !data.update) location.reload();
      } catch {
        wentAway = true;
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [update]);

  const restart = async () => {
    setUpdate("updating");
    try {
      await fetch("/api/heartbeat", { method: "POST", headers: { "x-playalong": "update" } });
    } catch {
      setUpdate("ready");
    }
  };

  if (update !== "ready" && update !== "updating") return null;
  return (
    <div role="status" className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-lg items-center gap-3 rounded-2xl border border-white/15 bg-ink-850/95 px-4 py-3 text-sm text-zinc-200 shadow-2xl backdrop-blur">
      {update === "updating" ? (
        <>
          <Loader2 className="size-4 shrink-0 animate-spin text-guitar" />
          <span className="flex-1">Updating PlayAlong. This takes a minute or two, the page reloads by itself.</span>
        </>
      ) : (
        <>
          <RefreshCw className="size-4 shrink-0 text-guitar" />
          <span className="flex-1">A new version of PlayAlong is ready.</span>
          <button type="button" onClick={restart} className="rounded-lg bg-zinc-50 px-3 py-1.5 text-xs font-semibold text-ink-950 hover:bg-white">
            Restart now
          </button>
          <button type="button" onClick={() => setUpdate("dismissed")} aria-label="Later" className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-zinc-100">
            <X className="size-4" />
          </button>
        </>
      )}
    </div>
  );
}
