import { SAMPLE_RATE } from "../separation/model";

export interface LoopRegion {
  /** Seconds. */
  start: number;
  end: number;
}

export interface PlayerSnapshot {
  loaded: boolean;
  playing: boolean;
  duration: number;
  rate: number;
  loop: LoopRegion | null;
}

type TickMessage = { type: "tick"; frame: number; playing: boolean; peaks: number[] } | { type: "ended" };

/**
 * Main-thread handle on the AudioWorklet player (public/worklets/player-processor.js).
 *
 * React subscribes to coarse state via `subscribe` / `getSnapshot`
 * (useSyncExternalStore); the playhead and level meters are read every
 * animation frame through `currentTime()` / `peaks` instead of re-rendering.
 */
export class PlayerEngine {
  readonly ctx: AudioContext;
  private readonly node: AudioWorkletNode;
  private readonly listeners = new Set<() => void>();
  private snapshot: PlayerSnapshot = { loaded: false, playing: false, duration: 0, rate: 1, loop: null };
  private lastFrame = 0;
  private lastFrameAt = 0;
  /** When play/pause was last requested; ticks sent before the worklet saw it are stale. */
  private commandAt = 0;
  private frames = 0;
  /** Latest pre-fader peak level per stem (linear). */
  peaks: number[] = [];
  /** The loaded stems (interleaved stereo int16). */
  stems: Int16Array[] | null = null;

  private constructor(ctx: AudioContext, node: AudioWorkletNode) {
    this.ctx = ctx;
    this.node = node;
    node.port.onmessage = (event: MessageEvent<TickMessage>) => this.onMessage(event.data);
  }

  static async create(): Promise<PlayerEngine> {
    // Running the context at the stems' rate leaves resampling to the browser.
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
    await ctx.audioWorklet.addModule("/worklets/player-processor.js");
    const node = new AudioWorkletNode(ctx, "playalong-player", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    node.connect(ctx.destination);
    return new PlayerEngine(ctx, node);
  }

  private onMessage(msg: TickMessage) {
    if (msg.type === "ended") {
      this.lastFrame = this.frames;
      this.update({ playing: false });
      return;
    }
    this.lastFrame = msg.frame;
    this.lastFrameAt = performance.now();
    this.peaks = msg.peaks;
    const settled = performance.now() - this.commandAt > 150;
    if (settled && msg.playing !== this.snapshot.playing) this.update({ playing: msg.playing });
  }

  private update(patch: Partial<PlayerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  /**
   * Hands the stems to the worklet. Stems backed by SharedArrayBuffer (the
   * normal case on this cross-origin isolated site) are shared with the audio
   * thread; plain buffers are copied.
   */
  load(stems: Int16Array[], frames: number, gains: number[]) {
    this.stems = stems;
    this.frames = frames;
    this.lastFrame = 0;
    this.node.port.postMessage({ type: "load", stems, frames, gains });
    this.update({ loaded: true, playing: false, duration: frames / SAMPLE_RATE, loop: null });
  }

  async play() {
    if (this.ctx.state !== "running") await this.ctx.resume();
    if (this.lastFrame >= this.frames) this.lastFrame = 0;
    this.lastFrameAt = performance.now();
    this.commandAt = performance.now();
    this.node.port.postMessage({ type: "play" });
    this.update({ playing: true });
  }

  pause() {
    this.commandAt = performance.now();
    this.node.port.postMessage({ type: "pause" });
    this.update({ playing: false });
  }

  toggle() {
    if (this.snapshot.playing) this.pause();
    else void this.play();
  }

  seek(seconds: number) {
    const frame = Math.max(0, Math.min(this.frames, Math.round(seconds * SAMPLE_RATE)));
    this.lastFrame = frame;
    this.lastFrameAt = performance.now();
    this.node.port.postMessage({ type: "seek", frame });
  }

  skip(deltaSeconds: number) {
    this.seek(this.currentTime() + deltaSeconds);
  }

  setGains(gains: number[]) {
    this.node.port.postMessage({ type: "gains", gains });
  }

  setLoop(loop: LoopRegion | null) {
    this.node.port.postMessage({
      type: "loop",
      start: loop ? Math.round(loop.start * SAMPLE_RATE) : null,
      end: loop ? Math.round(loop.end * SAMPLE_RATE) : null,
    });
    this.update({ loop });
  }

  setRate(rate: number) {
    this.node.port.postMessage({ type: "rate", rate });
    this.update({ rate });
  }

  /** Playhead in seconds, extrapolated between worklet reports for smooth drawing. */
  currentTime(): number {
    let frame = this.lastFrame;
    if (this.snapshot.playing && this.lastFrameAt > 0) {
      const elapsed = Math.min(0.05, (performance.now() - this.lastFrameAt) / 1000);
      frame += elapsed * SAMPLE_RATE * this.snapshot.rate;
    }
    return Math.min(this.frames, frame) / SAMPLE_RATE;
  }

  async dispose() {
    this.listeners.clear();
    this.node.port.postMessage({ type: "unload" });
    this.node.disconnect();
    await this.ctx.close().catch(() => {});
  }
}
