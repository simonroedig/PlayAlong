"use client";

import { Check, Cpu, Info, Loader2, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import type { PipelineState } from "@/lib/pipeline";
import { formatTime } from "@/lib/songs";

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
    separate: "Separate into 6 stems",
    save: "Save",
  };

  const backend = state?.step === "separate" ? state.backend : state?.step === "model" ? state.backend : undefined;

  return (
    <section className="rounded-3xl border border-white/10 bg-ink-900/70 p-5 sm:p-7" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Preparing your play-along track</h2>
          <p className="text-sm text-zinc-500">
            Elapsed {formatTime((now - startedAt) / 1000)} · everything runs in this tab, so keep it open.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {backend && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                backend === "webgpu" ? "bg-white/10 text-zinc-100" : "bg-white/5 text-zinc-300"
              }`}
            >
              {backend === "webgpu" ? <Zap className="size-3.5" /> : <Cpu className="size-3.5" />}
              {backend === "webgpu" ? "WebGPU" : "CPU"}
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

      <ol className="mt-6 space-y-2">
        {steps.map((step, i) => {
          const status = i < currentIndex ? "done" : i === currentIndex ? "active" : "pending";
          const { text, progress } = detail(step);
          return (
            <li
              key={step}
              className={`rounded-2xl border px-4 py-3 transition ${
                status === "active" ? "border-white/10 bg-white/[0.04]" : "border-transparent"
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`grid size-6 shrink-0 place-items-center rounded-full text-xs ${
                    status === "done"
                      ? "bg-emerald-400/15 text-emerald-300"
                      : status === "active"
                        ? "bg-white/10 text-zinc-50"
                        : "bg-white/5 text-zinc-600"
                  }`}
                >
                  {status === "done" ? (
                    <Check className="size-3.5" />
                  ) : status === "active" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span className={`text-sm font-medium ${status === "pending" ? "text-zinc-500" : "text-zinc-200"}`}>
                  {labels[step]}
                </span>
                {status === "active" && text && <span className="ml-auto truncate text-xs text-zinc-400">{text}</span>}
              </div>
              {status === "active" && (
                <div className="mt-3 ml-9 h-1.5 overflow-hidden rounded-full bg-white/5">
                  {progress === null ? (
                    <div className="h-full w-1/3 animate-pulse-soft rounded-full bg-zinc-300/60" />
                  ) : (
                    <div
                      className="h-full rounded-full bg-zinc-100 transition-[width] duration-300"
                      style={{ width: `${Math.max(2, Math.min(100, progress * 100))}%` }}
                    />
                  )}
                </div>
              )}
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

      <p className="mt-5 text-xs leading-relaxed text-zinc-500">
        The song is split with Demucs v4 (6 stems) in 7.8-second segments. With WebGPU this typically runs faster than
        real time; on the CPU expect roughly the length of the song or more. Finished songs are stored in your browser
        and open instantly next time.
      </p>
    </section>
  );
}
