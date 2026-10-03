import type { WhisperConfig } from "./decoding";
import { WhisperTokenizer } from "./tokenizer";

/** Shared fixtures for the Whisper / lyrics unit tests. */

export const testConfig: WhisperConfig = {
  nMels: 128,
  nTextLayer: 4,
  nTextCtx: 448,
  nTextState: 8,
  nTextHead: 4,
  nVocab: 51866,
  sot: 50258,
  eot: 50257,
  transcribe: 50360,
  translate: 50359,
  sotPrev: 50362,
  sotLm: 50361,
  noSpeech: 50363,
  noTimestamps: 50364,
  blank: 220,
  languages: ["en", "de"],
  languageTokens: [50259, 50261],
  nonSpeechTokens: [7, 8],
  alignmentHeads: [
    [2, 0],
    [3, 1],
  ],
  attentionLayers: [2, 3],
};

export const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

export function testTokenizer(words: Record<number, string>) {
  const lines = Object.entries(words).map(([id, text]) => `${b64(text)} ${id}`);
  return new WhisperTokenizer(lines.join("\n"), testConfig.eot);
}
