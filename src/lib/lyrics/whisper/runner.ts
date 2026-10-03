import type * as OrtModule from "onnxruntime-web";
import type { DecoderOutput, WhisperConfig, WhisperRunner } from "./decoding";

type Ort = Pick<typeof OrtModule, "Tensor">;
type Session = Pick<OrtModule.InferenceSession, "run">;

/**
 * WhisperRunner on two ONNX Runtime sessions with the sherpa-onnx Whisper
 * interface: encoder(mel) → cross-attention K/V per layer; decoder(tokens,
 * self-attention cache, cross K/V, offset) → logits, cache (+ the
 * cross-attention weights exposed by scripts/setup.mjs).
 */
export function createWhisperRunner(
  ort: Ort,
  encoder: Session,
  decoder: Session,
  cfg: WhisperConfig,
  attentionOutputs: string[],
): WhisperRunner {
  const cacheShape = [cfg.nTextLayer, 1, cfg.nTextCtx, cfg.nTextState];
  const emptyCache = () => {
    const zeros = new Float32Array(cfg.nTextLayer * cfg.nTextCtx * cfg.nTextState);
    return { k: new ort.Tensor("float32", zeros, cacheShape), v: new ort.Tensor("float32", zeros, cacheShape) };
  };
  return {
    async encode(mel) {
      return encoder.run({ mel: new ort.Tensor("float32", mel, [1, cfg.nMels, mel.length / cfg.nMels]) });
    },
    async decode(tokens, cache, audio, offset, attention): Promise<DecoderOutput> {
      const cross = audio as Record<string, OrtModule.Tensor>;
      const self = (cache as { k: OrtModule.Tensor; v: OrtModule.Tensor } | null) ?? emptyCache();
      const out = await decoder.run(
        {
          tokens: new ort.Tensor("int64", BigInt64Array.from(tokens, (t) => BigInt(t)), [1, tokens.length]),
          in_n_layer_self_k_cache: self.k,
          in_n_layer_self_v_cache: self.v,
          n_layer_cross_k: cross.n_layer_cross_k,
          n_layer_cross_v: cross.n_layer_cross_v,
          offset: new ort.Tensor("int64", BigInt64Array.from([BigInt(offset)]), [1]),
        },
        ["logits", "out_n_layer_self_k_cache", "out_n_layer_self_v_cache", ...(attention ? attentionOutputs : [])],
      );
      return {
        logits: out.logits.data as Float32Array,
        cache: { k: out.out_n_layer_self_k_cache, v: out.out_n_layer_self_v_cache },
        attention: attention ? attentionOutputs.map((name) => out[name].data as Float32Array) : null,
        frames: attention ? Number(out[attentionOutputs[0]].dims[3]) : 0,
      };
    },
  };
}
