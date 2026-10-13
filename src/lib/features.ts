/**
 * Build-time switches. YouTube import needs yt-dlp on the server, so a hosted
 * copy that only serves the app (e.g. on Vercel) turns it off with
 * NEXT_PUBLIC_YOUTUBE_IMPORT=off: the page then offers file upload only and
 * the YouTube routes answer 404.
 */
export const YOUTUBE_IMPORT = process.env.NEXT_PUBLIC_YOUTUBE_IMPORT !== "off";
