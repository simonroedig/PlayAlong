<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## PlayAlong project notes

- Stem separation runs in the browser: `src/lib/separation/` is a TypeScript port of `demucs.apply.apply_model`
  around an ONNX export of htdemucs_6s (STFT/iSTFT done in TS). Keep it numerically identical to PyTorch Demucs —
  change `spectrogram.ts` / `demucs.ts` only with a parity check against reference outputs.
- Chord detection runs in a worker after separation (`src/lib/chords/`): BTC ONNX models (committed in
  `public/models/btc_*.onnx`, rebuilt by `scripts/export_chord_models.py`) on a TS port of `librosa.cqt` — keep
  `cqt.ts` in parity with librosa. Bump `CHORD_ANALYSIS_VERSION` when results change so stored songs are re-analysed.
- Lyrics (`src/lib/lyrics/`) are a TypeScript port of openai-whisper (features, decoding rules, DTW word alignment)
  around sherpa-onnx's int8 Whisper turbo; `scripts/setup.mjs` installs it into `public/models/whisper-turbo/` and
  patches the decoder to output cross-attention. Bump `LYRICS_VERSION` when results change.
- The server only fetches YouTube audio (`src/lib/server/ytdlp.ts`); never pass user input to yt-dlp except a
  validated 11-character video id.
- `scripts/setup.mjs` provides `public/ort/<version>/`, `public/models/htdemucs_6s.onnx`,
  `public/models/whisper-turbo/` and `.bin/yt-dlp` (all git-ignored; the small chord models are committed).
- Pages are cross-origin isolated (COOP/COEP in `next.config.ts`); anything loaded cross-origin must send CORP/CORS.
- Checks: `npm run lint`, `npm run typecheck`, `npm test`.
