const ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function isYouTubeId(value: string): boolean {
  return ID_PATTERN.test(value);
}

/**
 * Extracts the video id from the usual YouTube URL shapes (watch, youtu.be,
 * shorts, embed, live, music.youtube.com, nocookie) or a bare 11-character id.
 * Returns null for anything else.
 */
export function parseYouTubeId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (isYouTubeId(text)) return text;

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  const segments = url.pathname.split("/").filter(Boolean);

  let candidate: string | null = null;
  if (host === "youtu.be") {
    candidate = segments[0] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (segments[0] === "watch" || segments.length === 0) {
      candidate = url.searchParams.get("v");
    } else if (["shorts", "embed", "live", "v", "e"].includes(segments[0])) {
      candidate = segments[1] ?? null;
    } else if (segments[0] === "attribution_link") {
      const inner = url.searchParams.get("u");
      return inner ? parseYouTubeId(`https://youtube.com${inner}`) : null;
    }
  }
  return candidate && isYouTubeId(candidate) ? candidate : null;
}

export function youTubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}
