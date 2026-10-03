import { describe, expect, it } from "vitest";
import { PCM_SCALE } from "../separation/protocol";
import { BTC_BINS, BTC_FRAMES, BTC_NORM, analyzeChords, type ChordModelRunner } from "./analyze";
import { LARGE_CLASSES, LARGE_N, MAJMIN_CLASSES, MAJMIN_N, chordLabel } from "./vocabulary";

const SR = 44100;
const BEAT = 0.5; // 120 BPM
const START = 0.5;
const BARS = 16;
const PROGRESSION = [
  { root: 0, minor: false }, // C
  { root: 9, minor: true }, // Am
  { root: 5, minor: false }, // F
  { root: 7, minor: false }, // G
];

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** Adds a decaying harmonic note. */
function note(out: Float32Array, at: number, seconds: number, midi: number, amp: number, decay: number) {
  const f = midiHz(midi);
  const start = Math.round(at * SR);
  const n = Math.min(out.length - start, Math.round(seconds * SR));
  for (let h = 1; h <= 5; h++) {
    const w = (2 * Math.PI * f * h) / SR;
    const a = amp / h;
    for (let i = 0; i < n; i++) out[start + i] += a * Math.exp(-i / (decay * SR)) * Math.sin(w * i);
  }
}

function noise(out: Float32Array, at: number, seconds: number, amp: number, seed: number) {
  let x = seed;
  const start = Math.round(at * SR);
  const n = Math.min(out.length - start, Math.round(seconds * SR));
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[start + i] += amp * ((x / 0x7fffffff) * 2 - 1) * Math.exp(-i / (0.02 * SR));
  }
}

/** A 16-bar C–Am–F–G song as six stems (drums, bass, other, vocals, guitar, piano). */
function song() {
  const length = Math.round((START + BARS * 4 * BEAT + 1) * SR);
  const [drums, bass, guitar, piano] = [0, 1, 2, 3].map(() => new Float32Array(length));
  for (let bar = 0; bar < BARS; bar++) {
    const { root, minor } = PROGRESSION[bar % 4];
    const t0 = START + bar * 4 * BEAT;
    const triad = [0, minor ? 3 : 4, 7].map((i) => 48 + ((root + i) % 12));
    for (const m of triad) note(piano, t0, 4 * BEAT, m + 12, 0.05, 1.5);
    for (let b = 0; b < 4; b++) {
      const t = t0 + b * BEAT;
      note(bass, t, BEAT, 36 + root, 0.25, 0.3);
      for (const m of triad) note(guitar, t, BEAT, m, 0.06, 0.4);
      note(drums, t, 0.15, b % 2 === 0 ? 31 : 38, b % 2 === 0 ? 0.5 : 0.15, 0.05);
      if (b % 2 === 1) noise(drums, t, 0.12, 0.4, bar * 4 + b);
      noise(drums, t + BEAT / 2, 0.03, 0.1, 99 + bar * 4 + b);
    }
  }
  const pcm = (x: Float32Array | null) => {
    const out = new Int16Array(length * 2);
    if (x) for (let i = 0; i < length; i++) out[2 * i] = out[2 * i + 1] = Math.round(x[i] * PCM_SCALE);
    return out;
  };
  return { stems: [pcm(drums), pcm(bass), pcm(null), pcm(null), pcm(guitar), pcm(piano)], frames: length };
}

/** Stand-in for BTC: triad templates on the chroma of the (de-normalised) CQT. */
const templateRunner: ChordModelRunner = async (model, features) => {
  const { mean, std, classes } = BTC_NORM[model];
  const out = new Float32Array(BTC_FRAMES * classes).fill(-10);
  for (let t = 0; t < BTC_FRAMES; t++) {
    const chroma = new Float64Array(12);
    let total = 0;
    for (let b = 0; b < BTC_BINS; b += 2) {
      const mag = Math.exp(features[t * BTC_BINS + b] * std + mean);
      chroma[(b / 2) % 12] += mag;
      total += mag;
    }
    const silent = total < 0.05;
    for (let root = 0; root < 12; root++) {
      for (const minor of [false, true]) {
        const score = silent ? 0 : (chroma[root] + chroma[(root + (minor ? 3 : 4)) % 12] + chroma[(root + 7) % 12]) / total;
        const index = model === "majmin" ? 2 * root + (minor ? 1 : 0) : root * 14 + (minor ? 0 : 1);
        out[t * classes + index] = 12 * score;
      }
    }
    out[t * classes + (model === "majmin" ? MAJMIN_N : LARGE_N)] = silent ? 12 : 2;
  }
  return out;
};

describe("analyzeChords", () => {
  it("turns stems into a beat-aligned chord chart", async () => {
    const { stems, frames } = song();
    const phases = new Set<string>();
    const a = await analyzeChords(stems, frames, templateRunner, {}, (phase) => phases.add(phase));
    expect([...phases]).toEqual(["prepare", "recognise", "decode"]);
    expect(MAJMIN_CLASSES).toBe(25);
    expect(LARGE_CLASSES).toBe(170);

    expect(Math.abs(a.bpm - 120)).toBeLessThan(2);
    expect(a.beatsPerBar).toBe(4);
    expect(Math.abs(a.tuningCents)).toBeLessThan(5);
    expect(a.key).toEqual({ tonic: 0, mode: "major" });

    const chords = a.segments.filter((s) => s.root !== null);
    expect(chords.map((s) => chordLabel(s, { simple: true }))).toEqual(
      Array.from({ length: BARS }, (_, bar) => ["C", "Am", "F", "G"][bar % 4]),
    );
    // Changes land on the bar lines, and the bars line up with the downbeats.
    chords.forEach((s, bar) => {
      expect(Math.abs(s.start - (START + bar * 4 * BEAT))).toBeLessThan(0.06);
      expect((((s.startBeat - a.downbeat) % 4) + 4) % 4).toBe(0);
    });
    // Before the music starts there is no chord.
    expect(a.segments[0].root === null || a.segments[0].start >= START - 0.06).toBe(true);
  });
});
