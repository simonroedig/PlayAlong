import { AudioLines, FolderSync, Gauge, Keyboard, Download, Repeat, type LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Screenshot } from "@/components/showcase/Screenshot";
import { SHOTS } from "@/components/showcase/shots";
import { Reveal } from "@/components/Reveal";
import { STEM_INFO } from "@/lib/mixer";

type Feature = {
  key: keyof typeof SHOTS;
  accent: string;
  eyebrow: string;
  title: string;
  text: string;
  points: string[];
  overlay?: ReactNode;
};

const FEATURES: Feature[] = [
  {
    key: "import",
    accent: "#fafafa",
    eyebrow: "Bring any song",
    title: "Paste a YouTube link or drop in a file",
    text: "Copy the link of a song video, or drag an audio file from your computer onto the page. That's all PlayAlong needs.",
    points: ["YouTube links", "MP3, M4A, WAV, FLAC and OGG files, by drag and drop", "Your songs are kept, so they open instantly next time"],
    overlay: <DropHint />,
  },
  {
    key: "player",
    accent: STEM_INFO.guitar.color,
    eyebrow: "Six instruments",
    title: "Switch the guitar or bass off and take its place",
    text: "The AI takes every song apart into guitar, bass, drums, vocals, keys and the rest. One click mutes your instrument, or plays it alone so you can learn the part.",
    points: ["Without or only: for guitar and for bass, vocals on or off", "Every instrument with its own fader, mute and solo", "Download any instrument, or the backing track, as audio"],
  },
  {
    key: "chart",
    accent: STEM_INFO.bass.color,
    eyebrow: "Chords for guitar and bass",
    title: "The chords, worked out for you",
    text: "PlayAlong listens to the song and writes out the chords bar by bar, with the key and tempo. Big for what to play now and next, with a beat counter, and as a chart of the whole song.",
    points: ["Capo and half step down tuning: the shapes change with it", "Simple chords to start, full chords when you want them", "Unsure chords are marked, so you know where to listen"],
  },
  {
    key: "lyrics",
    accent: STEM_INFO.vocals.color,
    eyebrow: "Lyrics",
    title: "The lyrics, with every chord on its word",
    text: "Whisper, the speech AI, writes down what's sung, and each chord sits right above the word where it changes. The sheet scrolls with the music, like a teleprompter.",
    points: ["English, German and many more, even mixed in one song", "Click a line to jump there, Shift + click to loop", "Unsure words are underlined"],
  },
  {
    key: "separating",
    accent: STEM_INFO.other.color,
    eyebrow: "Free and private",
    title: "All of it runs on your own computer",
    text: "No upload, no account, no subscription. The AI models run inside your browser, on the graphics card if there is one. A song takes a few minutes the first time and opens instantly after that.",
    points: ["Nothing leaves your computer", "Fast with a graphics card (WebGPU), and it works without one too", "As many songs as you like"],
  },
];

const EXTRAS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Gauge, title: "Slow it down", text: "Practise at half speed, without the pitch changing." },
  { icon: Repeat, title: "Loop the hard bits", text: "Drag over the waveform and it repeats seamlessly." },
  { icon: Download, title: "Your backing track", text: "Save the mix without your part, e.g. for a jam." },
  { icon: FolderSync, title: "Sync your songs", text: "Keep them in a folder, e.g. in OneDrive or Dropbox." },
  { icon: Keyboard, title: "Keyboard shortcuts", text: "Play, seek, loop and switch parts without the mouse." },
  { icon: AudioLines, title: "Any song", text: "Rock, pop, singer-songwriter: whatever you want to play." },
];

/** The feature tour of the public showcase: what PlayAlong does, with screenshots of the real app. */
export function Showcase() {
  return (
    <section aria-labelledby="tour-heading" className="mt-24 sm:mt-32">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-medium tracking-[0.18em] text-zinc-500 uppercase">What it does</p>
        <h2 id="tour-heading" className="mt-2 text-3xl font-semibold tracking-tight text-balance text-zinc-50 sm:text-4xl">
          Everything you need to play along, worked out by AI
        </h2>
      </div>

      <div className="mt-14 space-y-20 sm:mt-20 sm:space-y-28">
        {FEATURES.map((f, i) => (
          <Reveal key={f.key}>
            <FeatureRow feature={f} flip={i % 2 === 1} />
          </Reveal>
        ))}
      </div>

      <Reveal>
        <div className="mt-24 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {EXTRAS.map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
              <Icon className="mt-0.5 size-5 shrink-0 text-zinc-400" />
              <div>
                <p className="font-medium text-zinc-100">{title}</p>
                <p className="mt-1 text-sm text-zinc-500">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

function FeatureRow({ feature: f, flip }: { feature: Feature; flip: boolean }) {
  const shot = SHOTS[f.key];
  return (
    <div className="grid items-center gap-8 lg:grid-cols-12 lg:gap-14">
      <div className={`lg:col-span-5 ${flip ? "lg:order-2" : ""}`}>
        <p className="flex items-center gap-2.5 text-sm font-semibold" style={{ color: f.accent }}>
          <span className="h-1 w-6 rounded-full" style={{ background: f.accent }} aria-hidden />
          {f.eyebrow}
        </p>
        <h3 className="mt-3 text-2xl font-semibold tracking-tight text-balance text-zinc-50 sm:text-3xl">{f.title}</h3>
        <p className="mt-4 text-pretty text-zinc-400">{f.text}</p>
        <ul className="mt-5 space-y-2 text-sm text-zinc-300">
          {f.points.map((p) => (
            <li key={p} className="flex gap-3">
              <span className="mt-2 size-1.5 shrink-0 rounded-full" style={{ background: f.accent }} aria-hidden />
              {p}
            </li>
          ))}
        </ul>
      </div>
      <div className={`relative lg:col-span-7 ${flip ? "lg:order-1" : ""}`}>
        <div
          aria-hidden
          className="absolute -inset-y-8 inset-x-0 -z-10 rounded-[3rem] sm:-inset-x-8 opacity-25 blur-3xl"
          style={{ background: `radial-gradient(closest-side, ${f.accent}, transparent)` } as CSSProperties}
        />
        <Screenshot {...shot}>{f.overlay}</Screenshot>
      </div>
    </div>
  );
}

/** A file gliding onto the drop zone of the import screenshot, slowly, to show drag and drop. */
function DropHint() {
  return (
    <div aria-hidden className="absolute inset-y-0 right-0 w-1/2 motion-reduce:hidden">
      <span className="drop-glow absolute inset-[6%] rounded-[1.4rem] border-2 border-dashed border-white/70 bg-white/[0.06]" />
      <span className="drop-file absolute top-1/2 left-1/2 inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-zinc-50 px-2.5 py-1.5 text-[11px] font-semibold text-ink-950 shadow-xl shadow-black/50 sm:text-xs">
        <AudioLines className="size-3.5" /> my-song.mp3
      </span>
    </div>
  );
}
