/**
 * Build-time switches.
 *
 * NEXT_PUBLIC_SHOWCASE=1 builds the public showcase (e.g. on Vercel): the
 * landing page with screenshots and a guide to running PlayAlong on your own
 * computer, but no import, no library and no server routes in use. The full
 * app is what `npm run dev` runs locally.
 *
 * NEXT_PUBLIC_YOUTUBE_IMPORT=off keeps the app but without YouTube links
 * (they need yt-dlp on the server).
 */
export const SHOWCASE = process.env.NEXT_PUBLIC_SHOWCASE === "1";
export const YOUTUBE_IMPORT = !SHOWCASE && process.env.NEXT_PUBLIC_YOUTUBE_IMPORT !== "off";
export const REPO_URL = "https://github.com/simonroedig/PlayAlong";
