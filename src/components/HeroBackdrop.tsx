const STRIPES = [
  { color: "#f472b6", left: 8, width: 46 },
  { color: "#fb923c", left: 22, width: 38, missing: true },
  { color: "#22d3ee", left: 2, width: 58 },
  { color: "#a78bfa", left: 30, width: 44 },
  { color: "#facc15", left: 14, width: 50 },
  { color: "#4ade80", left: 36, width: 34 },
];

/** The logo's stripes, large and soft behind the hero: the stems, slanted across the page. */
export function HeroBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-[-11rem] left-1/2 -z-10 h-[52rem] w-screen -translate-x-1/2 overflow-hidden [mask-image:linear-gradient(to_bottom,black_45%,transparent_95%)]"
    >
      {/* soft glow */}
      <div className="absolute top-40 left-1/2 w-[110rem] -translate-x-1/2 -rotate-[12deg] space-y-9 opacity-[0.16] blur-3xl">
        {STRIPES.map((s) => (
          <div
            key={s.color}
            className="h-12 rounded-full"
            style={{ background: s.missing ? "transparent" : s.color, marginLeft: `${s.left}%`, width: `${s.width}%` }}
          />
        ))}
      </div>
      {/* crisp lines */}
      <div className="absolute top-52 left-1/2 w-[110rem] -translate-x-1/2 -rotate-[12deg] space-y-[3.75rem] opacity-30">
        {STRIPES.map((s) => (
          <div
            key={s.color}
            className="h-[3px] rounded-full"
            style={
              s.missing
                ? { borderTop: `2px dashed ${s.color}`, marginLeft: `${s.left}%`, width: `${s.width}%`, opacity: 0.8 }
                : { background: `linear-gradient(to right, transparent, ${s.color} 30%, ${s.color} 70%, transparent)`, marginLeft: `${s.left}%`, width: `${s.width}%` }
            }
          />
        ))}
      </div>
    </div>
  );
}
