import { Cloud, CreditCard, Gauge, HardDriveDownload, Info, Laptop, ShieldCheck, Upload } from "lucide-react";
import type { CSSProperties } from "react";
import { DISPLAY_ORDER, STEM_INFO } from "@/lib/mixer";

const FACTS = [
  {
    icon: HardDriveDownload,
    title: "Downloaded once",
    text: "The AI models (about 125 MB, plus 1 GB for the lyrics) come once and are kept by your browser.",
  },
  {
    icon: Gauge,
    title: "Speed depends on your device",
    text: "With a recent graphics card a song takes about as long as it plays. On a processor it can take several minutes; lyrics need a minute or two more.",
  },
  {
    icon: ShieldCheck,
    title: "Private by design",
    text: "Your audio is never uploaded and you don't need an account.",
  },
];

/** Landing section: why PlayAlong costs nothing, and what that means for you. */
export function WhyFree() {
  return (
    <section aria-labelledby="free-heading" className="mt-24">
      <div className="max-w-2xl">
        <p className="text-xs font-medium tracking-[0.18em] text-zinc-500 uppercase">Why it&apos;s free</p>
        <h2 id="free-heading" className="mt-2 text-2xl font-semibold tracking-tight text-balance text-zinc-50 sm:text-3xl">
          Your computer is the studio.
        </h2>
        <p className="mt-3 text-pretty text-zinc-400">
          Stem splitters usually run on rented cloud GPUs, so they charge per song or per month. PlayAlong sends the AI to
          your browser instead and lets your own graphics card or processor do the work. That costs nobody anything, so
          it&apos;s free, and your music stays on your device.
        </p>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {/* the usual way */}
        <div className="rounded-3xl border border-white/5 bg-white/[0.02] p-6">
          <p className="text-sm font-medium text-zinc-400">The usual way</p>
          <div className="mt-6 flex items-center gap-3">
            <Node icon={Upload} label="Your song" />
            <div className="relative h-px flex-1 border-t border-dashed border-white/20">
              <span className="absolute -top-1 size-2 -translate-x-1/2 rounded-full bg-zinc-300 motion-safe:animate-[travel_2.6s_ease-in-out_infinite]" />
            </div>
            <Node icon={Cloud} label="Their servers" />
            <div className="relative h-px flex-1 border-t border-dashed border-white/20">
              <span className="absolute -top-1 size-2 -translate-x-1/2 rounded-full bg-zinc-300 motion-safe:animate-[travel_2.6s_ease-in-out_1.3s_infinite]" />
            </div>
            <Node icon={CreditCard} label="Per song or month" />
          </div>
          <p className="mt-6 text-sm text-zinc-500">Upload, wait in a queue, pay for the GPU time.</p>
        </div>

        {/* PlayAlong */}
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-6">
          <p className="text-sm font-medium text-zinc-100">PlayAlong</p>
          <div className="mt-6 flex items-center gap-5">
            <Node icon={Laptop} label="Your device" bright />
            <div className="relative h-24 flex-1" aria-hidden>
              {DISPLAY_ORDER.map((name, i) => (
                <span
                  key={name}
                  className="split-bar absolute top-1/2 left-0 h-2.5 w-full origin-left rounded-full motion-safe:animate-[split_3.2s_cubic-bezier(0.2,0.8,0.2,1)_infinite_alternate]"
                  style={
                    {
                      background: STEM_INFO[name].color,
                      "--y": `${(i - 2.5) * 15 - 5}px`,
                      animationDelay: `${i * 0.06}s`,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
          </div>
          <p className="mt-6 text-sm text-zinc-300">The song splits right where it is. No upload, no queue, no bill.</p>
        </div>
      </div>

      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {FACTS.map(({ icon: Icon, title, text }) => (
          <li key={title} className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-zinc-100">
              <Icon className="size-4 text-zinc-300" /> {title}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{text}</p>
          </li>
        ))}
      </ul>

      <aside className="mt-4 flex gap-3 rounded-2xl border border-white/5 bg-black/20 p-4 text-sm leading-relaxed text-zinc-400">
        <Info className="mt-0.5 size-4 shrink-0 text-zinc-500" />
        <p>
          <span className="font-medium text-zinc-200">Good to know.</span> PlayAlong is a free hobby project for practising
          an instrument. Use it with music you own or are allowed to use, and keep what you make with it to yourself.
          Stems, chords and lyrics are AI estimates and can be wrong. PlayAlong is not affiliated with any artist, label or
          streaming service.
        </p>
      </aside>
    </section>
  );
}

function Node({ icon: Icon, label, bright = false }: { icon: typeof Laptop; label: string; bright?: boolean }) {
  return (
    <span className="flex w-20 shrink-0 flex-col items-center gap-2 text-center">
      <span className={`grid size-12 place-items-center rounded-2xl ${bright ? "bg-zinc-50 text-ink-950" : "bg-white/[0.06] text-zinc-300"}`}>
        <Icon className="size-5" />
      </span>
      <span className={`text-[11px] leading-tight ${bright ? "text-zinc-200" : "text-zinc-500"}`}>{label}</span>
    </span>
  );
}
