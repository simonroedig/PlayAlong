"use client";

import { useEffect, useState } from "react";
import type { HealthInfo } from "@/lib/youtube-types";

export type ComputeSupport = "checking" | "webgpu" | "cpu";

let gpuProbe: Promise<boolean> | null = null;

function probeWebGpu(): Promise<boolean> {
  gpuProbe ??= (async () => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return false;
    try {
      return (await gpu.requestAdapter()) !== null;
    } catch {
      return false;
    }
  })();
  return gpuProbe;
}

/** Whether separation can use the GPU (WebGPU) or will run on the CPU. */
export function useComputeSupport(): ComputeSupport {
  const [support, setSupport] = useState<ComputeSupport>("checking");
  useEffect(() => {
    let alive = true;
    probeWebGpu().then((ok) => alive && setSupport(ok ? "webgpu" : "cpu"));
    return () => {
      alive = false;
    };
  }, []);
  return support;
}

/** Server capabilities (is yt-dlp installed?). Null while loading or if the server is unreachable. */
export function useHealth(): HealthInfo | null {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((h) => setHealth(h))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return health;
}
