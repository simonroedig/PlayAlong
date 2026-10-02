import { fetchAudio } from "@/lib/server/ytdlp";
import { parseYouTubeId } from "@/lib/youtube";
import { AUDIO_FORMATS, type AudioFormat, type YouTubeEvent } from "@/lib/youtube-types";

/**
 * POST { url, format? } — downloads the audio of a YouTube video into the
 * server-side cache and streams progress as newline-delimited JSON
 * (`YouTubeEvent`). The audio itself is then fetched from
 * /api/youtube/[id]/audio?format=….
 */
export async function POST(request: Request) {
  let url: unknown;
  let format: unknown;
  try {
    ({ url, format = "opus" } = await request.json());
  } catch {
    return Response.json({ error: "Expected a JSON body with a `url` field" }, { status: 400 });
  }
  const id = typeof url === "string" ? parseYouTubeId(url) : null;
  if (!id) return Response.json({ error: "That doesn't look like a YouTube video link" }, { status: 400 });
  if (!AUDIO_FORMATS.includes(format as AudioFormat)) {
    return Response.json({ error: `format must be one of ${AUDIO_FORMATS.join(", ")}` }, { status: 400 });
  }

  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      unsubscribe = fetchAudio(id, format as AudioFormat, (event: YouTubeEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        if (event.type === "done" || event.type === "error") {
          closed = true;
          controller.close();
        }
      });
    },
    cancel() {
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
