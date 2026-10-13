"use client";

import { Check, Copy, Download, Globe, Terminal } from "lucide-react";
import { useState } from "react";
import { GitHubIcon } from "@/components/icons";
import { REPO_URL } from "@/lib/features";

const COMMANDS = ["git clone https://github.com/simonroedig/PlayAlong.git", "cd PlayAlong", "npm install", "npm run dev"];

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard blocked: the text is selectable anyway
        }
      }}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100"
      aria-label={label}
    >
      {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** The guide to running PlayAlong on your own computer (the showcase's call to action). */
export function GetPlayAlong() {
  return (
    <section id="get" aria-labelledby="get-heading" className="mt-24 scroll-mt-8">
      <div className="max-w-2xl">
        <p className="text-xs font-medium tracking-[0.18em] text-zinc-500 uppercase">Get PlayAlong</p>
        <h2 id="get-heading" className="mt-2 text-2xl font-semibold tracking-tight text-balance text-zinc-50 sm:text-3xl">
          Run it on your own computer. Free, in four lines.
        </h2>
        <p className="mt-3 text-pretty text-zinc-400">
          PlayAlong runs locally: your computer serves the app and does the AI work, so there&apos;s no account, no upload
          and no limit. Paste YouTube links or drop audio files, and keep your songs in a folder of your choice.
        </p>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <ol className="min-w-0 space-y-4 rounded-3xl border border-white/10 bg-ink-900/80 p-5 sm:p-6">
          <Step n={1} title="Install Node.js 22 or newer">
            From{" "}
            <a href="https://nodejs.org" target="_blank" rel="noreferrer" className="text-zinc-100 underline decoration-white/30 underline-offset-4 hover:decoration-white/70">
              nodejs.org
            </a>{" "}
            (the LTS version), and{" "}
            <a href="https://git-scm.com/downloads" target="_blank" rel="noreferrer" className="text-zinc-100 underline decoration-white/30 underline-offset-4 hover:decoration-white/70">
              git
            </a>{" "}
            if you don&apos;t have it (or download the ZIP instead). Nothing else: no Python, no account.
          </Step>
          <Step n={2} title="Open a terminal and run">
            <span className="block">
              Windows: <span className="text-zinc-300">Terminal or PowerShell</span> from the Start menu. Mac:{" "}
              <span className="text-zinc-300">Terminal</span> (in Utilities). Linux: any terminal.
            </span>
            <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black/50">
              <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5">
                <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
                  <Terminal className="size-3.5" /> Terminal
                </span>
                <CopyButton text={COMMANDS.join("\n")} label="Copy all commands" />
              </div>
              <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-7 text-zinc-200">
                {COMMANDS.map((c) => (
                  <div key={c}>
                    <span className="text-zinc-600 select-none">$ </span>
                    {c}
                  </div>
                ))}
              </pre>
            </div>
          </Step>
          <Step n={3} title="Open localhost:3000">
            In Chrome or Edge, at{" "}
            <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-zinc-200">http://localhost:3000</code>. The first
            start downloads the AI models and the YouTube helper by itself (about 700 MB, once); after that it starts right
            away.
            <span className="mt-2 block text-zinc-500">
              To stop it, press Ctrl + C in the terminal. Next time, open a terminal in the PlayAlong folder and run{" "}
              <code className="font-mono text-zinc-300">npm run dev</code> again.
            </span>
          </Step>
        </ol>

        <div className="flex flex-col gap-4">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="group flex items-center gap-4 rounded-3xl border border-white/10 bg-zinc-50 p-5 text-ink-950 transition hover:bg-white"
          >
            <GitHubIcon className="size-8 shrink-0" />
            <span>
              <span className="block font-semibold">simonroedig/PlayAlong</span>
              <span className="block text-sm text-zinc-600">The code and the full guide on GitHub</span>
            </span>
          </a>
          <a
            href={`${REPO_URL}/archive/refs/heads/main.zip`}
            className="flex items-center gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-white/20 hover:bg-white/[0.06]"
          >
            <Download className="size-6 shrink-0 text-zinc-300" />
            <span>
              <span className="block font-medium text-zinc-100">No git? Download the ZIP</span>
              <span className="block text-sm text-zinc-500">Unpack it, open a terminal in the folder, then npm install and npm run dev.</span>
            </span>
          </a>
          <div className="flex items-start gap-4 rounded-3xl border border-white/5 bg-black/20 p-5 text-sm text-zinc-400">
            <Globe className="mt-0.5 size-5 shrink-0 text-zinc-500" />
            <p>
              Works on Windows, macOS and Linux, with the same steps. A graphics card makes it fast (Chrome or Edge use it
              through WebGPU); without one it runs on the processor and takes a few minutes per song.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-zinc-50 font-mono text-sm font-semibold text-ink-950">{n}</span>
      <div className="min-w-0 flex-1 text-sm leading-relaxed text-zinc-400">
        <p className="font-medium text-zinc-100">{title}</p>
        <div className="mt-1">{children}</div>
      </div>
    </li>
  );
}
