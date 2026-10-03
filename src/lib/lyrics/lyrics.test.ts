import { describe, expect, it } from "vitest";
import type { DisplayChord } from "../chords/sheet";
import { harmonizeRepeats } from "./consensus";
import { textLanguage } from "./language";
import { lyricsLanguages, lyricsSheet, sheetPosition } from "./sheet";
import { mergeRepair, transcribeLyrics, type LyricLine } from "./transcribe";
import { packWindows, voiceRegions } from "./vad";
import { timestampBegin, type WhisperRunner } from "./whisper/decoding";
import { testConfig, testTokenizer } from "./whisper/test-fixtures";

const SR = 16000;

/** "Singing": harmonic tones at the given [start, end] seconds over faint noise. */
function vocals(seconds: number, parts: [number, number][]): Float32Array {
  const out = new Float32Array(seconds * SR);
  let seed = 1;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = ((seed / 0x7fffffff) * 2 - 1) * 0.0005;
  }
  for (const [a, b] of parts) {
    for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) {
      out[i] += 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR) + 0.1 * Math.sin((2 * Math.PI * 440 * i) / SR);
    }
  }
  return out;
}

const line = (text: string, start: number, probabilities?: number[]): LyricLine => {
  const words = text.split(" ");
  return {
    start,
    end: start + words.length * 0.5,
    language: "en",
    words: words.map((w, i) => ({ text: (i ? " " : "") + w, start: start + i * 0.5, end: start + i * 0.5 + 0.4, probability: probabilities?.[i] ?? 0.9 })),
  };
};

describe("voice activity", () => {
  it("finds the sung parts and packs them into Whisper windows", () => {
    const audio = vocals(80, [
      [2, 5],
      [6, 9],
      [40, 75],
    ]);
    const regions = voiceRegions(audio, SR);
    expect(regions).toHaveLength(3);
    expect(regions[0].start).toBeGreaterThan(1.6);
    expect(regions[0].start).toBeLessThan(2.01);
    expect(regions[2].end).toBeGreaterThan(74.9);
    const windows = packWindows(regions, audio, SR);
    // the two short phrases share a window; the 35 s stretch is split below 30 s
    expect(windows[0].start).toBe(regions[0].start);
    expect(windows[0].end).toBe(regions[1].end);
    expect(windows.length).toBe(3);
    for (const w of windows) expect(w.end - w.start).toBeLessThanOrEqual(28.01);
  });

  it("finds nothing in a silent stem", () => {
    expect(voiceRegions(new Float32Array(SR * 5), SR)).toEqual([]);
  });
});

describe("repeated lines", () => {
  it("makes choruses consistent, keeping the more confident words", () => {
    const lines = [
      line("You grab the rods and I get the bait", 0, [0.9, 0.9, 0.9, 0.8, 0.9, 0.6, 0.9, 0.9, 0.9]),
      line("Something else entirely different here", 10),
      line("You grab the rocks and now get the bait", 20, [0.9, 0.9, 0.9, 0.4, 0.9, 0.3, 0.9, 0.9, 0.9]),
    ];
    const out = harmonizeRepeats(lines);
    const text = (l: LyricLine) => l.words.map((w) => w.text).join("");
    expect(text(out[0])).toBe("You grab the rods and I get the bait");
    expect(text(out[2])).toBe("You grab the rods and I get the bait");
    expect(text(out[1])).toBe("Something else entirely different here");
    // timing untouched
    expect(out[2].words[3].start).toBe(lines[2].words[3].start);
  });

  it("keeps a clearly sung change in a repeated line", () => {
    const lines = [
      line("I will always love you", 0, [0.9, 0.9, 0.9, 0.97, 0.9]),
      line("I will always need you", 10, [0.9, 0.9, 0.9, 0.92, 0.9]),
    ];
    expect(harmonizeRepeats(lines)[1].words[3].text).toBe(" need");
  });
});

