/**
 * GET — an open PlayAlong tab says it is still there (every minute). The
 * desktop launcher (scripts/serve.mjs) reads `?peek` to stop the server once
 * no tab has been open for a while.
 */

const state = globalThis as typeof globalThis & { playalongLastSeen?: number };

export function GET(request: Request) {
  const now = Date.now();
  if (!new URL(request.url).searchParams.has("peek")) state.playalongLastSeen = now;
  const last = state.playalongLastSeen;
  return Response.json(
    { app: "playalong", idleSeconds: last === undefined ? null : Math.round((now - last) / 1000) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
