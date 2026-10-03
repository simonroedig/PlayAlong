import type { BtcModel } from "./analyze";

/**
 * BTC chord recognisers (Park et al., "A Bi-Directional Transformer for
 * Musical Chord Recognition", ISMIR 2019; MIT licence), exported to ONNX by
 * scripts/export_chord_models.py with 16-bit weights.
 */
export const CHORD_MODELS: Record<BtcModel, { url: string; sha256: string }> = {
  majmin: { url: "/models/btc_majmin.onnx", sha256: "08ec7bc1411e115f6e89131669f274bfa4f7429a7a76223e07f00d35d5fb0248" },
  large: { url: "/models/btc_large.onnx", sha256: "abb8aff00b4ed0064cd52c6dd519291f559a9137bbf3cd7d48782546642880d4" },
};

export const CHORD_MODEL_LABEL = "BTC chord transformer";
