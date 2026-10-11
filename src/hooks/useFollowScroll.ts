"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** How long a manual scroll pauses following the playhead. */
const USER_SCROLL_PAUSE_MS = 4000;

/**
 * Keeps the element matching `activeSelector` in the upper part of a
 * scrollable container while `follow` is on, like a teleprompter. Scrolling
 * by hand pauses it for a few seconds; `away` says the current element is out
 * of view, and `recenter` brings it back (and resumes following).
 */
export function useFollowScroll<T extends HTMLElement>(follow: boolean, activeSelector: string | null) {
  const ref = useRef<T>(null);
  const userScrollAt = useRef(0);
  const selector = useRef(activeSelector);
  const [away, setAway] = useState(false);

  const place = useCallback((force: boolean) => {
    const box = ref.current;
    if (!box || !selector.current) return;
    const el = box.querySelector<HTMLElement>(selector.current);
    if (!el) return;
    const boxRect = box.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    // Position of the element inside the scrolled content.
    const top = elRect.top - boxRect.top + box.scrollTop;
    const view = box.clientHeight;
    const above = top < box.scrollTop + 0.08 * view;
    const below = top + elRect.height > box.scrollTop + 0.6 * view;
    if (force || above || below) box.scrollTo({ top: Math.max(0, top - 0.25 * view), behavior: "smooth" });
  }, []);

  const checkAway = useCallback(() => {
    const box = ref.current;
    const el = box && selector.current ? box.querySelector<HTMLElement>(selector.current) : null;
    if (!box || !el) return setAway(false);
    const b = box.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    setAway(e.bottom < b.top + 8 || e.top > b.bottom - 8);
  }, []);

  useEffect(() => {
    selector.current = activeSelector;
    if (!follow || !activeSelector) return;
    if (performance.now() - userScrollAt.current < USER_SCROLL_PAUSE_MS) return;
    place(false);
  }, [follow, activeSelector, place]);

  // Without following (or while paused) the current line moves out of view on its own.
  useEffect(() => {
    if (!follow || performance.now() - userScrollAt.current < USER_SCROLL_PAUSE_MS) checkAway();
  }, [activeSelector, follow, checkAway]);

  const onUserScroll = useCallback(() => {
    userScrollAt.current = performance.now();
  }, []);

  const recenter = useCallback(() => {
    userScrollAt.current = 0;
    place(true);
    setAway(false);
  }, [place]);

  return { ref, onUserScroll, onScroll: checkAway, away, recenter };
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
