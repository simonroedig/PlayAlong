"use client";

import { Cpu, Zap } from "lucide-react";
import { useComputeSupport } from "@/hooks/useCapabilities";

/** Header badge telling the user where separation will run. */
export function EngineBadge() {
  const support = useComputeSupport();
  if (support === "checking") return <span className="h-7 w-28" aria-hidden />;
  const gpu = support === "webgpu";
  return (
    <span
      title={
        gpu
          ? "WebGPU is available: stems are separated on your graphics card."
          : "WebGPU is not available in this browser: separation runs on the CPU and takes longer."
      }
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
        gpu ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-amber-400/20 bg-amber-400/10 text-amber-300"
      }`}
    >
      {gpu ? <Zap className="size-3.5" /> : <Cpu className="size-3.5" />}
      {gpu ? "GPU · WebGPU" : "CPU mode"}
    </span>
  );
}
