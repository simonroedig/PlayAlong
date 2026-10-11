import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { EngineBadge } from "@/components/EngineBadge";
import { EnvironmentNotice } from "@/components/EnvironmentNotice";
import { FolderStatus } from "@/components/FolderStatus";
import { BrandMark } from "@/components/Logo";
import { SiteFooter } from "@/components/SiteFooter";
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
        <header className="relative z-30">
          <div className="mx-auto grid w-full max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 pt-4 pb-2 sm:px-6">
            <div className="justify-self-start">
              <FolderStatus />
            </div>
            <Link href="/" aria-label="PlayAlong home" className="justify-self-center transition hover:opacity-90">
              <BrandMark className="h-[80px] w-[117px] sm:h-[96px] sm:w-[140px]" />
            </Link>
            <div className="justify-self-end">
              <EngineBadge />
            </div>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-16 sm:px-6">
          <EnvironmentNotice />
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
