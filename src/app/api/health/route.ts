import { health } from "@/lib/server/ytdlp";

/** GET — server capabilities the UI shows up front (is yt-dlp usable?). */
export async function GET() {
  return Response.json(health(), { headers: { "Cache-Control": "no-store" } });
}
