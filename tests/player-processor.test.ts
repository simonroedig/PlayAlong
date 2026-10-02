import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

/** Loads public/worklets/player-processor.js with a minimal AudioWorklet shim. */
function createProcessor() {
  const source = readFileSync(new URL("../public/worklets/player-processor.js", import.meta.url), "utf8");
  const messages: Record<string, unknown>[] = [];
  let Processor: new () => {
    port: { onmessage: (e: { data: unknown }) => void };
    process(inputs: unknown[], outputs: Float32Array[][]): boolean;
  };
  vm.runInNewContext(source, {
    AudioWorkletProcessor: class {
      port = { postMessage: (m: Record<string, unknown>) => messages.push(m), onmessage: null };
    },
    registerProcessor: (_name: string, cls: typeof Processor) => {
      Processor = cls;
    },
  });
  const proc = new Processor!();
  const send = (data: unknown) => proc.port.onmessage({ data });
  const render = (blocks: number) => {
    const L: number[] = [];
    const R: number[] = [];
    for (let b = 0; b < blocks; b++) {
      const out = [new Float32Array(128), new Float32Array(128)];
      proc.process([], [out]);
      L.push(...out[0]);
      R.push(...out[1]);
    }
    return { L, R };
  };
  const lastTick = () => [...messages].reverse().find((m) => m.type === "tick") as { frame: number; playing: boolean };
  return { send, render, messages, lastTick };
}

function stem(frames: number, fn: (i: number) => [number, number]) {
  const data = new Int16Array(frames * 2);
  for (let i = 0; i < frames; i++) [data[i * 2], data[i * 2 + 1]] = fn(i);
  return data;
}

describe("player worklet", () => {
  it("mixes stems with their gains", () => {
    const p = createProcessor();
    const frames = 4096;
    p.send({
      type: "load",
      frames,
      gains: [1, 0.5],
      stems: [stem(frames, () => [1000, -1000]), stem(frames, () => [2000, 2000])],
    });
    p.send({ type: "play" });
    p.render(1); // fade-in quantum
    const { L, R } = p.render(1);
    for (let i = 0; i < 128; i++) {
      expect(L[i]).toBeCloseTo(2000 / 16384, 6);
      expect(R[i]).toBeCloseTo(0, 6);
    }
  });

  it("is silent while paused and reports the position", () => {
    const p = createProcessor();
    p.send({ type: "load", frames: 8192, gains: [1], stems: [stem(8192, () => [5000, 5000])] });
    p.send({ type: "seek", frame: 3000 });
    const { L } = p.render(4);
    expect(L.every((v) => v === 0)).toBe(true);
    expect(p.lastTick().frame).toBe(3000);
  });

  it("wraps around a loop and keeps playing", () => {
    const p = createProcessor();
    const frames = 20000;
    p.send({ type: "load", frames, gains: [1], stems: [stem(frames, (i) => [i, i])] });
    p.send({ type: "loop", start: 4096, end: 8192 });
    p.send({ type: "seek", frame: 7000 });
    p.send({ type: "play" });
    const { L } = p.render(20);
    // Shortly after the seam the output tracks the loop start again.
    const seam = 8192 - 7000;
    const after = L.slice(seam + 10, seam + 20).map((v) => Math.round(v * 16384));
    expect(after).toEqual(Array.from({ length: 10 }, (_, k) => 4096 + 10 + k));
    expect(p.lastTick().playing).toBe(true);
  });

  it("stops at the end of the track", () => {
    const p = createProcessor();
    p.send({ type: "load", frames: 1000, gains: [1], stems: [stem(1000, () => [100, 100])] });
    p.send({ type: "play" });
    p.render(10);
    expect(p.messages.some((m) => m.type === "ended")).toBe(true);
    expect(p.lastTick().playing).toBe(false);
  });

  it("pauses with a short fade instead of a click", () => {
    const p = createProcessor();
    p.send({ type: "load", frames: 10000, gains: [1], stems: [stem(10000, () => [8000, 8000])] });
    p.send({ type: "play" });
    p.render(2);
    p.send({ type: "pause" });
    const { L } = p.render(2);
    expect(L[0]).toBeGreaterThan(0.45);
    expect(L[127]).toBeLessThan(0.01);
    expect(L.slice(128).every((v) => v === 0)).toBe(true);
  });

  it("slows down without changing the pitch", () => {
    const p = createProcessor();
    const frames = 44100 * 4;
    const freq = 440;
    p.send({
      type: "load",
      frames,
      gains: [1],
      stems: [stem(frames, (i) => [Math.round(8000 * Math.sin((2 * Math.PI * freq * i) / 44100)), 0])],
    });
    p.send({ type: "rate", rate: 0.5 });
    p.send({ type: "play" });
    const blocks = Math.round(44100 / 128); // one second of output
    const { L } = p.render(blocks);
    // Half a second of source material was consumed…
    expect(p.lastTick().frame).toBeGreaterThan(44100 * 0.45);
    expect(p.lastTick().frame).toBeLessThan(44100 * 0.56);
    // …while the tone stays at 440 Hz (count rising zero crossings after the fade-in).
    const body = L.slice(4096);
    let crossings = 0;
    for (let i = 1; i < body.length; i++) if (body[i - 1] < 0 && body[i] >= 0) crossings++;
    const measured = crossings / (body.length / 44100);
    expect(Math.abs(measured - freq)).toBeLessThan(6);
  });
});
