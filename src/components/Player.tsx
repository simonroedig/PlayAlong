"use client";

import { Download, Keyboard, Loader2, Zap, Cpu } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChordLane } from "@/components/player/ChordLane";
import { ChordPanel } from "@/components/player/ChordPanel";
import { Mixer } from "@/components/player/Mixer";
import { PresetBar } from "@/components/player/PresetBar";
import { Transport } from "@/components/player/Transport";
import { Waveform } from "@/components/player/Waveform";
import { useChords } from "@/hooks/useChords";
import { useLyrics } from "@/hooks/useLyrics";
import { PlayerEngine, type LoopRegion, type PlayerSnapshot } from "@/lib/audio/engine";
import { mixToWav } from "@/lib/audio/wav";
import { stemEnvelopes } from "@/lib/audio/waveform";
import { DEFAULT_CHORD_VIEW, displayChords, type ChordView } from "@/lib/chords/sheet";
import {
  applyPreset,
  defaultMixer,
  effectiveGains,
  matchPreset,
  normalizeMixer,
  PRESETS,
  STEM_INFO,
  stemIndex,
  type MixerSettings,
  type PresetId,
} from "@/lib/mixer";
import { MODEL_LABEL, SAMPLE_RATE, SOURCES } from "@/lib/separation/model";
import { formatTime } from "@/lib/songs";
import { loadStems, updateSong, type SongRecord } from "@/lib/storage/library";

const PRESET_KEY = "playalong:preset";
const SIMPLE_CHORDS_KEY = "playalong:simple-chords";
const idleSnapshot: PlayerSnapshot = { loaded: false, playing: false, duration: 0, rate: 1, loop: null };
const noopSubscribe = () => () => {};

function preferredPreset(): PresetId {
  try {
    const stored = localStorage.getItem(PRESET_KEY) as PresetId | null;
    if (stored && PRESETS.some((p) => p.id === stored)) return stored;
  } catch {
    // storage blocked
  }
  return "no-guitar";
}

function initialChordView(song: SongRecord): ChordView {
  let simple = DEFAULT_CHORD_VIEW.simple;
  try {
    simple = localStorage.getItem(SIMPLE_CHORDS_KEY) === "1";
  } catch {
    // storage blocked
  }
  return { ...DEFAULT_CHORD_VIEW, ...song.chordView, simple };
}

function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]+/g, "_");
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable || (tag === "INPUT" && (el as HTMLInputElement).type !== "range");
}

