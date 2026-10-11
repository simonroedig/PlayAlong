"use client";

import { useEffect, useSyncExternalStore } from "react";
import { activityStore } from "@/lib/activity";

/**
 * While this device is separating a song or writing chords or lyrics, leaving
 * the page would stop it (it starts over next time): ask first, both when
 * closing or reloading the tab and when following a link inside PlayAlong.
 */
export function LeaveGuard() {
  const activity = useSyncExternalStore(activityStore.subscribe, activityStore.getSnapshot, activityStore.getServerSnapshot);

  useEffect(() => {
    if (!activity) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.origin !== location.origin) return;
      if (link.pathname === location.pathname) return;
      const ok = confirm(
        `PlayAlong is still working on this song (${activity.toLowerCase()}). Leaving this page stops it, and it starts over next time. Leave anyway?`,
      );
      if (!ok) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("click", onClick, true);
    };
  }, [activity]);

  return null;
}
