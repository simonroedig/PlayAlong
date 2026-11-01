#!/usr/bin/env node
// Runs the built app in the background for the desktop launcher (scripts/launch.mjs)
// and stops it once no PlayAlong tab has been open for a while.
//   node scripts/serve.mjs <port>
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] ?? 3000);
const stateDir = join(root, ".playalong");
const stateFile = join(stateDir, "server.json");
const IDLE_MINUTES = 20;

mkdirSync(stateDir, { recursive: true });
const next = spawn(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});
writeFileSync(stateFile, JSON.stringify({ pid: process.pid, port, started: Date.now() }));

const stop = () => {
  clearInterval(timer);
  next.kill();
  try {
    rmSync(stateFile, { force: true });
  } catch {
    // ignore
  }
  setTimeout(() => process.exit(0), 1000);
};
next.on("exit", (code) => {
  try {
    rmSync(stateFile, { force: true });
  } catch {
    // ignore
  }
  process.exit(code ?? 0);
});
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

// Each open tab checks in every minute; nobody for a while means the browser was closed.
const started = Date.now();
const timer = setInterval(async () => {
  try {
    const res = await fetch(`http://localhost:${port}/api/heartbeat?peek`, { signal: AbortSignal.timeout(5000) });
    const { idleSeconds } = await res.json();
    const idle = idleSeconds ?? (Date.now() - started) / 1000;
    if (idle > IDLE_MINUTES * 60) {
      console.log(`No PlayAlong tab for ${IDLE_MINUTES} minutes, stopping.`);
      stop();
    }
  } catch {
    // still starting, or busy
  }
}, 60_000);
