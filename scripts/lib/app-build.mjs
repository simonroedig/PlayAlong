// Shared by the desktop launcher (scripts/launch.mjs) and the background server
// (scripts/serve.mjs): is the built app older than the code, and how to rebuild it.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const stateDir = join(root, ".playalong");
export const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const node = process.execPath;

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

/** The build is at least as new as the code (false after a "git pull"). */
export function buildIsCurrent() {
  const id = join(root, ".next", "BUILD_ID");
  return existsSync(id) && statSync(id).mtimeMs >= newestSource();
}

/** Dependencies missing, or package-lock.json changed since the last "npm install". */
export function dependenciesOutdated() {
  const lock = join(root, "package-lock.json");
  const installed = join(root, "node_modules", ".package-lock.json");
  if (!existsSync(nextBin)) return true;
  return existsSync(lock) && existsSync(installed) && statSync(lock).mtimeMs > statSync(installed).mtimeMs + 1000;
}

function npmCli() {
  const candidates = [
    join(dirname(node), "node_modules", "npm", "bin", "npm-cli.js"),
    join(dirname(node), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/**
 * Brings dependencies, models and the build up to date. `say` reports each
 * step. Returns an error message, or null when everything worked.
 */
export function prepare(say, { stdio = "inherit" } = {}) {
  const run = (args) => spawnSync(node, args, { cwd: root, stdio, windowsHide: true }).status === 0;
  if (dependenciesOutdated()) {
    const npm = npmCli();
    if (!npm) return `Please run "npm install" once in ${root}.`;
    say("Installing what PlayAlong needs…");
    if (!run([npm, "install", "--no-audit", "--no-fund"])) return `Installing failed. Run "npm install" in ${root} to see why.`;
  }
  if (!buildIsCurrent()) {
    say("Getting PlayAlong ready. The first time (and after an update) this takes a minute or two…");
    if (!run([join(root, "scripts", "setup.mjs")])) return `Downloading the models failed. Run "npm run setup" in ${root} to see why.`;
    if (!run([nextBin, "build"])) return `Building PlayAlong failed. Run "npm run build" in ${root} to see why.`;
  }
  return null;
}
