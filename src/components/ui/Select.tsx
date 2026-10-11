"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

/**
 * A dropdown in the app's own style (the native list looks different in every
 * browser): a button with the chosen value, and a list that opens below it.
 * Keyboard: arrows, Home / End, Enter or Space to pick, Escape to close.
 */
export function Select<T extends string | number>({
  value,
  onChange,
  options,
  label,
  align = "right",
  className = "",
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  label: string;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  const selected = Math.max(0, options.findIndex((o) => o.value === value));

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-index="${focus}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, focus]);

  const show = () => {
    setFocus(selected);
    setOpen(true);
  };
  const pick = (i: number) => {
    onChange(options[i].value);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    const moves: Record<string, number> = { ArrowDown: focus + 1, ArrowUp: focus - 1, Home: 0, End: options.length - 1 };
    if (e.key in moves) {
      e.preventDefault();
      setFocus(Math.max(0, Math.min(options.length - 1, moves[e.key])));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(focus);
    } else if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={box} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        className={`inline-flex h-9 w-full items-center justify-between gap-2 rounded-xl border px-3 text-xs font-medium transition ${
          open ? "border-white/30 bg-white/[0.1] text-zinc-50" : "border-white/10 bg-white/[0.04] text-zinc-200 hover:border-white/20 hover:bg-white/[0.08]"
        }`}
      >
        <span className="truncate">{options[selected]?.label}</span>
        <ChevronDown className={`size-3.5 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-label={label}
          className={`absolute top-full z-50 mt-1.5 max-h-72 min-w-full overflow-y-auto rounded-2xl border border-white/10 bg-ink-850/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {options.map((o, i) => {
            const isSelected = i === selected;
            return (
              <li
                key={String(o.value)}
                role="option"
                aria-selected={isSelected}
                data-index={i}
                onPointerEnter={() => setFocus(i)}
                onClick={() => pick(i)}
                className={`flex cursor-pointer items-center justify-between gap-4 rounded-xl px-3 py-2 text-xs whitespace-nowrap transition-colors ${
                  i === focus ? "bg-white/10 text-zinc-50" : "text-zinc-300"
                } ${isSelected ? "font-semibold" : ""}`}
              >
                {o.label}
                <Check className={`size-3.5 ${isSelected ? "text-zinc-100" : "invisible"}`} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
