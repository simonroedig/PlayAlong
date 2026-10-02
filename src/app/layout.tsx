import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { EngineBadge } from "@/components/EngineBadge";
import { EnvironmentNotice } from "@/components/EnvironmentNotice";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "PlayAlong — remove the guitar or bass from any song", template: "%s · PlayAlong" },
  description:
    "Paste a YouTube link, separate the song into stems right in your browser, mute the guitar or bass and play along.",
};

export const viewport: Viewport = {
  themeColor: "#07070a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <header className="sticky top-0 z-30 border-b border-white/5 bg-ink-950/70 backdrop-blur-xl">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
            <Link href="/" className="group flex items-center gap-2.5" aria-label="PlayAlong home">
              <Logo />
              <span className="text-[15px] font-semibold tracking-tight text-zinc-100">
                Play<span className="text-zinc-400 transition group-hover:text-zinc-200">Along</span>
              </span>
            </Link>
            <EngineBadge />
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-16 sm:px-6">
          <EnvironmentNotice />
          {children}
        </main>
        <footer className="border-t border-white/5 py-6 text-center text-xs text-zinc-500">
          Stem separation runs on your device with Demucs v4 (htdemucs_6s) on ONNX Runtime Web. Your songs never leave
          your browser.
        </footer>
      </body>
    </html>
  );
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden className="drop-shadow-[0_0_10px_rgba(251,146,60,0.35)]">
      <defs>
        <linearGradient id="pick" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fb923c" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <path d="M16 30C9 23 4 16 4 10.5 4 6 8.5 3 16 3s12 3 12 7.5C28 16 23 23 16 30Z" fill="url(#pick)" />
      <path d="M11 11.5h10M11 15.5h10M13 19.5h6" stroke="#07070a" strokeWidth="2" strokeLinecap="round" opacity=".75" />
    </svg>
  );
}
