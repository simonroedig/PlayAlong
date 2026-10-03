# PlayAlong

**Paste a YouTube link, strip out the guitar or the bass, and play along.**

PlayAlong downloads a song's audio, splits it into six instrument stems — guitar, bass, drums, vocals, keys and
"other" — **inside your browser**, and gives you a practice player where you can remove the guitar or the bass
completely and take over the part yourself.

- **One-click practice modes:** _No guitar_, _No bass_, _Full mix_, _Guitar only_, _Bass only_ (to learn a part).
- **Six-stem mixer:** mute, solo and volume per instrument, with live level meters.
- **Chords:** detected automatically from the separated stems — a bar-by-bar chord chart that follows the music,
  the chord now and next with a beat counter, key, tempo and the recording's tuning (e.g. "tune to A = 432 Hz").
  Shows the shapes to play with a capo or a down-tuned guitar; simple (triads) or full (7ths, sus, slash chords).
- **Practice tools:** drag across the waveform (or Shift+click bars in the chord chart) to loop a passage, slow it down
  to 50 % without changing the pitch, keyboard shortcuts for everything.
- **Local-first:** separation runs on your GPU via WebGPU (CPU fallback via WebAssembly). Songs and stems are stored in
  your browser (IndexedDB) and open instantly next time. Nothing is uploaded anywhere.
- **Export:** download the current mix (e.g. your backing track) or any single stem as WAV.
- Works with local audio files too (MP3, M4A, WAV, FLAC, OGG…).

## Quick start

Requirements: **Node.js 22+** and a recent desktop browser (Chrome / Edge 121+ for WebGPU; Firefox and Safari work too —
separation then uses WebGPU where the browser supports it, otherwise the CPU).

```bash
npm install
npm run dev        # first run downloads the model (~115 MB) and yt-dlp, then starts http://localhost:3000
```

Open http://localhost:3000, paste a YouTube link, press **Separate**, and pick **No guitar** or **No bass**.

For a production build: `npm run build && npm start`.

## How it works

```
 Browser                                                            Next.js server (thin)
 ───────────────────────────────────────────────────────────────    ─────────────────────────────
 paste link ──► POST /api/youtube ─────────────────────────────────► yt-dlp: best audio-only stream
           ◄── NDJSON progress (title, bytes)                        └─► .cache/youtube/<id>.m4a
 GET /api/youtube/<id>/audio ◄──────────────────────────────────────  (that's all the server does)

 decodeAudioData → 44.1 kHz stereo
   └─► Web Worker: ONNX Runtime Web (WebGPU → WASM fallback)
         for each 7.8 s segment (25 % overlap):
           STFT (TypeScript) → htdemucs_6s ONNX core → iSTFT + time branch → cross-fade
   └─► 6 stems (int16, SharedArrayBuffer) → IndexedDB
         ├─► AudioWorklet player: per-stem gains, gapless loop, WSOLA time-stretch
         └─► Web Worker: chord detection (a few seconds, ONNX Runtime Web on the CPU)
               guitar + keys + other + bass ──► CQT ─┐
               full mix (all stems) ────────► CQT ─┴► BTC chord transformers (maj/min + 170-chord vocabulary)
               drums (+ bass, harmony) ──► onsets → tempo → beats → bar lines
               bass stem ──► bass notes (subharmonic summation)
               └─► per-beat chord probabilities → repeated passages vote → key → metre-aware Viterbi
                   (changes on beats, mostly on bar lines; bass-aware) → 7ths / sus / slash chords only
                   when clearly supported → chart with confidence → IndexedDB
```

