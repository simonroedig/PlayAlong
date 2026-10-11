import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { EngineBadge } from "@/components/EngineBadge";
import { EnvironmentNotice } from "@/components/EnvironmentNotice";
import { FolderStatus } from "@/components/FolderStatus";
import { Logo } from "@/components/Logo";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "PlayAlong: play the missing part of any song", template: "%s · PlayAlong" },
  description:
    "Drop in a song and PlayAlong splits it into its instruments, writes out the chords and lyrics, and lets you switch any part off to play it yourself.",
};

export const viewport: Viewport = {
  themeColor: "#07070a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Browser extensions add classes and attributes to <html> and <body> before React hydrates.
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col font-sans" suppressHydrationWarning>
        <header className="sticky top-0 z-30 border-b border-white/5 bg-ink-950/75 backdrop-blur-xl">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2.5" aria-label="PlayAlong home">
              <Logo />
              <span className="text-[15px] font-semibold tracking-tight text-zinc-50">PlayAlong</span>
            </Link>
            <div className="flex items-center gap-2">
              <FolderStatus />
              <EngineBadge />
            </div>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-16 sm:px-6">
          <EnvironmentNotice />
          {children}
        </main>
        <footer className="border-t border-white/5 py-6 text-center text-xs text-zinc-500">
          Separation, chords and lyrics are computed on your own device. Your songs stay with you.
        </footer>
      </body>
    </html>
  );
}
