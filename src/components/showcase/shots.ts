/**
 * Screenshots of the real app for the showcase and the README (public/showcase/).
 * Taken with a synthetic test song; width and height are the files' pixel sizes.
 */
export const SHOTS = {
  hero: {
    src: "/showcase/hero.webp",
    alt: "A song in PlayAlong: practice modes with the guitar switched off, the waveform of all instruments and the chord timeline",
    width: 2000,
    height: 1232,
  },
  import: {
    src: "/showcase/import.webp",
    alt: "Adding a song: a field for a YouTube link and a drop zone for audio files",
    width: 1792,
    height: 516,
  },
  player: {
    src: "/showcase/player.webp",
    alt: "Practice modes (guitar or bass without or only, vocals on or off) and the six instrument tracks with their faders",
    width: 2000,
    height: 768,
  },
  chart: {
    src: "/showcase/chart.webp",
    alt: "The chord chart: key and tempo, the chord now and next with a beat counter, and the chords bar by bar",
    width: 2000,
    height: 1207,
  },
  lyrics: {
    src: "/showcase/lyrics.webp",
    alt: "The lyrics with the chords above the words, following the song",
    width: 2000,
    height: 895,
  },
  separating: {
    src: "/showcase/separating.webp",
    alt: "The song being taken apart: one row of blocks per instrument filling up",
    width: 2000,
    height: 730,
  },
} as const;
