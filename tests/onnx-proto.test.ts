import { describe, expect, it } from "vitest";
import { addGraphOutputs, buildTestModel, crossAttentionOutputs, onnxMetadata, onnxNodes, onnxOutputs } from "../scripts/lib/onnx-proto.mjs";

/** A miniature Whisper decoder: per layer a masked self-attention and an unmasked cross-attention softmax. */
function decoderModel() {
  const nodes = [];
  for (let layer = 0; layer < 2; layer++) {
    const p = `/l${layer}`;
    nodes.push(
      { name: `${p}/self/MatMul`, opType: "MatMul", inputs: ["q", "k"], outputs: [`${p}/self/qk`] },
      { name: `${p}/self/Add`, opType: "Add", inputs: [`${p}/self/qk`, "mask"], outputs: [`${p}/self/masked`] },
      { name: `${p}/self/Cast`, opType: "Cast", inputs: [`${p}/self/masked`], outputs: [`${p}/self/cast`] },
      { name: `${p}/self/Softmax`, opType: "Softmax", inputs: [`${p}/self/cast`], outputs: [`${p}/self/w`] },
      { name: `${p}/cross/MatMul`, opType: "MatMul", inputs: ["q", "ck"], outputs: [`${p}/cross/qk`] },
      { name: `${p}/cross/Cast`, opType: "Cast", inputs: [`${p}/cross/qk`], outputs: [`${p}/cross/cast`] },
      { name: `${p}/cross/Softmax`, opType: "Softmax", inputs: [`${p}/cross/cast`], outputs: [`${p}/cross/w`] },
    );
  }
  return buildTestModel({ nodes, outputs: ["logits"], metadata: { n_mels: "128", sot: "50258" } });
}

describe("ONNX protobuf helpers (setup script)", () => {
  it("reads metadata and nodes", () => {
    const model = decoderModel();
    expect(onnxMetadata(model)).toEqual({ n_mels: "128", sot: "50258" });
    const nodes = onnxNodes(model);
    expect(nodes).toHaveLength(14);
    expect(nodes[3]).toEqual({ name: "/l0/self/Softmax", opType: "Softmax", inputs: ["/l0/self/cast"], outputs: ["/l0/self/w"] });
  });

  it("finds the cross-attention softmax of each layer and exposes it as an output", () => {
    const model = decoderModel();
    const cross = crossAttentionOutputs(model);
    expect(cross).toEqual(["/l0/cross/w", "/l1/cross/w"]);
    const patched = addGraphOutputs(model, [cross[1]]);
    expect(onnxOutputs(patched)).toEqual(["logits", "/l1/cross/w"]);
    // everything else is unchanged
    expect(onnxNodes(patched)).toEqual(onnxNodes(model));
    expect(onnxMetadata(patched)).toEqual(onnxMetadata(model));
    // idempotent
    expect(onnxOutputs(addGraphOutputs(patched, [cross[1]]))).toEqual(["logits", "/l1/cross/w"]);
  });
});
