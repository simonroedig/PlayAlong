#!/usr/bin/env node
// What the PlayAlong icon runs (see scripts/install-launcher.mjs): builds the app
// when it is new or was updated, starts it in the background and opens the browser.
//   node scripts/launch.mjs
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildIsCurrent, dependenciesOutdated, prepare, root, stateDir } from "./lib/app-build.mjs";

const stateFile = join(stateDir, "server.json");
const node = process.execPath;
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

/**
 * The browser to open: Edge on Windows (always installed, and like Chrome it can save songs to a folder and use
 * the graphics card), otherwise the default browser. `npm run launcher -- --browser=chrome|edge|default` changes it.
 */
function preferredBrowser() {
  try {
    const { browser } = JSON.parse(readFileSync(join(stateDir, "launcher.json"), "utf8"));
    if (["edge", "chrome", "default"].includes(browser)) return browser;
  } catch {
    // not set
  }
  return process.platform === "win32" ? "edge" : "default";
}

function browserCommand(browser, url) {
  if (process.platform === "win32") {
    const app = { edge: "msedge", chrome: "chrome", default: "" }[browser];
    return ["cmd", ["/c", "start", "", ...(app ? [app] : []), url]];
  }
  if (process.platform === "darwin") {
    const app = { edge: "Microsoft Edge", chrome: "Google Chrome", default: null }[browser];
    return ["open", app ? ["-a", app, url] : [url]];
  }
  const app = { edge: "microsoft-edge", chrome: "google-chrome", default: "xdg-open" }[browser];
  return [app, [url]];
}

function openBrowser(url, browser = preferredBrowser()) {
  const [command, args] = browserCommand(browser, url);
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => (browser === "default" ? say(`Open ${url} in your browser.`) : openBrowser(url, "default")));
  // "start" and "open" return right away, so a failure to find that browser shows in the exit code.
  if (process.platform !== "linux") child.on("exit", (code) => code && browser !== "default" && openBrowser(url, "default"));
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

  const fresh = buildIsCurrent() && !dependenciesOutdated();
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

  if (!fresh) notify("Getting PlayAlong ready. The first time this takes a minute or two.");
  const error = prepare(say);
  if (error) return fail(error);

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
