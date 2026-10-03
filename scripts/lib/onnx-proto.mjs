/**
 * Just enough of the ONNX protobuf format to prepare the Whisper models
 * without Python: read metadata, list nodes, and expose intermediate values
 * as extra graph outputs (ModelProto.graph.output).
 *
 * Wire format: https://protobuf.dev/programming-guides/encoding/
 * Field numbers: https://github.com/onnx/onnx/blob/main/onnx/onnx.proto
 */

const MODEL_GRAPH = 7;
const MODEL_METADATA = 14;
const GRAPH_NODE = 1;
const GRAPH_OUTPUT = 12;
const NODE_INPUT = 1;
const NODE_OUTPUT = 2;
const NODE_NAME = 3;
const NODE_OP_TYPE = 4;
const ENTRY_KEY = 1;
const ENTRY_VALUE = 2;
const VALUE_INFO_NAME = 1;

const utf8 = new TextDecoder();

function readVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  for (;;) {
    if (pos >= buf.length) throw new Error("Truncated protobuf varint");
    const byte = buf[pos++];
    result += (byte & 0x7f) * 2 ** shift;
    if (byte < 0x80) return [result, pos];
    shift += 7;
    if (shift > 63) throw new Error("Invalid protobuf varint");
  }
}

/** Yields the fields of a message stored in buf[start, end). */
export function* fields(buf, start = 0, end = buf.length) {
  let pos = start;
  while (pos < end) {
    const fieldStart = pos;
    const [key, afterKey] = readVarint(buf, pos);
    const field = Math.floor(key / 8);
    const wire = key & 7;
    pos = afterKey;
    let valueStart = pos;
    let valueEnd;
    if (wire === 0) {
      [, valueEnd] = readVarint(buf, pos);
    } else if (wire === 1) {
      valueEnd = pos + 8;
    } else if (wire === 2) {
      const [length, afterLength] = readVarint(buf, pos);
      valueStart = afterLength;
      valueEnd = afterLength + length;
    } else if (wire === 5) {
      valueEnd = pos + 4;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wire}`);
    }
    if (valueEnd > end) throw new Error("Truncated protobuf field");
    pos = valueEnd;
    yield { field, wire, fieldStart, valueStart, valueEnd };
  }
}

function findGraph(buf) {
  for (const f of fields(buf)) if (f.field === MODEL_GRAPH && f.wire === 2) return f;
  throw new Error("Not an ONNX model (no graph)");
}

const text = (buf, f) => utf8.decode(buf.subarray(f.valueStart, f.valueEnd));

/** ModelProto.metadata_props as a plain object. */
export function onnxMetadata(buf) {
  const out = {};
  for (const f of fields(buf)) {
    if (f.field !== MODEL_METADATA || f.wire !== 2) continue;
    let key = "";
    let value = "";
    for (const g of fields(buf, f.valueStart, f.valueEnd)) {
      if (g.field === ENTRY_KEY) key = text(buf, g);
      if (g.field === ENTRY_VALUE) value = text(buf, g);
    }
    out[key] = value;
  }
  return out;
}

/** The graph's nodes in order: { name, opType, inputs, outputs }. */
export function onnxNodes(buf) {
  const graph = findGraph(buf);
  const nodes = [];
  for (const f of fields(buf, graph.valueStart, graph.valueEnd)) {
    if (f.field !== GRAPH_NODE || f.wire !== 2) continue;
    const node = { name: "", opType: "", inputs: [], outputs: [] };
    for (const g of fields(buf, f.valueStart, f.valueEnd)) {
      if (g.wire !== 2) continue;
      if (g.field === NODE_INPUT) node.inputs.push(text(buf, g));
      else if (g.field === NODE_OUTPUT) node.outputs.push(text(buf, g));
      else if (g.field === NODE_NAME) node.name = text(buf, g);
      else if (g.field === NODE_OP_TYPE) node.opType = text(buf, g);
    }
    nodes.push(node);
  }
  return nodes;
}

/** Names of the graph's outputs. */
export function onnxOutputs(buf) {
  const graph = findGraph(buf);
  const names = [];
  for (const f of fields(buf, graph.valueStart, graph.valueEnd)) {
    if (f.field !== GRAPH_OUTPUT || f.wire !== 2) continue;
    for (const g of fields(buf, f.valueStart, f.valueEnd)) if (g.field === VALUE_INFO_NAME) names.push(text(buf, g));
  }
  return names;
}

function varint(n) {
  const bytes = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    bytes.push(byte);
  } while (n > 0);
  return Uint8Array.from(bytes);
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function lengthDelimited(field, bytes) {
  return concat([varint(field * 8 + 2), varint(bytes.length), bytes]);
}

/**
 * Returns a copy of the model whose graph also outputs the given values
 * (type information is left for ONNX Runtime to infer).
 */
export function addGraphOutputs(buf, names) {
  const graph = findGraph(buf);
  const existing = new Set(onnxOutputs(buf));
  const extra = names
    .filter((n) => !existing.has(n))
    .map((n) => lengthDelimited(GRAPH_OUTPUT, lengthDelimited(VALUE_INFO_NAME, new TextEncoder().encode(n))));
  if (extra.length === 0) return buf;
  const content = concat([buf.subarray(graph.valueStart, graph.valueEnd), ...extra]);
  return concat([buf.subarray(0, graph.fieldStart), lengthDelimited(MODEL_GRAPH, content), buf.subarray(graph.valueEnd)]);
}

/**
 * Cross-attention weights of a Whisper decoder (sherpa-onnx export): the
 * Softmax nodes fed by Q·Kᵀ without a causal mask (MatMul → Cast → Softmax),
 * one per decoder layer, in layer order.
 */
export function crossAttentionOutputs(buf) {
  const nodes = onnxNodes(buf);
  const producer = new Map();
  for (const node of nodes) for (const out of node.outputs) producer.set(out, node);
  const result = [];
  for (const node of nodes) {
    if (node.opType !== "Softmax") continue;
    let source = producer.get(node.inputs[0]);
    if (source?.opType === "Cast") source = producer.get(source.inputs[0]);
    if (source?.opType === "MatMul") result.push(node.outputs[0]);
  }
  return result;
}

/** Test helper: builds a tiny ModelProto with Softmax nodes and metadata. */
export function buildTestModel({ nodes, outputs, metadata = {} }) {
  const enc = (s) => new TextEncoder().encode(s);
  const nodeBytes = nodes.map((n) =>
    lengthDelimited(
      GRAPH_NODE,
      concat([
        ...n.inputs.map((i) => lengthDelimited(NODE_INPUT, enc(i))),
        ...n.outputs.map((o) => lengthDelimited(NODE_OUTPUT, enc(o))),
        lengthDelimited(NODE_NAME, enc(n.name)),
        lengthDelimited(NODE_OP_TYPE, enc(n.opType)),
      ]),
    ),
  );
  const outputBytes = outputs.map((o) => lengthDelimited(GRAPH_OUTPUT, lengthDelimited(VALUE_INFO_NAME, enc(o))));
  const graph = lengthDelimited(MODEL_GRAPH, concat([...nodeBytes, ...outputBytes]));
  const meta = Object.entries(metadata).map(([k, v]) =>
    lengthDelimited(MODEL_METADATA, concat([lengthDelimited(ENTRY_KEY, enc(k)), lengthDelimited(ENTRY_VALUE, enc(v))])),
  );
  return concat([concat([varint(1 * 8), varint(8)]), graph, ...meta]);
}
