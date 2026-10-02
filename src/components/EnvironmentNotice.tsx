"use client";

import { TriangleAlert } from "lucide-react";
import { useSyncExternalStore } from "react";

type Problem = "insecure" | "not-isolated" | null;

const subscribe = () => () => {};

function detect(): Problem {
  if (!window.isSecureContext) return "insecure";
  if (!window.crossOriginIsolated) return "not-isolated";
  return null;
}

/**
 * Explains degraded modes: AudioWorklet, WebGPU and Web Crypto need a secure
 * origin (https or localhost); multi-threading needs cross-origin isolation.
 */
export function EnvironmentNotice() {
  const problem = useSyncExternalStore(subscribe, detect, () => null);
  if (!problem) return null;
  return (
    <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-400/20 bg-amber-400/[0.07] px-4 py-3 text-sm text-amber-100">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
      {problem === "insecure" ? (
        <p>
          This page is served over plain HTTP from a network address, so the browser disables audio playback and GPU
          acceleration. Open it via <code className="font-mono">http://localhost:3000</code> on the same machine, or serve
          it over HTTPS.
        </p>
      ) : (
        <p>
          Cross-origin isolation is off (the COOP/COEP headers from next.config.ts are missing), so CPU separation runs
          single-threaded. Check any proxy in front of the app.
        </p>
      )}
    </div>
  );
}
