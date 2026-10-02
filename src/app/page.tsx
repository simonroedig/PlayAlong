import { AudioLines, Guitar, Headphones } from "lucide-react";
import { Library } from "@/components/Library";
import { SongImport } from "@/components/SongImport";

const steps = [
  {
    icon: AudioLines,
    title: "Paste a song",
    text: "Any YouTube link or an audio file from your computer.",
  },
  {
    icon: Guitar,
    title: "AI splits it into stems",
    text: "Guitar, bass, drums, vocals, keys and the rest — computed on your own GPU.",
  },
  {
    icon: Headphones,
    title: "Take the part",
    text: "Mute the guitar or bass, loop the hard bits, slow it down, play along.",
  },
];

export default function Home() {
  return (
    <>
      <section className="pt-12 pb-10 sm:pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400">
            <span className="size-1.5 rounded-full bg-guitar" />
            Play-along trainer for guitarists &amp; bassists
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance text-zinc-50 sm:text-6xl">
            Be the{" "}
            <span className="bg-gradient-to-r from-guitar to-bass bg-clip-text text-transparent">missing part</span> of
            any song.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-pretty text-zinc-400 sm:text-lg">
            Paste a YouTube link and PlayAlong separates the track into instruments right in your browser. Remove the
            guitar or the bass completely — then plug in and play their part.
          </p>
        </div>

        <div className="mx-auto mt-10 max-w-3xl">
          <SongImport />
        </div>

        <ol className="mx-auto mt-10 grid max-w-4xl grid-cols-1 gap-3 sm:grid-cols-3">
          {steps.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                <span className="grid size-7 place-items-center rounded-lg bg-white/5 text-zinc-300">
                  <Icon className="size-4" />
                </span>
                <span className="text-zinc-500">{i + 1}.</span> {title}
              </div>
              <p className="mt-2 text-sm text-zinc-500">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <Library />
    </>
  );
}
