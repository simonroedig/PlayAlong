import type { CSSProperties } from "react";
import { HeroBackdrop } from "@/components/HeroBackdrop";
import { Reveal } from "@/components/Reveal";
import { HowItWorks } from "@/components/HowItWorks";
import { Library } from "@/components/Library";
import { SongImport } from "@/components/SongImport";
import { WhyFree } from "@/components/WhyFree";
import { ArrowDown } from "lucide-react";
import { GetPlayAlong } from "@/components/GetPlayAlong";
import { GitHubIcon } from "@/components/icons";
import { Showcase } from "@/components/Showcase";
import { Screenshot } from "@/components/showcase/Screenshot";
import { SHOTS } from "@/components/showcase/shots";
import { REPO_URL, SHOWCASE, YOUTUBE_IMPORT } from "@/lib/features";
import { STEM_INFO } from "@/lib/mixer";

const HIGHLIGHTS = [
  { label: "Six instruments, each on its own", color: STEM_INFO.guitar.color },
  { label: "Chords for guitar and bass", color: STEM_INFO.bass.color },
  { label: "Lyrics in time", color: STEM_INFO.vocals.color },
  { label: "Free and private", color: STEM_INFO.other.color },
];

const RULE = [STEM_INFO.vocals, STEM_INFO.drums, STEM_INFO.piano, STEM_INFO.guitar, STEM_INFO.bass, STEM_INFO.other];

export default function Home() {
  return (
    <>
      <section className="relative isolate pt-10 pb-8 sm:pt-16">
        <HeroBackdrop />
        <div className="mx-auto max-w-3xl text-center">
          <p className="rise text-xs font-medium tracking-[0.18em] text-zinc-500 uppercase">For guitarists and bassists</p>
          <h1 style={{ "--delay": "0.08s" } as CSSProperties} className="rise mt-4 text-4xl font-semibold tracking-tight text-balance text-zinc-50 sm:text-6xl">
            Be the{" "}
            <span className="relative inline-block whitespace-nowrap">
              missing part
              <span className="stem-rule absolute inset-x-0 -bottom-1.5 h-1 sm:-bottom-2 sm:h-1.5" aria-hidden>
                {RULE.map((stem, i) => (
                  <span
                    key={stem.label}
                    className="grow-x"
                    style={
                      {
                        "--delay": `${0.45 + i * 0.09}s`,
                        ...(stem === STEM_INFO.guitar
                          ? { border: `1.5px dashed ${stem.color}`, background: "transparent" }
                          : { background: stem.color }),
                      } as unknown as CSSProperties
                    }
                  />
                ))}
              </span>
            </span>{" "}
            of any song.
          </h1>
          <p style={{ "--delay": "0.18s" } as CSSProperties} className="rise mx-auto mt-6 max-w-2xl text-base text-pretty text-zinc-400 sm:text-lg">
            {YOUTUBE_IMPORT || SHOWCASE ? "Paste a YouTube link or drop in a song." : "Drop in a song."} PlayAlong takes it apart
            into guitar, bass, drums, vocals and keys, and writes out the chords for guitar and bass and the lyrics. All done by
            AI, free, right on your computer.
          </p>
          {SHOWCASE && (
            <ul style={{ "--delay": "0.24s" } as CSSProperties} className="rise mt-7 flex flex-wrap justify-center gap-2 text-sm">
              {HIGHLIGHTS.map(({ label, color }) => (
                <li key={label} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-zinc-300">
                  <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
                  {label}
                </li>
              ))}
            </ul>
          )}
        </div>

        {SHOWCASE ? (
          <div style={{ "--delay": "0.28s" } as CSSProperties} className="rise mt-9 flex flex-wrap items-center justify-center gap-3">
            <a
              href="#get"
              className="inline-flex h-12 items-center gap-2 rounded-2xl bg-zinc-50 px-6 text-[15px] font-semibold text-ink-950 shadow-lg shadow-white/10 transition hover:bg-white"
            >
              <ArrowDown className="size-5" /> Get it free
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-12 items-center gap-2 rounded-2xl border border-white/15 bg-white/[0.04] px-6 text-[15px] font-semibold text-zinc-100 transition hover:border-white/30 hover:bg-white/[0.08]"
            >
              <GitHubIcon className="size-5" /> View on GitHub
            </a>
          </div>
        ) : (
          <div style={{ "--delay": "0.28s" } as CSSProperties} className="rise mx-auto mt-10 max-w-4xl">
            <SongImport />
          </div>
        )}
      </section>

      {SHOWCASE ? (
        <>
          <figure style={{ "--delay": "0.4s" } as CSSProperties} className="rise relative mx-auto mt-4 w-full max-w-5xl">
            <div aria-hidden className="hero-glow absolute inset-x-0 -top-10 -bottom-4 sm:-inset-x-10 -z-10 rounded-[4rem] opacity-40 blur-3xl" />
            <Screenshot {...SHOTS.hero} priority />
            <figcaption className="mt-4 text-center text-sm text-zinc-500">
              A song in PlayAlong: taken apart into six instruments, the guitar switched off, the chords rolling in.
            </figcaption>
          </figure>
          <Showcase />
        </>
      ) : (
        <>
          <Reveal>
            <Library />
          </Reveal>
          <Reveal>
            <HowItWorks />
          </Reveal>
        </>
      )}

      <Reveal>
        <WhyFree />
      </Reveal>

      {SHOWCASE && (
        <Reveal>
          <GetPlayAlong />
        </Reveal>
      )}
    </>
  );
}
