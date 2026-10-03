import type { WhisperConfig } from "./whisper/decoding";

/**
 * The lyrics model: OpenAI Whisper large-v3 turbo (MIT), int8 ONNX export by
 * sherpa-onnx, installed by scripts/setup.mjs into public/models/whisper-turbo/
 * together with a manifest (model.json).
 */
export const LYRICS_MODEL_BASE = process.env.NEXT_PUBLIC_LYRICS_MODEL_URL || "/models/whisper-turbo/";
export const LYRICS_MODEL_LABEL = "Whisper large-v3 turbo";

export interface LyricsModelManifest {
  name: string;
  files: { encoder: string; decoder: string; tokens: string };
  bytes: { encoder: number; decoder: number; tokens: number };
  sha256: { encoder: string; decoder: string; tokens: string };
  /** Encoder metadata written by the sherpa-onnx export. */
  metadata: Record<string, string>;
  alignmentHeads: [number, number][];
  attentionLayers: number[];
  attentionOutputs: string[];
}

export function whisperConfig(manifest: LyricsModelManifest): WhisperConfig {
  const m = manifest.metadata;
  const num = (key: string) => {
    const v = Number(m[key]);
    if (!Number.isFinite(v)) throw new Error(`Lyrics model metadata lacks ${key}`);
    return v;
  };
  const list = (key: string) => (m[key] ?? "").split(",").filter(Boolean);
  return {
    nMels: num("n_mels"),
    nTextLayer: num("n_text_layer"),
    nTextCtx: num("n_text_ctx"),
    nTextState: num("n_text_state"),
    nTextHead: num("n_text_head"),
    nVocab: num("n_vocab"),
    sot: num("sot"),
    eot: num("eot"),
    transcribe: num("transcribe"),
    translate: num("translate"),
    sotPrev: num("sot_prev"),
    sotLm: num("sot_lm"),
    noSpeech: num("no_speech"),
    noTimestamps: num("no_timestamps"),
    blank: num("blank_id"),
    languages: list("all_language_codes"),
    languageTokens: list("all_language_tokens").map(Number),
    nonSpeechTokens: list("non_speech_tokens").map(Number),
    alignmentHeads: manifest.alignmentHeads,
    attentionLayers: manifest.attentionLayers,
  };
}

/** Languages offered in the picker (Whisper knows ~100; these cover most songs). */
export const LYRICS_LANGUAGES: { code: string; name: string }[] = [
  { code: "en", name: "English" },
  { code: "de", name: "Deutsch" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "it", name: "Italiano" },
  { code: "pt", name: "Português" },
  { code: "nl", name: "Nederlands" },
  { code: "sv", name: "Svenska" },
  { code: "no", name: "Norsk" },
  { code: "da", name: "Dansk" },
  { code: "fi", name: "Suomi" },
  { code: "pl", name: "Polski" },
  { code: "cs", name: "Čeština" },
  { code: "tr", name: "Türkçe" },
  { code: "ru", name: "Русский" },
  { code: "uk", name: "Українська" },
  { code: "el", name: "Ελληνικά" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "zh", name: "中文" },
];

export function languageName(code: string): string {
  const known = LYRICS_LANGUAGES.find((l) => l.code === code);
  if (known) return known.name;
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}
