#!/usr/bin/env node
// Runs the built app in the background for the desktop launcher (scripts/launch.mjs).
// - Stops once no PlayAlong tab has been open for a while.
// - Notices when the code was updated ("git pull") and tells the open tabs, which
//   can ask for a restart: then it rebuilds and starts the new version.
//   node scripts/serve.mjs <port>
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildIsCurrent, dependenciesOutdated, nextBin, prepare, root, stateDir } from "./lib/app-build.mjs";

const port = Number(process.argv[2] ?? 3000);
const stateFile = join(stateDir, "server.json");
// Read by /api/heartbeat: an update is ready / a tab asked to restart with it.
const updateReady = join(stateDir, "update-ready");
const updateRequested = join(stateDir, "update-requested");
const IDLE_MINUTES = 20;

mkdirSync(stateDir, { recursive: true });
rmSync(updateRequested, { force: true });
writeFileSync(stateFile, JSON.stringify({ pid: process.pid, port, started: Date.now() }));

const log = (text) => console.log(`[${new Date().toISOString()}] ${text}`);
let next = null;
let updating = false;

function startNext() {
  next = spawn(process.execPath, [nextBin, "start", "-p", String(port)], { cwd: root, stdio: "inherit", windowsHide: true });
  next.on("exit", (code) => {
    if (updating) return;
    log(`Next.js stopped (${code}).`);
    cleanUp();
    process.exit(code ?? 0);
  });
}

function cleanUp() {
  for (const file of [stateFile, updateReady, updateRequested]) rmSync(file, { force: true });
}

function stop() {
  clearInterval(idleTimer);
  clearInterval(updateTimer);
  updating = true;
  next?.kill();
  cleanUp();
  setTimeout(() => process.exit(0), 1000);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

async function update() {
  updating = true;
  rmSync(updateRequested, { force: true });
  log("Updating to the new version.");
  await new Promise((resolve) => {
    next.once("exit", resolve);
    next.kill();
  });
  const error = prepare(log, { stdio: "inherit" });
  if (error) log(error);
  rmSync(updateReady, { force: true });
  updating = false;
  startNext();
}

startNext();

// Each open tab checks in every minute; nobody for a while means the browser was closed.
const started = Date.now();
const idleTimer = setInterval(async () => {
  if (updating) return;
  try {
    const res = await fetch(`http://localhost:${port}/api/heartbeat?peek`, { signal: AbortSignal.timeout(5000) });
    const { idleSeconds } = await res.json();
    const idle = idleSeconds ?? (Date.now() - started) / 1000;
    if (idle > IDLE_MINUTES * 60) {
      log(`No PlayAlong tab for ${IDLE_MINUTES} minutes, stopping.`);
      stop();
    }
  } catch {
    // still starting, or busy
  }
}, 60_000);

// New code (a "git pull"): offer the update; restart when a tab asks for it.
let lastCheck = 0;
const updateTimer = setInterval(() => {
  if (updating) return;
  if (Date.now() - lastCheck > 30_000) {
    lastCheck = Date.now();
    try {
      if (!buildIsCurrent() || dependenciesOutdated()) writeFileSync(updateReady, String(Date.now()));
      else rmSync(updateReady, { force: true });
    } catch {
      // files changing under us (a pull in progress): next time
    }
  }
  if (existsSync(updateRequested) && existsSync(updateReady)) void update();
}, 2000);
