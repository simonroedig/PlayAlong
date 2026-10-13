/* eslint-disable @next/next/no-img-element -- static screenshots */

const SHOTS = [
  { src: "/showcase/player.jpg", alt: "The player: practice modes, waveform of all six stems and the chord timeline", caption: "Switch the guitar or bass off, see every stem and the chords rolling in." },
  { src: "/showcase/lyrics.jpg", alt: "Chords above the lyrics, following the song", caption: "The chord now and next, and the lyrics with the chords above the words." },
  { src: "/showcase/separating.jpg", alt: "Separation progress in the stem colours", caption: "The song is taken apart right on your computer." },
];

/** Screenshots of the real app (showcase build). */
export function Showcase() {
  return (
    <section aria-labelledby="shots-heading" className="mt-16">
      <h2 id="shots-heading" className="sr-only">
        Screenshots
      </h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <Shot {...SHOTS[0]} className="lg:col-span-2" />
        <Shot {...SHOTS[1]} />
        <Shot {...SHOTS[2]} />
      </div>
    </section>
  );
}

function Shot({ src, alt, caption, className = "" }: { src: string; alt: string; caption: string; className?: string }) {
  return (
    <figure className={`overflow-hidden rounded-3xl border border-white/10 bg-ink-900/80 shadow-2xl shadow-black/40 ${className}`}>
      <img src={src} alt={alt} loading="lazy" className="block w-full" />
      <figcaption className="border-t border-white/5 px-5 py-3 text-sm text-zinc-400">{caption}</figcaption>
    </figure>
  );
}
