import { SOURCES, type SourceName } from "./separation/model";

/** Per-stem mixer state, indexed in model output order (see SOURCES). */
export interface MixerSettings {
  volumes: number[];
  muted: boolean[];
  solo: boolean[];
  master: number;
}

export const STEM_INFO: Record<SourceName, { label: string; color: string; short: string }> = {
  guitar: { label: "Guitar", short: "GTR", color: "#fb923c" },
  bass: { label: "Bass", short: "BASS", color: "#a78bfa" },
  drums: { label: "Drums", short: "DRM", color: "#facc15" },
  vocals: { label: "Vocals", short: "VOX", color: "#f472b6" },
  piano: { label: "Keys", short: "KEYS", color: "#22d3ee" },
  other: { label: "Other", short: "OTH", color: "#4ade80" },
};

/** Guitar and bass first: they are what this app is about. */
export const DISPLAY_ORDER: SourceName[] = ["guitar", "bass", "drums", "vocals", "piano", "other"];

export const stemIndex = (name: SourceName) => SOURCES.indexOf(name);

export function defaultMixer(): MixerSettings {
  return {
    volumes: SOURCES.map(() => 1),
    muted: SOURCES.map(() => false),
    solo: SOURCES.map(() => false),
    master: 1,
  };
}

/** Linear gain per stem after mute / solo / volume / master. */
export function effectiveGains(m: MixerSettings): number[] {
  const anySolo = m.solo.some(Boolean);
  return m.volumes.map((v, i) => {
    const audible = anySolo ? m.solo[i] : !m.muted[i];
    return audible ? v * m.master : 0;
  });
}

export type PresetId = "full" | "no-guitar" | "no-bass" | "guitar-only" | "bass-only";

export const PRESETS: { id: PresetId; label: string; hint: string }[] = [
  { id: "no-guitar", label: "No guitar", hint: "Backing track for guitarists" },
  { id: "no-bass", label: "No bass", hint: "Backing track for bassists" },
  { id: "full", label: "Full mix", hint: "Everything, as recorded" },
  { id: "guitar-only", label: "Guitar only", hint: "Learn the guitar part" },
  { id: "bass-only", label: "Bass only", hint: "Learn the bass line" },
];

export function applyPreset(current: MixerSettings, id: PresetId): MixerSettings {
  const g = stemIndex("guitar");
  const b = stemIndex("bass");
  const next: MixerSettings = {
    ...current,
    muted: SOURCES.map(() => false),
    solo: SOURCES.map(() => false),
  };
  if (id === "no-guitar") next.muted[g] = true;
  if (id === "no-bass") next.muted[b] = true;
  if (id === "guitar-only") next.solo[g] = true;
  if (id === "bass-only") next.solo[b] = true;
  return next;
}

/** The preset the current mute / solo state corresponds to, if any. */
export function matchPreset(m: MixerSettings): PresetId | null {
  for (const preset of PRESETS) {
    const p = applyPreset(m, preset.id);
    if (p.muted.every((v, i) => v === m.muted[i]) && p.solo.every((v, i) => v === m.solo[i])) return preset.id;
  }
  return null;
}

export function normalizeMixer(m: MixerSettings | undefined): MixerSettings {
  const base = defaultMixer();
  if (!m || m.volumes?.length !== SOURCES.length) return base;
  return { ...base, ...m };
}