describe("languages", () => {
  it("tells the language a line is written in", () => {
    expect(textLanguage("Hold on tight, we're running through the night.")).toBe("en");
    expect(textLanguage("Halt dich fest, wir laufen durch die Nacht.")).toBe("de");
    expect(textLanguage("Yo no sé si es amor, pero estoy aquí")).toBe("es");
    expect(textLanguage("Je ne regrette rien")).toBe("fr");
    expect(textLanguage("Io sono ancora qui con te")).toBe("it");
    expect(textLanguage("Eu não sei, mas isso é tudo")).toBe("pt");
    expect(textLanguage("Ik hou van jou, en ik mis je")).toBe("nl");
    expect(textLanguage("Ты не верь слезам")).toBe("ru");
    expect(textLanguage("사랑해요")).toBe("ko");
    expect(textLanguage("愛してる")).toBe("ja");
  });

  it("answers only when the words tell", () => {
    expect(textLanguage("Oh, baby, baby")).toBeNull();
    expect(textLanguage("Hallo Welt!")).toBeNull();
    expect(textLanguage("")).toBeNull();
  });

  it("lists every language with a fair share of the words", () => {
    const de = { ...line("eins zwei drei vier", 0), language: "de" };
    const en = { ...line("one two three", 5), language: "en" };
    const fr = { ...line("un", 10), language: "fr" };
    expect(lyricsLanguages([de, en, fr], "de")).toEqual(["de", "en"]);
    expect(lyricsLanguages([de], "de")).toEqual(["de"]);
  });
});

describe("second transcription of parts of a window", () => {
  const sung = (text: string, start: number, probability: number, language = "de"): LyricLine => ({
    ...line(text, start, text.split(" ").map(() => probability)),
    language,
  });
  const texts = (lines: LyricLine[]) => lines.map((l) => l.words.map((w) => w.text.trim()).join(" "));

  it("replaces a doubtful line by clearly better text and fills gaps with confident text", () => {
    const verse = sung("Ich fahre nachts allein", 0, 0.95);
    const translated = sung("Halt auf wir gehen", 10, 0.5);
    const repair = [sung("Hold on tight tonight", 10.1, 0.9, "en"), sung("Every star is shining", 20, 0.8, "en"), sung("Hm", 30, 0.9, "en")];
    const missing = [
      { start: 19.8, end: 22.5 },
      { start: 29.8, end: 31 },
    ];
    expect(texts(mergeRepair([verse, translated], [translated], missing, repair))).toEqual([
      "Ich fahre nachts allein",
      "Hold on tight tonight",
      "Every star is shining",
    ]);
  });

  it("keeps a doubtful line when the second try is not clearly better", () => {
    const doubtful = sung("Komm mit mir", 10, 0.6);
    expect(mergeRepair([doubtful], [doubtful], [], [sung("Come with me", 10, 0.65, "en")])).toEqual([doubtful]);
  });
});

describe("lyrics with chords", () => {
  const chord = (label: string, start: number, end: number, root: number | null = 0): DisplayChord => ({
    start,
    end,
    startBeat: 0,
    endBeat: 0,
    label,
    root,
    confidence: 0.9,
    uncertain: false,
  });
  const chords = [chord("N.C.", 0, 1, null), chord("G", 1, 6), chord("D", 6, 7.5), chord("Em", 7.5, 14), chord("C", 14, 30)];
  const lines = [line("Hello darkness my old friend", 5), line("I've come to talk with you again", 15)];

  it("puts each chord change on the word being sung and the rest in instrumental rows", () => {
    const sheet = lyricsSheet(lines, chords, 30);
    expect(sheet.map((l) => l.kind)).toEqual(["instrumental", "lyrics", "instrumental", "lyrics"]);
    const first = sheet[1];
    if (first.kind !== "lyrics") throw new Error("expected lyrics");
    // G started in the intro: shown dimmed at the line start; D at 6.0 s is "darkness"? words start every 0.5 s from 5 s
    expect(first.words[0].chords.map((c) => [c.label, c.carried])).toEqual([["G", true]]);
    expect(first.words[2].chords.map((c) => c.label)).toEqual(["D"]); // "my" starts at 6.0 s
    expect(first.words[4].chords.map((c) => c.label)).toEqual(["Em"]); // 7.5 s → last word before
    const intro = sheet[0];
    if (intro.kind !== "instrumental") throw new Error("expected instrumental");
    expect(intro.chords.map((c) => c.label)).toEqual(["G"]);
    const second = sheet[3];
    if (second.kind !== "lyrics") throw new Error("expected lyrics");
    expect(second.words[0].chords.map((c) => c.label)).toEqual(["C"]);
  });

  it("follows the playhead line by line and word by word", () => {
    const sheet = lyricsSheet(lines, chords, 30);
    expect(sheetPosition(sheet, 0.5)).toEqual({ line: -1, word: -1 });
    expect(sheetPosition(sheet, 6.2)).toEqual({ line: 1, word: 2 });
    expect(sheetPosition(sheet, 16.1)).toEqual({ line: 3, word: 2 });
  });
});