export function Player({ song, stems }: { song: SongRecord; stems: Int16Array[] }) {
  const frames = song.frames ?? Math.floor(stems[0].length / 2);
  const duration = frames / SAMPLE_RATE;
  const envelopes = useMemo(() => stemEnvelopes(stems, frames), [stems, frames]);

  const [engine, setEngine] = useState<PlayerEngine | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [mixer, setMixer] = useState<MixerSettings>(() =>
    song.mixer ? normalizeMixer(song.mixer) : applyPreset(defaultMixer(), preferredPreset()),
  );
  const [loop, setLoop] = useState<LoopRegion | null>(null);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [rate, setRate] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [chordView, setChordView] = useState<ChordView>(() => initialChordView(song));
  const { state: chordState, reanalyze } = useChords(song, stems, frames);
  // Lyrics wait for the chords, so the two analyses don't compete for the CPU.
  const lyrics = useLyrics(song, stems, frames, chordState.status !== "running");
  const chords = useMemo(
    () => (chordState.status === "ready" ? displayChords(chordState.analysis, chordView) : null),
    [chordState, chordView],
  );

  const gains = useMemo(() => effectiveGains(mixer), [mixer]);
  const preset = matchPreset(mixer);
  const gainsRef = useRef(gains);
  useEffect(() => {
    gainsRef.current = gains;
  });

  // Audio engine lifetime follows the stems.
  useEffect(() => {
    let cancelled = false;
    let instance: PlayerEngine | null = null;
    PlayerEngine.create()
      .then((e) => {
        if (cancelled) return void e.dispose();
        instance = e;
        e.load(stems, frames, gainsRef.current);
        setEngine(e);
      })
      .catch((err: unknown) => !cancelled && setEngineError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
      if (instance) void instance.dispose();
      setEngine(null);
    };
  }, [stems, frames]);

  const snapshot = useSyncExternalStore(
    engine ? engine.subscribe : noopSubscribe,
    engine ? engine.getSnapshot : () => idleSnapshot,
    () => idleSnapshot,
  );

  useEffect(() => engine?.setGains(gains), [engine, gains]);
  useEffect(() => engine?.setLoop(loop && loopEnabled ? loop : null), [engine, loop, loopEnabled]);
  useEffect(() => engine?.setRate(rate), [engine, rate]);

  // Remember the mix per song, and the practice mode across songs.
  useEffect(() => {
    const t = setTimeout(() => {
      void updateSong(song.id, { mixer });
      const p = matchPreset(mixer);
      if (p) {
        try {
          localStorage.setItem(PRESET_KEY, p);
        } catch {
          // ignore
        }
      }
    }, 400);
    return () => clearTimeout(t);
  }, [mixer, song.id]);

  const changeChordView = useCallback(
    (view: ChordView) => {
      setChordView(view);
      void updateSong(song.id, { chordView: { capo: view.capo, tuneDown: view.tuneDown } });
      try {
        localStorage.setItem(SIMPLE_CHORDS_KEY, view.simple ? "1" : "0");
      } catch {
        // ignore
      }
    },
    [song.id],
  );

  const loopRegion = useCallback(
    (region: LoopRegion) => {
      setLoop(region);
      setLoopEnabled(true);
      engine?.seek(region.start);
    },
    [engine],
  );
  const seek = useCallback((t: number) => engine?.seek(t), [engine]);

  const selectPreset = useCallback((id: PresetId) => setMixer((m) => applyPreset(m, id)), []);
  const toggleMute = useCallback(
    (index: number) =>
      setMixer((m) => {
        const muted = [...m.muted];
        muted[index] = !muted[index];
        return { ...m, muted, solo: m.solo.map(() => false) };
      }),
    [],
  );

  const toggleLoop = useCallback(() => {
    if (!loop) {
      const t = engine?.currentTime() ?? 0;
      const start = Math.max(0, Math.min(t, duration - 1));
      setLoop({ start, end: Math.min(duration, start + 8) });
      setLoopEnabled(true);
    } else {
      setLoopEnabled((v) => !v);
    }
  }, [loop, engine, duration]);

  const setLoopEdge = useCallback(
    (edge: "start" | "end") => {
      const t = engine?.currentTime() ?? 0;
      setLoop((current) => {
        const start = edge === "start" ? t : (current?.start ?? 0);
        const end = edge === "end" ? t : (current?.end ?? duration);
        return end - start >= 0.5 ? { start, end } : current;
      });
      setLoopEnabled(true);
    },
    [engine, duration],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const handled = (() => {
        switch (e.key) {
          case " ":
            engine?.toggle();
            return true;
          case "ArrowLeft":
            engine?.skip(e.shiftKey ? -1 : -5);
            return true;
          case "ArrowRight":
            engine?.skip(e.shiftKey ? 1 : 5);
            return true;
          case "Home":
            engine?.seek(loop && loopEnabled ? loop.start : 0);
            return true;
          case "l":
          case "L":
            toggleLoop();
            return true;
          case "[":
            setLoopEdge("start");
            return true;
          case "]":
            setLoopEdge("end");
            return true;
          case "g":
          case "G":
            toggleMute(stemIndex("guitar"));
            return true;
          case "b":
          case "B":
            toggleMute(stemIndex("bass"));
            return true;
          case "-":
            setRate((r) => Math.max(0.5, Math.round((r - 0.05) * 100) / 100));
            return true;
          case "=":
          case "+":
            setRate((r) => Math.min(1.25, Math.round((r + 0.05) * 100) / 100));
            return true;
          default: {
            const n = Number(e.key);
            if (Number.isInteger(n) && n >= 1 && n <= PRESETS.length) {
              selectPreset(PRESETS[n - 1].id);
              return true;
            }
            return false;
          }
        }
      })();
      if (handled) e.preventDefault();
    };
    // Space would also "click" the focused button on key-up.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " && !isTyping(e.target)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [engine, loop, loopEnabled, toggleLoop, setLoopEdge, toggleMute, selectPreset]);

  const download = async (which: "mix" | number) => {
    setExporting(true);
    try {
      await new Promise((r) => setTimeout(r, 20));
      const data = engine?.stems ?? (await loadStems(song.id, SOURCES.length));
      if (which === "mix") {
        const label = PRESETS.find((p) => p.id === preset)?.label.toLowerCase() ?? "custom mix";
        saveFile(mixToWav(data, gains, frames, SAMPLE_RATE), `${song.title} (${label}).wav`);
      } else {
        const solo = SOURCES.map((_, i) => (i === which ? 1 : 0));
        saveFile(mixToWav(data, solo, frames, SAMPLE_RATE), `${song.title} (${STEM_INFO[SOURCES[which]].label.toLowerCase()}).wav`);
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <PresetBar active={preset} onSelect={selectPreset} />

      <section className="rounded-3xl border border-white/10 bg-ink-900/70 p-4 sm:p-5">
        <Waveform
          engine={engine}
          envelopes={envelopes}
          gains={gains}
          duration={duration}
          loop={loop}
          loopEnabled={loopEnabled}
          onSeek={seek}
          onLoopChange={loopRegion}
        />
        {chordState.status === "ready" && chords && (
          <ChordLane engine={engine} analysis={chordState.analysis} chords={chords} duration={duration} onSeek={seek} />
        )}
        <div className="mt-4">
          <Transport
            engine={engine}
            playing={snapshot.playing}
            duration={duration}
            loop={loop}
            loopEnabled={loopEnabled}
            onToggleLoop={toggleLoop}
            onClearLoop={() => {
              setLoop(null);
              setLoopEnabled(false);
            }}
            rate={rate}
            onRate={setRate}
            master={mixer.master}
            onMaster={(master) => setMixer((m) => ({ ...m, master }))}
          />
        </div>
        {engineError && (
          <p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300">Audio output failed: {engineError}</p>
        )}
      </section>

      <ChordPanel
        engine={engine}
        state={chordState}
        chords={chords}
        duration={duration}
        view={chordView}
        onViewChange={changeChordView}
        loop={loop && loopEnabled ? loop : null}
        onSeek={seek}
        onLoop={loopRegion}
        onReanalyze={reanalyze}
        lyrics={lyrics.state}
        lyricsAuto={lyrics.auto}
        onLyricsAuto={lyrics.setAuto}
        onTranscribe={lyrics.transcribe}
      />

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-zinc-200">
            Stems <span className="font-normal text-zinc-500">· mute, solo or rebalance each instrument</span>
          </h2>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowKeys((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
              aria-expanded={showKeys}
            >
              <Keyboard className="size-4" /> Shortcuts
            </button>
            <button
              type="button"
              onClick={() => download("mix")}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/5 px-3 py-1.5 text-sm font-medium text-zinc-200 transition hover:bg-white/10 disabled:opacity-50"
              title="Download what you hear (current mix, original tempo) as a WAV file"
            >
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Export mix
            </button>
          </div>
        </div>

        {showKeys && (
          <dl className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-2xl border border-white/5 bg-white/[0.02] p-4 text-xs text-zinc-400 sm:grid-cols-4">
            {[
              ["Space", "Play / pause"],
              ["← / →", "Skip 5 s (Shift: 1 s)"],
              ["Home", "Back to start / loop start"],
              ["1 – 5", "Practice modes"],
              ["G / B", "Mute guitar / bass"],
              ["L", "Loop on / off"],
              ["[ / ]", "Set loop start / end"],
              ["− / +", "Slower / faster"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <dt className="min-w-12 rounded-md bg-white/5 px-1.5 py-0.5 text-center font-mono text-zinc-200">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}

        <Mixer engine={engine} mixer={mixer} gains={gains} onChange={setMixer} onDownloadStem={(i) => download(i)} />
      </section>

      {song.separation && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
          {song.separation.backend === "webgpu" ? <Zap className="size-3.5" /> : <Cpu className="size-3.5" />}
          Separated in {formatTime(song.separation.seconds)} on {song.separation.backend === "webgpu" ? "the GPU (WebGPU)" : "the CPU"} with{" "}
          {MODEL_LABEL}. Tip: drag across the waveform to loop a passage, and use the turtle slider to slow it down without
          changing the pitch.
        </p>
      )}
    </div>
  );
}
