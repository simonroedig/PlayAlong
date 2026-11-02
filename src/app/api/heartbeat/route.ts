import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * GET — an open PlayAlong tab says it is still there (every minute). The
 * desktop launcher (scripts/serve.mjs) reads `?peek` to stop the server once
 * no tab has been open for a while, and flags when a newer version is ready.
 * POST — restart with that newer version (only from PlayAlong's own pages:
 * the custom header makes browsers block it from other sites).
 */

const state = globalThis as typeof globalThis & { playalongLastSeen?: number };
const stateDir = join(process.cwd(), ".playalong");

export function GET(request: Request) {
  const now = Date.now();
  if (!new URL(request.url).searchParams.has("peek")) state.playalongLastSeen = now;
  const last = state.playalongLastSeen;
  return Response.json(
    {
      app: "playalong",
      idleSeconds: last === undefined ? null : Math.round((now - last) / 1000),
      update: existsSync(join(stateDir, "update-ready")),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export function POST(request: Request) {
  if (request.headers.get("x-playalong") !== "update") return new Response(null, { status: 400 });
  if (!existsSync(join(stateDir, "update-ready"))) return Response.json({ ok: false }, { status: 409 });
  writeFileSync(join(stateDir, "update-requested"), String(Date.now()));
  return Response.json({ ok: true });
}