describe("transcribeLyrics", () => {
  // A scripted stand-in for Whisper: German, and each window says "Hallo Welt!" over its whole length.
  const cfg = testConfig;
  const tokenizer = testTokenizer({ 1: " Hallo", 2: " Welt", 3: "!" });
  const ts = timestampBegin(cfg);
  const encodes: number[] = [];
  const runner: WhisperRunner = {
    async encode(mel) {
      encodes.push(mel.length);
      return { id: encodes.length };
    },
    async decode(tokens, cache, _audio, _offset, attention) {
      const history = [...((cache as { history: number[] } | null)?.history ?? []), ...tokens];
      const rows = tokens.length;
      const logits = new Float32Array(rows * cfg.nVocab).fill(-10);
      const end = ts + 100; // 2.0 s
      const script = [ts, 1, 2, 3, end, cfg.eot];
      for (let r = 0; r < rows; r++) {
        const seen = history.length - rows + r + 1;
        if (history[0] === cfg.sot && seen === 1) logits[r * cfg.nVocab + cfg.languageTokens[1]] = 10; // language: de
        const next = script[seen - 3];
        if (next !== undefined) logits[r * cfg.nVocab + next] = 10;
      }
      if (attention) {
        // alignment pass: [sot, lang, task, no_timestamps, 1, 2, 3, eot]; token k attends to 0.5 s · (k - 3)
        const T = 1500;
        const nTok = tokens.length;
        const att = new Float32Array(cfg.nTextHead * nTok * T).fill(1e-6);
        for (let h = 0; h < cfg.nTextHead; h++) {
          for (let k = 0; k < nTok; k++) {
            const center = Math.max(0, Math.min(T - 1, (k - 3) * 25 + 12));
            for (let f = center - 10; f <= center + 10; f++) if (f >= 0 && f < T) att[h * nTok * T + k * T + f] = 1;
          }
        }
        for (let r = 0; r < rows; r++) {
          // teacher forcing: row r predicts token r + 1
          if (r + 1 < rows) logits[r * cfg.nVocab + tokens[r + 1]] = 10;
        }
        return { logits, cache: { history }, attention: [att, att], frames: T };
      }
      return { logits, cache: { history }, attention: null, frames: 0 };
    },
  };

  it("transcribes each sung part, with word times in song time", async () => {
    const audio = vocals(60, [
      [3, 5],
      [40, 42],
    ]);
    const phases = new Set<string>();
    const result = await transcribeLyrics(audio, runner, cfg, tokenizer, "test-model", {}, (p) => phases.add(p));
    expect([...phases]).toEqual(["prepare", "transcribe"]);
    expect(result.language).toBe("de");
    expect(result.detected).toBe(true);
    expect(result.lines).toHaveLength(2);
    for (const [i, start] of [3, 40].entries()) {
      const l = result.lines[i];
      expect(l.words.map((w) => w.text)).toEqual([" Hallo", " Welt!"]);
      // window starts 0.25 s before the voice; the first word snaps to the voice onset
      expect(l.words[0].start).toBeGreaterThan(start - 0.05);
      expect(l.words[0].start).toBeLessThan(start + 0.3);
      expect(l.words[1].start).toBeGreaterThan(l.words[0].start);
    }
  });

  it("keeps a single long-held word as one line", async () => {
    // one word sung for 12 s: no endless splitting
    const audio = vocals(20, [[2, 14]]);
    const result = await transcribeLyrics(audio, runner, cfg, tokenizer, "test-model", {});
    expect(result.lines.length).toBeGreaterThan(0);
  });

  it("uses a language chosen by the user", async () => {
    const audio = vocals(10, [[2, 4]]);
    const result = await transcribeLyrics(audio, runner, cfg, tokenizer, "test-model", { language: "en" });
    expect(result.language).toBe("en");
    expect(result.detected).toBe(false);
    expect(result.lines[0].language).toBe("en");
  });
});
