#!/usr/bin/env node
// What the PlayAlong icon runs (see scripts/install-launcher.mjs): builds the app
// when it is new or was updated, starts it in the background and opens the browser.
//   node scripts/launch.mjs
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = join(root, ".playalong");
const stateFile = join(stateDir, "server.json");
const node = process.execPath;
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const interactive = process.stdout.isTTY;

const say = (text) => console.log(text);

/** A notification on macOS, where the launcher runs without a window. */
function notify(text) {
  if (process.platform === "darwin" && !interactive) {
    spawnSync("osascript", ["-e", `display notification ${JSON.stringify(text)} with title "PlayAlong"`]);
  }
}

async function fail(text) {
  console.error(`\n${text}`);
  notify(text);
  if (interactive && process.stdin.isTTY) {
    console.error("\nPress Enter to close this window.");
    await new Promise((resolve) => process.stdin.once("data", resolve));
  }
  process.exit(1);
}

function openBrowser(url) {
  const [command, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => say(`Open ${url} in your browser.`));
  child.unref();
}

/** Is PlayAlong answering on this port? */
async function isPlayAlong(port) {
  try {
    const res = await fetch(`http://localhost:${port}/api/heartbeat?peek`, { signal: AbortSignal.timeout(1500) });
    return (await res.json()).app === "playalong";
  } catch {
    return false;
  }
}

async function portInUse(port) {
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch (err) {
    return err?.cause?.code !== "ECONNREFUSED";
  }
}

/** Newest modification time of the files the build is made from. */
function newestSource() {
  let newest = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else newest = Math.max(newest, statSync(path).mtimeMs);
    }
  };
  walk(join(root, "src"));
  for (const file of ["package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "postcss.config.mjs"]) {
    if (existsSync(join(root, file))) newest = Math.max(newest, statSync(join(root, file)).mtimeMs);
  }
  return newest;
}

function buildIsCurrent() {
  const id = join(root, ".next", "BUILD_ID");
  return existsSync(id) && statSync(id).mtimeMs >= newestSource();
}

function run(args, label) {
  const result = spawnSync(node, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) return fail(`${label} failed. Run "npm install" and "npm run build" in ${root} to see why.`);
}

function npmCli() {
  const candidates = [
    join(dirname(node), "node_modules", "npm", "bin", "npm-cli.js"),
    join(dirname(node), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

function stopRunningServer() {
  try {
    const { pid } = JSON.parse(readFileSync(stateFile, "utf8"));
    // On Windows a plain kill would leave the Next.js server under it running.
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    else process.kill(pid);
  } catch {
    // not running
  }
}

async function main() {
  say("Starting PlayAlong…");

  // Dependencies: installed, and up to date after a "git pull".
  const lock = join(root, "package-lock.json");
  const installed = join(root, "node_modules", ".package-lock.json");
  if (!existsSync(nextBin) || (existsSync(lock) && existsSync(installed) && statSync(lock).mtimeMs > statSync(installed).mtimeMs + 1000)) {
    const npm = npmCli();
    if (!npm) return fail(`Please run "npm install" once in ${root}.`);
    say("Installing what PlayAlong needs (once)…");
    notify("Installing what PlayAlong needs. This takes a minute.");
    run([npm, "install", "--no-audit", "--no-fund"], "Installing");
  }

  const fresh = buildIsCurrent();
  const port = Number(process.env.PORT) || 3000;
  let state = null;
  try {
    state = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    // none
  }

  // Already running and up to date: just open it.
  for (const p of [state?.port, port].filter(Boolean)) {
    if (await isPlayAlong(p)) {
      if (fresh || !state || state.port !== p) {
        say("PlayAlong is already running.");
        openBrowser(`http://localhost:${p}`);
        return;
      }
      // Updated since it was started: restart with the new version.
      stopRunningServer();
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  if (!fresh) {
    say("Getting PlayAlong ready. The first time (and after an update) this takes a minute or two…");
    notify("Getting PlayAlong ready. The first time this takes a minute or two.");
    run([join(root, "scripts", "setup.mjs")], "Downloading the models");
    run([nextBin, "build"], "Building PlayAlong");
  }

  // A free port: 3000, or the next one if something else uses it.
  let free = port;
  while (await portInUse(free)) {
    if (await isPlayAlong(free)) break;
    free++;
    if (free > port + 20) return fail("No free port found for PlayAlong.");
  }

  if (!(await isPlayAlong(free))) {
    mkdirSync(stateDir, { recursive: true });
    const log = openSync(join(stateDir, "server.log"), "a");
    const server = spawn(node, [join(root, "scripts", "serve.mjs"), String(free)], {
      cwd: root,
      detached: true,
      stdio: ["ignore", log, log],
      windowsHide: true,
    });
    server.unref();
    const started = Date.now();
    while (!(await isPlayAlong(free))) {
      if (Date.now() - started > 90_000) return fail(`PlayAlong did not start. See ${join(stateDir, "server.log")}.`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  say(`PlayAlong is running at http://localhost:${free}. Opening your browser…`);
  openBrowser(`http://localhost:${free}`);
  // Let the window show the message for a moment before it closes.
  await new Promise((r) => setTimeout(r, interactive ? 1200 : 0));
}

// Make sure the build tools find node when the icon starts us without the usual PATH.
process.env.PATH = `${dirname(node)}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`;
main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
