"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/** Link to the install guide; on the home page it scrolls there directly (a same-page Link doesn't). */
export function GetItLink({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Link
      href="/#get"
      className={className}
      onClick={(e) => {
        const target = document.getElementById("get");
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        history.replaceState(null, "", "#get");
      }}
    >
      {children}
    </Link>
  );
}
