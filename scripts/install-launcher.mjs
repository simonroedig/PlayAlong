#!/usr/bin/env node
// Puts a PlayAlong icon where your other programs are, so you can start it with
// a click (and pin it to the taskbar or dock):
//   Windows: desktop and Start menu   macOS: Applications   Linux: app menu and desktop
//   npm run launcher              create the icon
//   npm run launcher -- --remove  remove it again
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const icons = join(root, "scripts", "launcher");
const launch = join(root, "scripts", "launch.mjs");
const node = process.execPath;
const remove = process.argv.includes("--remove");

function windows() {
  // PowerShell single-quoted strings: a quote is written twice.
  const q = (s) => `'${s.replace(/'/g, "''")}'`;
  const script = `
$shell = New-Object -ComObject WScript.Shell
$places = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
foreach ($dir in $places) {
  $path = Join-Path $dir 'PlayAlong.lnk'
  if (${remove ? "$true" : "$false"}) { Remove-Item -LiteralPath $path -ErrorAction SilentlyContinue; continue }
  $link = $shell.CreateShortcut($path)
  $link.TargetPath = ${q(node)}
  $link.Arguments = ${q(`"${launch}"`)}
  $link.WorkingDirectory = ${q(root)}
  $link.IconLocation = ${q(join(icons, "playalong.ico"))}
  $link.Description = 'Take songs apart and play along'
  $link.Save()
  Write-Output $path
}`;
  const file = join(tmpdir(), "playalong-launcher.ps1");
  // A BOM so Windows PowerShell reads paths with umlauts correctly.
  writeFileSync(file, "\ufeff" + script, "utf8");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file], { encoding: "utf8" });
  rmSync(file, { force: true });
  if (result.status !== 0) throw new Error(result.stderr || "PowerShell failed");
  return remove
    ? "Removed the PlayAlong icon from the desktop and the Start menu."
    : `Created the PlayAlong icon on your desktop and in the Start menu.

To put it on the taskbar: open the Start menu, type "PlayAlong", right-click it and choose
"Pin to taskbar" (or drag the desktop icon onto the taskbar).`;
}

function mac() {
  const app = join(homedir(), "Applications", "PlayAlong.app");
  rmSync(app, { recursive: true, force: true });
  if (remove) return "Removed PlayAlong from ~/Applications.";
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  mkdirSync(join(app, "Contents", "Resources"), { recursive: true });
  writeFileSync(
    join(app, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>PlayAlong</string>
  <key>CFBundleDisplayName</key><string>PlayAlong</string>
  <key>CFBundleIdentifier</key><string>com.simonroedig.playalong</string>
  <key>CFBundleExecutable</key><string>PlayAlong</string>
  <key>CFBundleIconFile</key><string>PlayAlong</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
</dict>
</plist>
`,
  );
  const sh = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  const exe = join(app, "Contents", "MacOS", "PlayAlong");
  const logDir = join(root, ".playalong");
  writeFileSync(exe, `#!/bin/bash\nmkdir -p ${sh(logDir)}\nexec ${sh(node)} ${sh(launch)} >> ${sh(join(logDir, "launcher.log"))} 2>&1\n`);
  chmodSync(exe, 0o755);
  copyFileSync(join(icons, "playalong.icns"), join(app, "Contents", "Resources", "PlayAlong.icns"));
  spawnSync("touch", [app]);
  spawnSync("open", ["-R", app]);
  return `Created PlayAlong in ~/Applications (Finder shows it now).

To put it in the Dock: drag it from Finder onto the Dock. You find it in Launchpad and Spotlight too.`;
}

function linux() {
  const apps = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "applications");
  const userDir = spawnSync("xdg-user-dir", ["DESKTOP"], { encoding: "utf8" });
  const desktopDir = userDir.status === 0 && userDir.stdout.trim() ? userDir.stdout.trim() : join(homedir(), "Desktop");
  const files = [join(apps, "playalong.desktop"), join(desktopDir, "playalong.desktop")];
  if (remove) {
    for (const f of files) rmSync(f, { force: true });
    return "Removed the PlayAlong icon from the app menu and the desktop.";
  }
  // Desktop entry quoting: double quotes, with " ` $ \ escaped.
  const arg = (s) => `"${s.replace(/(["`$\\])/g, "\\$1").replace(/%/g, "%%")}"`;
  const entry = `[Desktop Entry]
Type=Application
Name=PlayAlong
Comment=Take songs apart and play along
Exec=${arg(node)} ${arg(launch)}
Icon=${join(icons, "playalong.png")}
Terminal=true
Categories=AudioVideo;Audio;Music;
StartupNotify=false
`;
  mkdirSync(apps, { recursive: true });
  writeFileSync(files[0], entry);
  chmodSync(files[0], 0o755);
  let onDesktop = false;
  if (existsSync(desktopDir)) {
    writeFileSync(files[1], entry);
    chmodSync(files[1], 0o755);
    // GNOME only starts desktop icons it was told to trust.
    spawnSync("gio", ["set", files[1], "metadata::trusted", "true"]);
    onDesktop = true;
  }
  spawnSync("update-desktop-database", [apps]);
  return `Created PlayAlong in your app menu${onDesktop ? " and on the desktop" : ""}.

To put it on the taskbar or dock: open the app menu, search for "PlayAlong", right-click it and
choose "Add to favorites" / "Pin to taskbar" (or drag the icon there).`;
}

try {
  const message = process.platform === "win32" ? windows() : process.platform === "darwin" ? mac() : linux();
  console.log(`\n${message}\n`);
  if (!remove) {
    console.log(`A click starts PlayAlong in the background and opens it in your browser. The first start builds the
app (a minute or two). It stops by itself 20 minutes after you close the last PlayAlong tab.
If you move the PlayAlong folder or update Node.js, run "npm run launcher" again.
`);
  }
} catch (err) {
  console.error(`Could not create the icon: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
