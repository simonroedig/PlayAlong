import { YOUTUBE_IMPORT } from "@/lib/features";
import { cachedAudio } from "@/lib/server/ytdlp";
import { isYouTubeId } from "@/lib/youtube";

/**
 * GET — the video thumbnail, proxied so the cross-origin-isolated pages can
 * embed it (i.ytimg.com does not send CORP headers).
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/youtube/[id]/thumbnail">) {
  if (!YOUTUBE_IMPORT) return Response.json({ error: "YouTube import is turned off on this server" }, { status: 404 });
  const { id } = await ctx.params;
  if (!isYouTubeId(id)) return new Response(null, { status: 400 });

  const candidates = [
    cachedAudio(id, "opus")?.meta.thumbnail ?? cachedAudio(id, "aac")?.meta.thumbnail,
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  ].filter((u): u is string => !!u && /^https:\/\/[^/]*(ytimg\.com|youtube\.com|ggpht\.com)\//.test(u));

  for (const url of candidates) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      return new Response(await res.arrayBuffer(), {
        headers: {
          "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
          "Cache-Control": "public, max-age=86400",
        },
      });
    } catch {
      // try the next candidate
    }
  }
  return new Response(null, { status: 404 });
}
