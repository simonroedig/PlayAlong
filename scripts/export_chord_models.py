"""Rebuild public/models/btc_majmin.onnx and btc_large.onnx from the original BTC checkpoints.

BTC ("A Bi-Directional Transformer for Musical Chord Recognition", Park et al.,
ISMIR 2019, https://github.com/jayg996/BTC-ISMIR19, MIT licence) ships two
pretrained models: maj/min (25 classes) and a large vocabulary (170 classes:
12 roots x 14 qualities, X, N). Both are committed to this repository; this
script documents how they were made and lets you reproduce them:

    python -m venv .venv && . .venv/bin/activate
    pip install torch numpy pyyaml onnx onnxruntime
    python scripts/export_chord_models.py

Graph:  features [1, 108, 144] -> logits [1, 108, C]
        features = (log(|CQT| + 1e-6) - mean) / std, CQT at 22.05 kHz, hop 2048,
        144 bins, 24 per octave from C1 (see src/lib/chords/analyze.ts for the
        mean / std of each checkpoint).

Weights are stored as float16 and cast to float32 when the session starts
(half the download, no measurable change in the predictions).
"""
import hashlib
import os
import sys
import tempfile
import urllib.request

import numpy as np
import onnx
import onnxruntime as ort
import torch
import torch.nn as nn
import yaml
from onnx import helper, numpy_helper

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = "https://raw.githubusercontent.com/jayg996/BTC-ISMIR19/master/"
FILES = {
    "btc_model.py": None,
    "utils/__init__.py": None,
    "utils/hparams.py": None,
    "utils/transformer_modules.py": None,
    "run_config.yaml": None,
    "test/btc_model.pt": "71c2c5db17e8c43b8a9a9da5db36ef2d667158c07a214eba16344c154c00bf54",
    "test/btc_model_large_voca.pt": "1673d23f8f9a55ae7f9e8b80a51da616debb22675b8d8b67ea6ce0ef37b0ab51",
}
MODELS = [("test/btc_model.pt", 25, "btc_majmin.onnx"), ("test/btc_model_large_voca.pt", 170, "btc_large.onnx")]


def fetch(workdir):
    for rel, sha in FILES.items():
        dest = os.path.join(workdir, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if rel == "utils/__init__.py":
            open(dest, "w").close()
            continue
        with urllib.request.urlopen(REPO + rel) as res:
            data = res.read()
        if sha and hashlib.sha256(data).hexdigest() != sha:
            sys.exit(f"checksum mismatch for {rel}")
        if rel.endswith("transformer_modules.py"):
            data = data.replace(b"astype(np.float)", b"astype(np.float64)")  # removed in NumPy 1.24
        with open(dest, "wb") as f:
            f.write(data)


class Logits(nn.Module):
    """BTC_model.forward without the loss / argmax: logits for every frame."""

    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, features):
        hidden, _ = self.model.self_attn_layers(features)
        return self.model.output_layer.output_projection(hidden)


def half_weights(model):
    """Stores float32 initializers as float16 plus a Cast back to float32."""
    graph = model.graph
    casts, keep, halves = [], [], []
    for init in graph.initializer:
        if init.data_type == onnx.TensorProto.FLOAT and int(np.prod(init.dims)) >= 64:
            arr = numpy_helper.to_array(init).astype(np.float16)
            halves.append(numpy_helper.from_array(arr, init.name + "__fp16"))
            casts.append(helper.make_node("Cast", [init.name + "__fp16"], [init.name], to=onnx.TensorProto.FLOAT))
        else:
            keep.append(init)
    del graph.initializer[:]
    graph.initializer.extend(keep + halves)
    nodes = casts + list(graph.node)
    del graph.node[:]
    graph.node.extend(nodes)
    return model


def main():
    out_dir = os.path.join(ROOT, "public", "models")
    os.makedirs(out_dir, exist_ok=True)
    with tempfile.TemporaryDirectory() as work:
        fetch(work)
        sys.path.insert(0, work)
        from btc_model import BTC_model  # noqa: E402

        config = yaml.safe_load(open(os.path.join(work, "run_config.yaml")))["model"]
        rng = np.random.default_rng(0)
        for checkpoint, classes, name in MODELS:
            config["num_chords"] = classes
            model = BTC_model(config=config).eval()
            ck = torch.load(os.path.join(work, checkpoint), map_location="cpu", weights_only=False)
            model.load_state_dict(ck["model"])
            wrapper = Logits(model).eval()
            tmp = os.path.join(work, name)
            x = torch.randn(1, 108, 144)
            torch.onnx.export(wrapper, (x,), tmp, input_names=["features"], output_names=["logits"],
                              opset_version=17, do_constant_folding=True, dynamo=False)
            path = os.path.join(out_dir, name)
            onnx.save(half_weights(onnx.load(tmp)), path)

            sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
            worst, agree, total = 0.0, 0, 0
            for _ in range(8):
                feats = rng.standard_normal((1, 108, 144)).astype(np.float32)
                with torch.no_grad():
                    ref = wrapper(torch.from_numpy(feats)).numpy()
                got = sess.run(None, {"features": feats})[0]
                worst = max(worst, float(np.abs(got - ref).max()))
                agree += int((got.argmax(-1) == ref.argmax(-1)).sum())
                total += ref.shape[1]
            digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
            print(f"{name}: {os.path.getsize(path) / 1e6:.1f} MB, max |onnx - torch| {worst:.4f}, "
                  f"argmax agreement {100 * agree / total:.1f} %, mean {ck['mean']!r}, std {ck['std']!r}")
            print(f"  sha256 {digest}")


if __name__ == "__main__":
    main()
