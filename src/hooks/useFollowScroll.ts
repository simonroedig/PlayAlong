"use client";

import { useCallback, useEffect, useRef } from "react";

/** How long a manual scroll pauses following the playhead. */
const USER_SCROLL_PAUSE_MS = 4000;

/**
 * Keeps the element matching `activeSelector` in the upper part of a
 * scrollable container while `follow` is on, like a teleprompter. Scrolling
 * by hand pauses it for a few seconds.
 */
export function useFollowScroll<T extends HTMLElement>(follow: boolean, activeSelector: string | null) {
  const ref = useRef<T>(null);
  const userScrollAt = useRef(0);

  useEffect(() => {
    const box = ref.current;
    if (!follow || !box || !activeSelector) return;
    if (performance.now() - userScrollAt.current < USER_SCROLL_PAUSE_MS) return;
    const el = box.querySelector<HTMLElement>(activeSelector);
    if (!el) return;
    const boxRect = box.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    // Position of the element inside the scrolled content.
    const top = elRect.top - boxRect.top + box.scrollTop;
    const view = box.clientHeight;
    const above = top < box.scrollTop + 0.08 * view;
    const below = top + elRect.height > box.scrollTop + 0.6 * view;
    if (above || below) {
      box.scrollTo({ top: Math.max(0, top - 0.25 * view), behavior: "smooth" });
    }
  }, [follow, activeSelector]);

  const onUserScroll = useCallback(() => {
    userScrollAt.current = performance.now();
  }, []);

  return { ref, onUserScroll };
}

const FOLLOW_KEY = "playalong:follow";

export function readFollowPreference(): boolean {
  try {
    return localStorage.getItem(FOLLOW_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeFollowPreference(follow: boolean) {
  try {
    localStorage.setItem(FOLLOW_KEY, follow ? "1" : "0");
  } catch {
    // storage blocked
  }
}
