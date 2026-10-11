"use client";

import { Check, Cpu, Info, Loader2, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import type { PipelineState } from "@/lib/pipeline";
import { StemProgress, type Lane } from "@/components/ui/StemProgress";
import { DISPLAY_ORDER, STEM_INFO } from "@/lib/mixer";
import { formatTime } from "@/lib/songs";

const LANES: Lane[] = DISPLAY_ORDER.map((name) => ({ color: STEM_INFO[name].color, label: STEM_INFO[name].label }));

type StepId = "download" | "decode" | "model" | "separate" | "save";
const ORDER: StepId[] = ["download", "decode", "model", "separate", "save"];

function mb(bytes: number) {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function ProcessingPanel({
  state,
  startedAt,
  isYouTube,
  notices,
  onCancel,
}: {
  state: PipelineState | null;
  startedAt: number;
  isYouTube: boolean;
  notices: string[];
  onCancel?: () => void;
}) {
  const now = useNow(1000);
  const steps = ORDER.filter((s) => s !== "download" || isYouTube);
  const current: StepId = state?.step ?? (isYouTube ? "download" : "decode");
  const currentIndex = steps.indexOf(current);

  const detail = (step: StepId): { text: string; progress: number | null } => {
    if (!state) return { text: step === "download" ? "Contacting YouTube…" : "Starting…", progress: null };
    if (state.step !== step) return { text: "", progress: null };
    switch (state.step) {
      case "download":
        if (state.phase === "server") {
          return {
            text: state.total ? `${mb(state.loaded)} of ${mb(state.total)}` : state.loaded ? mb(state.loaded) : "Contacting YouTube…",
            progress: state.total ? state.loaded / state.total : null,
          };
        }
        return { text: `Loading into the browser · ${mb(state.loaded)}`, progress: state.total ? state.loaded / state.total : null };
      case "decode":
        return { text: "Converting to 44.1 kHz stereo", progress: null };
      case "model":
        if (state.phase === "download") {
          if (state.cached) return { text: "Loaded from cache", progress: 1 };
          if (state.total) {
            return { text: `Downloading model · ${mb(state.loaded ?? 0)} of ${mb(state.total)} (one time)`, progress: (state.loaded ?? 0) / state.total };
          }
          return { text: "Fetching model…", progress: null };
        }
        if (state.phase === "runtime") return { text: `Starting ${state.backend === "webgpu" ? "WebGPU" : "CPU"} runtime`, progress: null };
        return { text: state.backend === "webgpu" ? "Preparing the GPU (first segment compiles shaders)" : "Preparing the CPU runtime", progress: null };
      case "separate": {
        const eta = state.etaMs !== null && state.done < state.total ? ` · about ${formatTime(state.etaMs / 1000)} left` : "";
        return { text: `Segment ${state.done} of ${state.total}${eta}`, progress: state.done / state.total };
      }
      case "save":
        return { text: "Writing stems to your library", progress: null };
    }
  };

  const labels: Record<StepId, string> = {
    download: "Fetch audio from YouTube",
    decode: "Decode audio",
    model: "Load the separation model",
    separate: "Separate the 6 instruments",
    save: "Save",
  };

  const backend = state?.step === "separate" ? state.backend : state?.step === "model" ? state.backend : undefined;
  const { text, progress } = detail(current);
  // The stems fill while the song is being separated; before that, light sweeps along them.
  const separation = state?.step === "separate" ? state.done / state.total : state?.step === "save" ? 1 : null;
  const blocks = state?.step === "separate" ? Math.min(48, Math.max(12, state.total)) : 32;

  return (
    <section className="overflow-hidden rounded-3xl border border-white/10 bg-ink-900/70 p-5 sm:p-7" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-50">Taking your song apart</h2>
          <p className="mt-0.5 text-sm text-zinc-400">
            {labels[current]}
            {text ? ` · ${text}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {backend && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-xs font-medium text-zinc-200">
              {backend === "webgpu" ? <Zap className="size-3.5" /> : <Cpu className="size-3.5" />}
              {backend === "webgpu" ? "Your GPU" : "Your CPU"}
            </span>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
            >
              <X className="size-4" /> Cancel
            </button>
          )}
        </div>
      </div>

      <div className="mt-6">
        <StemProgress lanes={LANES} fraction={separation} blocks={blocks} />
      </div>

      <ol className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs">
        {steps.map((step, i) => {
          const status = i < currentIndex ? "done" : i === currentIndex ? "active" : "pending";
          return (
            <li key={step} className="flex items-center gap-2">
              {i > 0 && <span className={`h-px w-4 ${i <= currentIndex ? "bg-white/30" : "bg-white/10"}`} aria-hidden />}
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${
                  status === "done"
                    ? "bg-emerald-400/10 text-emerald-300"
                    : status === "active"
                      ? "bg-white/10 text-zinc-50"
                      : "text-zinc-500"
                }`}
              >
                {status === "done" ? <Check className="size-3" /> : status === "active" ? <Loader2 className="size-3 animate-spin" /> : null}
                {labels[step]}
                {status === "active" && progress !== null && step !== "separate" ? ` ${Math.round(progress * 100)} %` : ""}
              </span>
            </li>
          );
        })}
      </ol>

      {notices.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {notices.map((n, i) => (
            <li key={i} className="flex items-start gap-2 rounded-xl bg-amber-400/[0.07] px-3 py-2 text-xs text-amber-200">
              <Info className="mt-0.5 size-3.5 shrink-0" /> {n}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 grid gap-3 border-t border-white/5 pt-5 text-xs leading-relaxed text-zinc-400 sm:grid-cols-2">
        <p>
          <span className="font-medium text-zinc-200">Keep this page open.</span> Switching to other tabs or apps is fine, but
          closing it or going to another page stops the work, and it starts over next time.
        </p>
        <p>
          Elapsed {formatTime((now - startedAt) / 1000)}. Everything runs right here on your{" "}
          {backend && backend !== "webgpu" ? "processor" : "computer"}; with a graphics card (WebGPU) it is usually faster than the song
          itself. Finished songs open instantly next time.
        </p>
      </div>
    </section>
  );
}
