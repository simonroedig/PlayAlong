"use client";

import { Cpu, Zap } from "lucide-react";
import { useSyncExternalStore } from "react";
import { HeaderPopover } from "@/components/HeaderPopover";
import { useComputeSupport } from "@/hooks/useCapabilities";
import { activityStore } from "@/lib/activity";

/** Where the computing happens (this device's GPU or CPU), and what it is doing right now. */
export function EngineBadge() {
  const support = useComputeSupport();
  const activity = useSyncExternalStore(activityStore.subscribe, activityStore.getSnapshot, activityStore.getServerSnapshot);
  if (support === "checking") return <span className="h-10 w-24" aria-hidden />;
  const gpu = support === "webgpu";
  const Icon = gpu ? Zap : Cpu;

  return (
    <HeaderPopover
      align="right"
      label="Where PlayAlong computes"
      ring={activity !== null}
      trigger={
        <>
          <Icon className={`size-4 ${activity ? "text-zinc-50" : gpu ? "text-zinc-100" : "text-zinc-400"}`} />
          <span className="hidden sm:inline">{activity ? `${activity} · ${gpu ? "GPU" : "CPU"}` : gpu ? "Your GPU" : "Your CPU"}</span>
          <span className="sm:hidden">{gpu ? "GPU" : "CPU"}</span>
        </>
      }
    >
      <p className="font-semibold text-zinc-50">Runs on your own computer</p>
      <p className="mt-2 leading-relaxed text-zinc-400">
        PlayAlong does the heavy lifting right here, with your {gpu ? "graphics card" : "processor"}: it splits songs into
        their instruments, finds the chords and writes out the lyrics. No server crunches your music, so it stays private
        and nobody pays for a cloud. The AI models download once and are kept for next time.
      </p>
      <p className="mt-3 flex items-start gap-2 rounded-xl bg-white/[0.04] px-3 py-2 text-xs leading-relaxed text-zinc-300">
        <Icon className="mt-0.5 size-3.5 shrink-0" />
        {gpu
          ? "This browser can use your graphics card (WebGPU), the fastest way."
          : "This browser can't use your graphics card here, so the processor does the work. It takes longer. Chrome or Edge on a recent computer use the graphics card."}
      </p>
      {activity && <p className="mt-3 text-xs text-zinc-400">Working now: {activity.toLowerCase()}.</p>}
    </HeaderPopover>
  );
}