- **Separation model:** [Demucs v4](https://github.com/facebookresearch/demucs) `htdemucs_6s` (Hybrid Transformer
  Demucs, 6 sources), exported to ONNX **without** its STFT/iSTFT. The spectral transforms, the segmenting and the
  overlap-add are a TypeScript port of `demucs.apply.apply_model` (`src/lib/separation/`), verified against the
  original PyTorch implementation (see [Verification](#verification)).
- **Why STFT outside the graph?** It keeps the model at 115 MB instead of 250 MB+ (no DFT matrices baked in) and avoids
  ops that ONNX Runtime's WebGPU backend cannot run.
- **Runtime:** [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) 1.30 with its native WebGPU execution
  provider; if WebGPU is missing or fails mid-way, the same segment is re-run on the multi-threaded WASM backend.
- **Cross-origin isolation** (`COOP`/`COEP` headers in `next.config.ts`) enables `SharedArrayBuffer`: WASM threads for
  the CPU fallback, and zero-copy stem sharing between worker, page and audio thread.
- **Chord detection** (`src/lib/chords/`): the recognisers are the two pretrained
  [BTC](https://github.com/jayg996/BTC-ISMIR19) models (Bi-directional Transformer for Chord recognition, Park et al.,
  ISMIR 2019, MIT licence; 7 MB each with 16-bit weights, shipped in `public/models/`). Everything around them is
  TypeScript: a port of `librosa.cqt` (the models' input feature), tuning estimation, a dynamic-programming beat tracker
  (Ellis 2007, as in librosa) fed with the separated drums, bar/metre detection from kick, snare and harmonic change,
  bass-note detection on the bass stem, repetition voting across verses and choruses, key estimation and a
  beat-synchronous Viterbi decoder. Chords appear a few seconds after the separation finishes and are stored with the
  song; songs separated earlier get their chords the next time they are opened.
- **YouTube:** the browser cannot fetch YouTube media itself (CORS, signatures), so a small route handler runs
  [yt-dlp](https://github.com/yt-dlp/yt-dlp) (official standalone build, using this server's Node as the JavaScript
  runtime it now needs for YouTube). Only canonical watch URLs built from a validated video id are passed to it.

## Research notes: choosing the separation approach (October 2026)

| Option | Stems | Size | Where it can run | Verdict |
| --- | --- | --- | --- | --- |
| **Demucs v4 `htdemucs_6s`** (Meta) | drums, bass, other, vocals, **guitar**, piano | 27 M params / 115 MB | Browser (ONNX Runtime Web: WebGPU or WASM), CPU servers | **Used.** The only openly available 6-stem model light enough for the browser; bass quality is strong, guitar is good, piano weakest. |
| BS-RoFormer SW (community, 2025) | 6 incl. guitar | ~700 MB | GPU server (python-audio-separator, MVSEP, UVR) | Best open 6-stem quality today, but far too heavy for in-browser use. Natural "HQ server mode" upgrade. |
| Mel-/BS-RoFormer single-stem models | 1 per model | 200–900 MB each | GPU server | SOTA for vocals/instrumental; not built for guitar/bass removal. |
| Meta SAM Audio (Dec 2025) | text-prompted ("electric guitar") | billions of params | Datacenter GPU | Very flexible but impractical for a lightweight app. |
| Demucs `htdemucs` / `htdemucs_ft` (4 stems) | no guitar stem | 84 MB / 4×84 MB | Browser / server | Can remove bass but not guitar. |
| Spleeter (2019) | max 5, no guitar | — | TF.js | Outdated quality. |

Browser runtimes considered: **ONNX Runtime Web** (chosen: mature, WebGPU + WASM in one package), demucs.cpp compiled to
WebAssembly (CPU only, ~5–7 min per song), and a Rust/Burn port running on WebGPU (promising, but needs a Rust
toolchain to build and ships its own format).

### Chord recognition

Chord recognisers learned from annotated songs are far better than template matching on a chromagram, but on their own
they still trip over passing bass notes, melody notes, drums and fills, and they produce a "flickering" sequence that
is hard to read while playing. PlayAlong therefore wraps a compact, openly licensed recogniser in music-aware
post-processing that uses what the separation already provides:

| Step | Why |
| --- | --- |
| Recogniser hears the **harmonic stems** (guitar, keys, other, bass) **and the full mix**, probabilities averaged | Without drums and vocals the harmony is cleaner; the full mix is what the model was trained on. Averaging both views hedges against separation artefacts. |
| **Beats from the drum stem**, bar lines from kick/snare and harmonic change | Chords are decided per beat and change on beats — mostly on the bar line, sometimes on the half bar. One-beat blips and anticipations snap to the grid. |
| **Bass stem evaluated separately** | Favours chords whose root the bass plays; a slash chord (e.g. D/F♯) is only written when the bass *holds* a chord tone, so passing notes don't create chords. |
| **Repeated passages vote** | Each beat is compared with the same bar position in similar passages (verse 1 vs verse 2, every chorus); one-off errors are outvoted, repeats get the same chords. |
| **Key prior** | Diatonic chords (and common borrowed ones like ♭VII or the minor iv) are preferred over unlikely ones at equal evidence. |
| **Large-vocabulary model only refines** | 7ths, maj7, sus etc. are added only when that model clearly prefers them over the plain triad; the triad decision itself is robust. |
| **Confidence per chord** | Shown greyed when uncertain, so you know which chords to check by ear. |

Recognisers considered: **BTC** (used — maj/min and a 170-chord vocabulary, ~3 M parameters, fast enough for the
browser, MIT), CNN/CRNN models in madmom (good, but the pretrained weights are non-commercial), large-vocabulary
CNN-LSTM and Conformer models from recent research (heavier, often without usable weights or licence), and classic
chroma-template systems such as Chordino (no training data needed, noticeably less accurate).

## Configuration

All optional — set in `.env.local`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `YTDLP_COOKIES_FROM_BROWSER` | – | e.g. `chrome`, `firefox`: lets yt-dlp use your browser's YouTube session when YouTube asks to "confirm you're not a bot". |
| `YTDLP_COOKIES` | – | Path to a Netscape cookies file (alternative to the above). |
| `YTDLP_PATH` | `.bin/yt-dlp`, then `yt-dlp` on `PATH` | Use your own yt-dlp binary. |
| `YTDLP_EXTRA_ARGS` | – | Extra yt-dlp flags (space separated). |
| `PLAYALONG_MAX_DURATION_MIN` | `15` | Reject longer YouTube videos (separation needs ~85 MB of RAM per minute). |
| `PLAYALONG_CACHE_DIR` | `.cache/youtube` | Server-side audio cache (last 40 downloads are kept). |
| `NEXT_PUBLIC_MODEL_URL` | `/models/htdemucs_6s.onnx` | Load the model from a CDN instead (must send CORS headers). |
| `NEXT_PUBLIC_MODEL_SHA256` | pinned hash of the default model | Checksum the browser verifies after downloading the model. |
| `PLAYALONG_SKIP_DOWNLOADS` | – | `1` skips the model / yt-dlp downloads in `scripts/setup.mjs` (CI). |

`npm run setup -- --update` updates yt-dlp (it also checks for updates weekly) — YouTube changes often, so this is the
first thing to try when downloads start failing. Behind a corporate proxy, run setup with `NODE_USE_ENV_PROXY=1`.

### Rebuilding the model from Meta's original weights

`npm run setup` downloads a prebuilt, checksum-pinned ONNX export. To produce it yourself from the official checkpoint:

```bash
python -m venv .venv && . .venv/bin/activate
pip install torch demucs==4.0.1 onnx onnxruntime
python scripts/export_model.py     # writes public/models/htdemucs_6s.onnx and its checksum to .env.local
```

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` / `→` | Skip 5 s (`Shift`: 1 s) |
| `Home` | Back to start (or loop start) |
| `1`–`5` | No guitar · No bass · Full mix · Guitar only · Bass only |
| `G` / `B` | Mute / unmute guitar / bass |
| `L` | Loop on/off (creates an 8 s loop at the playhead if none) |
| `[` / `]` | Set loop start / end at the playhead |
| `-` / `+` | Slower / faster (50–125 %) |

## Project layout

```
scripts/setup.mjs                 copies ONNX Runtime into public/ort, downloads model + yt-dlp
scripts/export_model.py           rebuilds the ONNX model from Meta's weights
scripts/export_chord_models.py    rebuilds public/models/btc_*.onnx from the original BTC checkpoints
public/worklets/player-processor.js   AudioWorklet: mixing, loop, WSOLA time-stretch
src/app/                          pages (home, /song/[id]) and API routes (/api/youtube, /api/health)
src/components/                   UI (import box, library, processing view, player, mixer, waveform)
src/lib/separation/               model contract, STFT/iSTFT, apply_model port, worker + client
src/lib/chords/                   chord detection: CQT, beats, tuning, bass, decoding, chart helpers, worker + client
src/lib/onnx/runtime.ts           ONNX Runtime loading and model caching shared by both workers
src/lib/audio/                    decoding, player engine, waveform envelopes, WAV export
src/lib/storage/library.ts        IndexedDB song library
src/lib/server/ytdlp.ts           yt-dlp wrapper with progress + cache
```

## Development

```bash
npm run dev         # dev server (Turbopack)
npm test            # unit tests (Vitest): FFT, STFT/iSTFT, segmenting, mixer, URL parsing, AudioWorklet, chord pipeline
npm run lint        # ESLint
npm run typecheck   # TypeScript
```

## Verification

- **Separation parity:** the TypeScript pipeline (STFT → ONNX core → iSTFT → overlap-add) was compared with the
  official `demucs.apply.apply_model` (PyTorch) on the Demucs test clip and on a synthetic drums/bass/guitar mix:
  max abs difference 8·10⁻⁵ (≥ 77 dB SNR per stem) with ONNX Runtime on Node. End-to-end in Chromium, after the
  16-bit storage step, the stems carrying signal match the reference at 52–70 dB SNR on the CPU (WebAssembly) path and
  69–75 dB on the WebGPU path.
- **Model sanity:** on the synthetic mix the model puts the bass line in _bass_ (13.7 dB SDR), drums in _drums_
  (13.8 dB) and the distorted power chords in _guitar_ (7.2 dB).
- **Browser end-to-end** (headless Chromium): file import → model download → separation on WASM and on WebGPU
  (software adapter) → playback, practice modes, keyboard shortcuts, drag-to-loop, tempo change and WAV export.
- **Chord detection:** the TypeScript CQT matches `librosa.cqt` (mean |Δ log magnitude| 0.0002) and the ONNX models match
  the original PyTorch BTC (100 % identical predictions, max logit difference 0.01 — also after the 16-bit weight
  conversion). Accuracy was measured with `mir_eval` on 24 synthetic multitrack songs (45 min, SoundFont instruments:
  strummed / picked / power-chord guitars, piano, organ, pads, bass lines with passing notes, drums, a sung-style
  melody; 7th, sus and slash chords, borrowed chords, pushed changes, 3/4 songs, songs without drums, recordings tuned
  up to ±45 cents off), separated with the app's Demucs pipeline:

  | Duration-weighted accuracy | root | maj/min | maj/min + inversions | sevenths |
  | --- | --- | --- | --- | --- |
  | BTC alone on the full mix (frame by frame) | 95.6 % | 95.4 % | 90.3 % | 90.0 % |
  | PlayAlong, ideal stems | 97.3 % | 97.0 % | 94.3 % | 93.6 % |
  | **PlayAlong, Demucs stems (what the app does)** | **96.5 %** | **95.9 %** | **94.2 %** | **92.7 %** |

  Key 24/24, metre (3/4 vs 4/4) 24/24, beat F-measure 98 %, downbeats 97 %, tuning within 2 cents. Chords with a
  confidence ≥ 0.9 (80 % of the time) were right 99 % of the time, those below 0.6 (shown grey) only about half. On
  these songs, feeding the recogniser the harmonic stems instead of the mix made no measurable difference (±0.3 %);
  the gains come from the beat, bass, repetition and key modelling. Synthetic songs are much cleaner than real
  productions, so expect lower numbers on real recordings — no annotated real audio was available in the build
  environment.
- **Browser end-to-end** (chords): after the separation, chords were ready in 5–8 s for 1.5-minute songs (CPU,
  headless Chromium), matched the Node results, and the chart, now/next display, capo and tuning transposition,
  bar-click seeking, Shift+click looping and reloading from the library were exercised.
- **YouTube route:** exercised with a stand-in yt-dlp process, since the build sandbox has no access to YouTube:
  progress streaming, caching, error messages (unavailable video, bot check, too long), Opus/AAC format negotiation
  and the browser flow from pasted link to player. The real yt-dlp 2026.08.19 binary was checked against the exact
  command line the server uses.

## Notes & limitations

- Separation quality depends on the mix: dense, heavily distorted guitars or doubled bass/synth parts can leave some
  bleed. Bass removal is generally cleaner than guitar removal.
- Memory: a separated 4-minute song needs about 250 MB of RAM and the same in browser storage, so tracks are limited
  to 15 minutes. Delete songs you no longer need from the library.
- Open the app via `localhost` or HTTPS: browsers disable AudioWorklet, WebGPU and Web Crypto on plain-HTTP network
  addresses (the app shows a notice if that happens).
- On the CPU fallback, separation takes roughly 1–2× the song's length on a modern laptop; with WebGPU it is
  typically faster than real time.
- Chord detection is a starting point, not a verified chord sheet: it simplifies (e.g. add9 becomes a triad), snaps
  chords to beats, may label inversions or power chords (no third) differently than a transcriber, and fast tempos
  without drums can be counted at double speed. Grey chords are the ones it is unsure about.
- Download only content you have the right to use. The Demucs code is MIT licensed; the pretrained weights were
  published by Meta for research use — check their terms before any commercial use. The BTC chord models are MIT
  licensed (see `public/models/BTC-LICENSE.txt`).
