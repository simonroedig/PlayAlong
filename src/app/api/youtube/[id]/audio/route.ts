import { YOUTUBE_IMPORT } from "@/lib/features";
import fs from "node:fs";
import { Readable } from "node:stream";
import { cachedAudio } from "@/lib/server/ytdlp";
import { AUDIO_FORMATS, type AudioFormat } from "@/lib/youtube-types";

/** GET ?format=opus|aac — the cached audio of a video previously fetched via POST /api/youtube. */
export async function GET(request: Request, ctx: RouteContext<"/api/youtube/[id]/audio">) {
  if (!YOUTUBE_IMPORT) return Response.json({ error: "YouTube import is turned off on this server" }, { status: 404 });
  const { id } = await ctx.params;
  const format = new URL(request.url).searchParams.get("format") ?? "opus";
  if (!AUDIO_FORMATS.includes(format as AudioFormat)) return Response.json({ error: "Unknown format" }, { status: 400 });
  const audio = cachedAudio(id, format as AudioFormat);
  if (!audio) return Response.json({ error: "Audio not downloaded yet" }, { status: 404 });

  const body = Readable.toWeb(fs.createReadStream(audio.file)) as ReadableStream<Uint8Array>;
  return new Response(body, {
    headers: {
      "Content-Type": audio.mimeType,
      "Content-Length": String(audio.size),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
