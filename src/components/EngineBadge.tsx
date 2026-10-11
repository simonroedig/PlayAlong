"use client";

import { Cpu, Zap } from "lucide-react";
import { useComputeSupport } from "@/hooks/useCapabilities";

/** Header badge telling the user where separation will run. */
export function EngineBadge() {
  const support = useComputeSupport();
  if (support === "checking") return <span className="h-8 w-16" aria-hidden />;
  const gpu = support === "webgpu";
  return (
    <span
      title={
        gpu
          ? "WebGPU is available: stems are separated on your graphics card."
          : "WebGPU is not available in this browser: separation runs on the CPU and takes longer."
      }
      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 text-xs font-medium text-zinc-300"
    >
      {gpu ? <Zap className="size-3.5 text-zinc-100" /> : <Cpu className="size-3.5 text-zinc-400" />}
      <span className="hidden sm:inline">{gpu ? "GPU" : "CPU"}</span>
    </span>
  );
}
