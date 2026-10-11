import type { CSSProperties } from "react";
import { HeroBackdrop } from "@/components/HeroBackdrop";
import { Reveal } from "@/components/Reveal";
import { HowItWorks } from "@/components/HowItWorks";
import { Library } from "@/components/Library";
import { SongImport } from "@/components/SongImport";
import { STEM_INFO } from "@/lib/mixer";

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
            Drop in a song and PlayAlong takes it apart into guitar, bass, drums, vocals and keys, writes out the chords and
            the lyrics, and lets you switch any part off. Then you plug in and play it.
          </p>
        </div>

        <div style={{ "--delay": "0.28s" } as CSSProperties} className="rise mx-auto mt-10 max-w-4xl">
          <SongImport />
        </div>
      </section>

      <Reveal>
        <Library />
      </Reveal>

      <Reveal>
        <HowItWorks />
      </Reveal>
    </>
  );
}
