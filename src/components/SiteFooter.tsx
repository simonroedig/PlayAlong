import { ArrowUpRight } from "lucide-react";
import { GitHubIcon } from "@/components/icons";
import { Logo } from "@/components/Logo";
import { REPO_URL } from "@/lib/features";

const STEMS = ["#f472b6", "#facc15", "#22d3ee", "#fb923c", "#a78bfa", "#4ade80"];

export function SiteFooter() {
  return (
    <footer className="relative mt-8 border-t border-white/5 bg-black/20">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.3fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-3">
            <Logo size={40} />
            <span className="text-lg font-semibold tracking-tight text-zinc-50">PlayAlong</span>
          </div>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-zinc-400">
            Take any song apart, switch off the part you want to play, and follow the chords and lyrics as they come.
          </p>
          <div className="mt-5 flex gap-1.5" aria-hidden>
            {STEMS.map((c, i) => (
              <span
                key={c}
                className="h-1.5 w-8 rounded-full"
                style={i === 3 ? { border: `1.5px dashed ${c}` } : { background: c }}
              />
            ))}
          </div>
        </div>

        <div className="text-sm">
          <p className="font-medium text-zinc-200">How PlayAlong works</p>
          <ul className="mt-3 space-y-2 text-zinc-400">
            <li>The AI runs on your own computer</li>
            <li>Your audio is never uploaded</li>
            <li>Songs are kept in your browser or a folder you choose</li>
          </ul>
        </div>

        <div className="text-sm">
          <p className="font-medium text-zinc-200">Made by</p>
          <a
            href="https://simonroedig.com"
            target="_blank"
            rel="noreferrer"
            className="group mt-3 inline-flex items-center gap-1 text-zinc-100 underline decoration-white/20 underline-offset-4 transition hover:decoration-white/60"
          >
            Simon Roedig
            <ArrowUpRight className="size-3.5 text-zinc-500 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-zinc-200" />
          </a>
          <p className="mt-1 text-zinc-500">simonroedig.com</p>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-2 text-zinc-300 transition hover:text-zinc-50"
          >
            <GitHubIcon className="size-4" /> Code on GitHub
          </a>
        </div>
      </div>
      <div className="border-t border-white/5 py-5 text-center text-xs text-zinc-600">
        © {new Date().getFullYear()} PlayAlong · Use it with music you have the right to use.
      </div>
    </footer>
  );
}
