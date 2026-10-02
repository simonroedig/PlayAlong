/**
 * PlayAlong player: mixes the separated stems (interleaved int16) in the
 * audio rendering thread.
 *
 * - per-stem gains with per-block linear ramps (no zipper noise)
 * - short fades on play / pause / seek (no clicks)
 * - gapless A-B loop with a crossfaded seam
 * - tempo change without pitch change (WSOLA) for practising slowly
 *
 * Messages in:  load, play, pause, seek, gains, loop, rate, unload
 * Messages out: tick { frame, playing, peaks }, ended
 */

const PCM = 1 / 16384; // see PCM_SCALE in src/lib/separation/protocol.ts
const REPORT_EVERY = 4; // render quanta between position reports (~12 ms)
const LOOP_XFADE = 1024;

// WSOLA parameters (samples at 44.1 kHz)
const W = 2048; // frame length (46 ms)
const HS = W / 2; // synthesis hop, 50 % overlap of periodic Hann windows sums to 1
const SEARCH = 512; // ± tolerance when looking for the best-aligned frame
const DECIM = 4; // coarse search runs on every 4th sample

class PlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.stems = [];
    this.frames = 0;
    this.pos = 0;
    this.playing = false;
    this.fade = 0; // +1: fade in this quantum, -1: fade out this quantum
    this.pendingSeek = -1;
    this.pauseAfterFade = false;
    this.gains = new Float32Array(8);
    this.target = new Float32Array(8);
    this.peaks = new Float32Array(8);
    this.loopStart = -1;
    this.loopEnd = -1;
    this.rate = 1;
    this.pendingRate = 0;
    this.quanta = 0;
    this.forceReport = false;

    this.idxA = new Int32Array(128);
    this.idxB = new Int32Array(128);
    this.wB = new Float32Array(128);
    this.scratchR = new Float32Array(128);

    this.win = new Float32Array(W);
    for (let i = 0; i < W; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / W);
    this.frameL = new Float32Array(W);
    this.frameR = new Float32Array(W);
    this.tailL = new Float32Array(W - HS);
    this.tailR = new Float32Array(W - HS);
    this.outL = new Float32Array(HS);
    this.outR = new Float32Array(HS);
    this.monoTemplate = new Float32Array(W - HS);
    this.monoRegion = new Float32Array(2 * SEARCH + (W - HS) + DECIM);
    this.resetStretch(0);

    this.port.onmessage = (event) => this.onMessage(event.data);
  }

  onMessage(msg) {
    switch (msg.type) {
      case "load": {
        this.stems = msg.stems;
        this.frames = msg.frames;
        const n = this.stems.length;
        this.gains = new Float32Array(n);
        this.target = new Float32Array(n);
        this.peaks = new Float32Array(n);
        if (msg.gains) {
          this.target.set(msg.gains);
          this.gains.set(msg.gains);
        }
        this.playing = false;
        this.fade = 0;
        this.pendingSeek = -1;
        this.jump(0);
        break;
      }
      case "unload":
        this.stems = [];
        this.frames = 0;
        this.playing = false;
        break;
      case "play":
        if (!this.frames) return;
        if (this.pos >= this.frames) this.jump(this.loopEnd > this.loopStart ? this.loopStart : 0);
        if (!this.playing || this.pauseAfterFade) {
          this.playing = true;
          this.pauseAfterFade = false;
          this.fade = 1;
        }
        break;
      case "pause":
        if (this.playing) {
          this.fade = -1;
          this.pauseAfterFade = true;
        }
        break;
      case "seek": {
        const frame = Math.max(0, Math.min(this.frames, Math.round(msg.frame)));
        if (this.playing && !this.pauseAfterFade) {
          this.pendingSeek = frame;
          this.fade = -1;
        } else {
          this.jump(frame);
        }
        break;
      }
      case "gains":
        for (let i = 0; i < this.target.length; i++) this.target[i] = msg.gains[i] ?? 0;
        break;
      case "loop":
        if (msg.start === null || msg.end === null || msg.end - msg.start < 2048) {
          this.loopStart = -1;
          this.loopEnd = -1;
        } else {
          this.loopStart = Math.max(0, Math.round(msg.start));
          this.loopEnd = Math.min(this.frames, Math.round(msg.end));
        }
        break;
      case "rate": {
        const rate = Math.max(0.25, Math.min(2, msg.rate));
        if (rate === (this.pendingRate || this.rate)) return;
        // Restart at the current position with the new rate, faded like a seek.
        if (this.playing && !this.pauseAfterFade) {
          this.pendingRate = rate;
          if (this.pendingSeek < 0) this.pendingSeek = this.position();
          this.fade = -1;
        } else {
          const frame = this.position();
          this.rate = rate;
          this.jump(frame);
        }
        break;
      }
    }
  }

  position() {
    return this.rate === 1 ? this.pos : Math.min(this.frames, this.outBase + this.outRead);
  }

  jump(frame) {
    this.pos = frame;
    this.resetStretch(frame);
    this.forceReport = true;
  }

  resetStretch(frame) {
    this.anaPos = frame;
    this.prevActual = -1;
    // The output buffer is empty; `outBase + outRead` is the source position
    // of the next sample played.
    this.outBase = frame;
    this.outRead = 0;
    this.outAvail = 0;
    this.tailL.fill(0);
    this.tailR.fill(0);
  }

  loopActive() {
    return this.loopStart >= 0 && this.loopEnd > this.loopStart;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out.length > 1 ? out[1] : this.scratchR;
    const n = L.length;
    if (!this.playing || this.frames === 0) {
      L.fill(0);
      R.fill(0);
      this.report();
      return true;
    }

    const rendered = this.rate === 1 ? this.renderDirect(L, R, n) : this.renderStretched(L, R, n);

    if (this.fade !== 0) {
      for (let i = 0; i < n; i++) {
        const g = this.fade > 0 ? i / n : 1 - i / n;
        L[i] *= g;
        R[i] *= g;
      }
      if (this.fade < 0) {
        this.fade = 0;
        if (this.pauseAfterFade) {
          this.playing = false;
          this.pauseAfterFade = false;
          this.forceReport = true;
        }
        if (this.pendingRate) {
          this.rate = this.pendingRate;
          this.pendingRate = 0;
        }
        if (this.pendingSeek >= 0) {
          this.jump(this.pendingSeek);
          this.pendingSeek = -1;
          if (this.playing) this.fade = 1;
        }
      } else {
        this.fade = 0;
      }
    }

    if (!rendered) {
      this.playing = false;
      this.forceReport = true;
      this.port.postMessage({ type: "ended" });
    }
    this.report();
    return true;
  }

  /** rate === 1: straight mix, loop seam crossfaded. Returns false at the end of the track. */
  renderDirect(L, R, n) {
    const { idxA, idxB, wB } = this;
    const loop = this.loopActive();
    const xf = loop ? Math.min(LOOP_XFADE, this.loopStart, Math.floor((this.loopEnd - this.loopStart) / 2)) : 0;
    let pos = this.pos;
    let count = n;
    for (let i = 0; i < n; i++) {
      if (loop && pos === this.loopEnd) pos = this.loopStart;
      if (pos >= this.frames) {
        count = i;
        break;
      }
      idxA[i] = pos;
      if (xf > 0 && pos < this.loopEnd && pos >= this.loopEnd - xf) {
        const d = this.loopEnd - pos;
        idxB[i] = this.loopStart - d;
        wB[i] = 1 - d / xf;
      } else {
        idxB[i] = -1;
      }
      pos++;
    }
    this.pos = pos;

    L.fill(0);
    R.fill(0);
    for (let s = 0; s < this.stems.length; s++) {
      const data = this.stems[s];
      const g0 = this.gains[s];
      const g1 = this.target[s];
      const step = (g1 - g0) / n;
      let g = g0;
      let peak = this.peaks[s];
      for (let i = 0; i < count; i++) {
        g += step;
        const a = idxA[i] * 2;
        let l = data[a];
        let r = data[a + 1];
        const b = idxB[i];
        if (b >= 0) {
          const w = wB[i];
          l += (data[b * 2] - l) * w;
          r += (data[b * 2 + 1] - r) * w;
        }
        const al = l < 0 ? -l : l;
        const ar = r < 0 ? -r : r;
        if (al > peak) peak = al;
        if (ar > peak) peak = ar;
        const k = g * PCM;
        L[i] += l * k;
        R[i] += r * k;
      }
      this.peaks[s] = peak;
      this.gains[s] = g1;
    }
    return count === n;
  }

  /** rate !== 1: WSOLA time stretch of the mix. */
  renderStretched(L, R, n) {
    let i = 0;
    while (i < n) {
      if (this.outRead >= this.outAvail && !this.synthesize()) {
        L.fill(0, i);
        R.fill(0, i);
        this.pos = this.frames;
        return false;
      }
      const take = Math.min(n - i, this.outAvail - this.outRead);
      L.set(this.outL.subarray(this.outRead, this.outRead + take), i);
      R.set(this.outR.subarray(this.outRead, this.outRead + take), i);
      this.outRead += take;
      i += take;
    }
    this.pos = this.position();
    return true;
  }

  synthesize() {
    const prevAna = this.anaPos - HS * this.rate;
    if (this.loopActive() && prevAna < this.loopEnd && this.anaPos >= this.loopEnd) {
      this.anaPos = this.loopStart + (this.anaPos - this.loopEnd);
      this.prevActual = -1;
    }
    if (this.anaPos >= this.frames) return false;
    const nominal = Math.round(this.anaPos);
    const actual = this.prevActual >= 0 ? this.bestAlignment(this.prevActual + HS, nominal) : nominal;

    const { frameL, frameR, win, tailL, tailR, outL, outR } = this;
    this.mixRange(actual, W, frameL, frameR, true);
    for (let j = 0; j < W; j++) {
      frameL[j] *= win[j];
      frameR[j] *= win[j];
    }
    for (let j = 0; j < HS; j++) {
      outL[j] = tailL[j] + frameL[j];
      outR[j] = tailR[j] + frameR[j];
    }
    tailL.set(frameL.subarray(HS));
    tailR.set(frameR.subarray(HS));
    this.prevActual = actual;
    this.outBase = actual;
    this.outRead = 0;
    this.outAvail = HS;
    this.anaPos += HS * this.rate;
    for (let s = 0; s < this.gains.length; s++) this.gains[s] = this.target[s];
    return true;
  }

  /**
   * Finds the frame start near `nominal` whose first W-HS samples best match
   * the natural continuation of the previous frame (normalized
   * cross-correlation, coarse on decimated data, then refined).
   */
  bestAlignment(natural, nominal) {
    const ov = W - HS;
    const tmpl = this.monoTemplate;
    this.mixMono(natural, ov, 1, tmpl);
    const region = this.monoRegion;
    const regionStart = nominal - SEARCH;
    const regionLen = 2 * SEARCH + ov;
    this.mixMono(regionStart, regionLen, 1, region);

    // Offset SEARCH is the nominal position; it wins unless something
    // correlates positively (e.g. everything muted).
    let best = SEARCH;
    let bestScore = 0;
    // Coarse pass.
    for (let c = 0; c <= 2 * SEARCH; c += DECIM) {
      let dot = 0;
      let energy = 1e-9;
      for (let j = 0; j < ov; j += DECIM) {
        const x = region[c + j];
        dot += tmpl[j] * x;
        energy += x * x;
      }
      const score = dot / Math.sqrt(energy);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    // Fine pass around the coarse winner.
    const lo = Math.max(0, best - DECIM + 1);
    const hi = Math.min(2 * SEARCH, best + DECIM - 1);
    bestScore = -Infinity;
    let fine = best;
    for (let c = lo; c <= hi; c++) {
      let dot = 0;
      let energy = 1e-9;
      for (let j = 0; j < ov; j++) {
        const x = region[c + j];
        dot += tmpl[j] * x;
        energy += x * x;
      }
      const score = dot / Math.sqrt(energy);
      if (score > bestScore) {
        bestScore = score;
        fine = c;
      }
    }
    return regionStart + fine;
  }

  /** Mono mix (with current gains) of `len` samples from `start`, zero outside the track. */
  mixMono(start, len, step, dst) {
    dst.fill(0, 0, len);
    const lo = Math.max(0, start);
    const hi = Math.min(this.frames, start + len);
    for (let s = 0; s < this.stems.length; s++) {
      const g = this.target[s] * PCM * 0.5;
      if (g === 0) continue;
      const data = this.stems[s];
      for (let p = lo; p < hi; p += step) dst[p - start] += (data[p * 2] + data[p * 2 + 1]) * g;
    }
  }

  /** Stereo mix (with current gains) of `len` samples from `start`, zero outside the track. */
  mixRange(start, len, dstL, dstR, meter) {
    dstL.fill(0, 0, len);
    dstR.fill(0, 0, len);
    const lo = Math.max(0, start);
    const hi = Math.min(this.frames, start + len);
    for (let s = 0; s < this.stems.length; s++) {
      const data = this.stems[s];
      const k = this.target[s] * PCM;
      let peak = this.peaks[s];
      for (let p = lo; p < hi; p++) {
        const l = data[p * 2];
        const r = data[p * 2 + 1];
        if (meter) {
          const al = l < 0 ? -l : l;
          const ar = r < 0 ? -r : r;
          if (al > peak) peak = al;
          if (ar > peak) peak = ar;
        }
        dstL[p - start] += l * k;
        dstR[p - start] += r * k;
      }
      this.peaks[s] = peak;
    }
  }

  report() {
    this.quanta++;
    if (!this.forceReport && this.quanta % REPORT_EVERY !== 0) return;
    this.forceReport = false;
    const peaks = new Array(this.peaks.length);
    for (let s = 0; s < this.peaks.length; s++) peaks[s] = this.peaks[s] * PCM;
    this.peaks.fill(0);
    this.port.postMessage({ type: "tick", frame: this.position(), playing: this.playing, peaks });
  }
}

registerProcessor("playalong-player", PlayerProcessor);
