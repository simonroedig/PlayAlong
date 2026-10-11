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

export type PresetId = "full" | "no-guitar" | "guitar-only" | "no-bass" | "bass-only";

/** Practice modes, in the order of the mode bar and the number keys 1 to 5. */
export const PRESETS: { id: PresetId; label: string; hint: string }[] = [
  { id: "full", label: "Full mix", hint: "Everything, as recorded" },
  { id: "no-guitar", label: "No guitar", hint: "You play the guitar" },
  { id: "guitar-only", label: "Guitar only", hint: "Learn the guitar part" },
  { id: "no-bass", label: "No bass", hint: "You play the bass" },
  { id: "bass-only", label: "Bass only", hint: "Learn the bass line" },
];

/** Whether the vocals are audible in this mix. */
export function vocalsOn(m: MixerSettings): boolean {
  const v = stemIndex("vocals");
  return m.solo.some(Boolean) ? m.solo[v] : !m.muted[v];
}

/**
 * Mute / solo state for a practice mode. The vocals switch sits on top of
 * every mode: muted in the full mix and the "no …" modes, soloed alongside
 * the instrument in the "… only" modes.
 */
export function applyPreset(current: MixerSettings, id: PresetId, vocals = vocalsOn(current)): MixerSettings {
  const g = stemIndex("guitar");
  const b = stemIndex("bass");
  const v = stemIndex("vocals");
  const next: MixerSettings = {
    ...current,
    muted: SOURCES.map(() => false),
    solo: SOURCES.map(() => false),
  };
  if (id === "no-guitar") next.muted[g] = true;
  if (id === "no-bass") next.muted[b] = true;
  if (id === "guitar-only") next.solo[g] = true;
  if (id === "bass-only") next.solo[b] = true;
  if (id === "guitar-only" || id === "bass-only") next.solo[v] = vocals;
  else next.muted[v] = !vocals;
  return next;
}

/** The practice mode the current mute / solo state corresponds to (with either vocals setting), if any. */
export function matchPreset(m: MixerSettings): PresetId | null {
  const vocals = vocalsOn(m);
  for (const preset of PRESETS) {
    const p = applyPreset(m, preset.id, vocals);
    if (p.muted.every((x, i) => x === m.muted[i]) && p.solo.every((x, i) => x === m.solo[i])) return preset.id;
  }
  return null;
}

/** Turns the vocals on or off, keeping the practice mode (or the custom mix). */
export function setVocals(m: MixerSettings, on: boolean): MixerSettings {
  const preset = matchPreset(m);
  if (preset) return applyPreset(m, preset, on);
  const v = stemIndex("vocals");
  const next = { ...m, muted: [...m.muted], solo: [...m.solo] };
  if (m.solo.some(Boolean)) next.solo[v] = on;
  else next.muted[v] = !on;
  return next;
}

export function normalizeMixer(m: MixerSettings | undefined): MixerSettings {
  const base = defaultMixer();
  if (!m || m.volumes?.length !== SOURCES.length) return base;
  return { ...base, ...m };
}
