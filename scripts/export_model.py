"""Rebuild public/models/htdemucs_6s.onnx from Meta's official Demucs weights.

`npm run setup` downloads a prebuilt copy of this model. Use this script if you
prefer to produce it yourself from the original checkpoint:

    python -m venv .venv && . .venv/bin/activate
    pip install torch demucs==4.0.1 onnx onnxruntime
    python scripts/export_model.py

The ONNX graph contains the Demucs network *without* its STFT / iSTFT (the
browser computes those, see src/lib/separation/spectrogram.ts):

    mix  [1, 2, 343980]         normalized stereo segment (7.8 s at 44.1 kHz)
    spec [1, 4, 2048, 336]      complex-as-channels STFT of `mix`
 -> spec_out [1, 6, 4, 2048, 336], time_out [1, 6, 2, 343980]  (de-normalized)

The script checks the exported graph against the original PyTorch model and
writes the file's SHA-256 to .env.local so the app accepts the new file.
"""
import argparse
import hashlib
import os
import sys

import torch
from demucs.pretrained import get_model


class Core(torch.nn.Module):
    """HTDemucs.forward (demucs 4.0.1) between _magnitude and _mask."""

    def __init__(self, model):
        super().__init__()
        self.m = model

    def forward(self, mix, spec):
        m = self.m
        x = spec
        B, C, Fq, T = x.shape
        mean = x.mean(dim=(1, 2, 3), keepdim=True)
        std = x.std(dim=(1, 2, 3), keepdim=True)
        x = (x - mean) / (1e-5 + std)
        xt = mix
        meant = xt.mean(dim=(1, 2), keepdim=True)
        stdt = xt.std(dim=(1, 2), keepdim=True)
        xt = (xt - meant) / (1e-5 + stdt)

        saved, saved_t, lengths, lengths_t = [], [], [], []
        for idx, encode in enumerate(m.encoder):
            lengths.append(x.shape[-1])
            inject = None
            if idx < len(m.tencoder):
                lengths_t.append(xt.shape[-1])
                tenc = m.tencoder[idx]
                xt = tenc(xt)
                if not tenc.empty:
                    saved_t.append(xt)
                else:
                    inject = xt
            x = encode(x, inject)
            if idx == 0 and m.freq_emb is not None:
                frs = torch.arange(x.shape[-2], device=x.device)
                emb = m.freq_emb(frs).t()[None, :, :, None].expand_as(x)
                x = x + m.freq_emb_scale * emb
            saved.append(x)

        if m.crosstransformer:
            if m.bottom_channels:
                b, c, f, t = x.shape
                x = m.channel_upsampler(x.reshape(b, c, f * t)).reshape(b, -1, f, t)
                xt = m.channel_upsampler_t(xt)
            x, xt = m.crosstransformer(x, xt)
            if m.bottom_channels:
                b, c, f, t = x.shape
                x = m.channel_downsampler(x.reshape(b, c, f * t)).reshape(b, -1, f, t)
                xt = m.channel_downsampler_t(xt)

        for idx, decode in enumerate(m.decoder):
            skip = saved.pop(-1)
            x, pre = decode(x, skip, lengths.pop(-1))
            offset = m.depth - len(m.tdecoder)
            if idx >= offset:
                tdec = m.tdecoder[idx - offset]
                length_t = lengths_t.pop(-1)
                if tdec.empty:
                    xt, _ = tdec(pre[:, :, 0], None, length_t)
                else:
                    xt, _ = tdec(xt, saved_t.pop(-1), length_t)

        S = len(m.sources)
        x = x.view(B, S, -1, Fq, T) * std[:, None] + mean[:, None]
        xt = xt.view(B, S, -1, mix.shape[-1]) * stdt[:, None] + meant[:, None]
        return x, xt


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("output", nargs="?", default="public/models/htdemucs_6s.onnx")
    parser.add_argument("--model", default="htdemucs_6s", help="pretrained demucs model name")
    parser.add_argument("--no-env", action="store_true", help="do not write NEXT_PUBLIC_MODEL_SHA256 to .env.local")
    args = parser.parse_args()

    bag = get_model(args.model)
    if len(bag.models) != 1:
        sys.exit(f"{args.model} is a bag of {len(bag.models)} models; only single models are supported")
    model = bag.models[0].eval()
    segment = int(model.segment * model.samplerate)
    print(f"{args.model}: sources {model.sources}, segment {segment} samples")

    core = Core(model).eval()
    mix = torch.randn(1, 2, segment)
    with torch.no_grad():
        z = model._spec(mix)
        spec = model._magnitude(z)
        reference = model(mix)
        x, xt = core(mix, spec)
        rebuilt = model._ispec(model._mask(z, x), segment) + xt
    print("split model vs original, max abs diff:", float((rebuilt - reference).abs().max()))

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    export_args = dict(
        input_names=["mix", "spec"],
        output_names=["spec_out", "time_out"],
        opset_version=17,
        do_constant_folding=True,
    )
    try:
        # Newer torch defaults to the dynamo exporter; the TorchScript one is what this was validated with.
        torch.onnx.export(core, (mix, spec), args.output, dynamo=False, **export_args)
    except TypeError:
        torch.onnx.export(core, (mix, spec), args.output, **export_args)

    import onnxruntime as ort

    session = ort.InferenceSession(args.output, providers=["CPUExecutionProvider"])
    spec_out, time_out = session.run(None, {"mix": mix.numpy(), "spec": spec.numpy()})
    print(
        "onnx vs torch, max abs diff: spec_out",
        float(abs(spec_out - x.numpy()).max()),
        "time_out",
        float(abs(time_out - xt.numpy()).max()),
    )

    digest = hashlib.sha256(open(args.output, "rb").read()).hexdigest()
    print(f"wrote {args.output} ({os.path.getsize(args.output) / 1e6:.1f} MB, sha256 {digest})")
    if not args.no_env:
        lines = []
        if os.path.exists(".env.local"):
            lines = [l for l in open(".env.local").read().splitlines() if not l.startswith("NEXT_PUBLIC_MODEL_SHA256=")]
        lines.append(f"NEXT_PUBLIC_MODEL_SHA256={digest}")
        open(".env.local", "w").write("\n".join(lines) + "\n")
        print("updated .env.local — restart `npm run dev` so the app picks up the new checksum")


if __name__ == "__main__":
    main()
