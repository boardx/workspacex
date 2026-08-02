/**
 * F41 -- uc-22-3 R3 step 2 (canvas row) / R4 A3 / R7 D-08: mermaid source is the
 * AUTHORITATIVE, round-trippable form of a canvas; the layout snapshot is auxiliary (A3).
 *
 * D-08's acceptance is a round-trip assertion, not a rendering assertion: mermaid source ->
 * parse into the canvas's own node/edge model -> render back to mermaid -> the two source
 * strings compare equal (char-exact after this module's own canonical formatting, per this
 * feature's V4). This module owns exactly that one property. It does not own the canvas
 * editor, ReactFlow, or any UI concern -- those are `[建议]`, explicitly out of contract
 * (R7 "ReactFlow 相关产物降为 [建议]，不进契约").
 *
 * Three node shapes -- the minimum needed to demonstrate "3 种节点类型" (V4) without
 * building a general mermaid grammar this feature does not need:
 *   - `id[label]`   rectangle
 *   - `id(label)`   rounded
 *   - `id{label}`   diamond
 * and one edge form: `A --> B`.
 */
export type CanvasNodeShape = "rectangle" | "rounded" | "diamond";

export interface CanvasNode {
  readonly id: string;
  readonly shape: CanvasNodeShape;
  readonly label: string;
}

export interface CanvasEdge {
  readonly from: string;
  readonly to: string;
}

export interface CanvasDiagram {
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
}

const NODE_LINE = /^\s*([A-Za-z0-9_]+)(\[|\(|\{)([^\]\)\}]*)(\]|\)|\})\s*$/;
const EDGE_LINE = /^\s*([A-Za-z0-9_]+)\s*-->\s*([A-Za-z0-9_]+)\s*$/;

const OPEN_TO_SHAPE: Readonly<Record<string, CanvasNodeShape>> = {
  "[": "rectangle",
  "(": "rounded",
  "{": "diamond",
};

const SHAPE_BRACKETS: Readonly<Record<CanvasNodeShape, readonly [string, string]>> = {
  rectangle: ["[", "]"],
  rounded: ["(", ")"],
  diamond: ["{", "}"],
};

export class MermaidParseError extends Error {}

/**
 * Parse a `flowchart TD` body into this module's own node/edge model.
 *
 * ⚠ Order-preserving: nodes and edges come out in the exact order their lines appeared, so
 * `renderMermaid(parseMermaid(src))` reproduces the same line order `src` had -- the thing
 * D-08's round-trip assertion actually depends on.
 */
export function parseMermaid(source: string): CanvasDiagram {
  const lines = source.split("\n").map((l) => l.trimEnd());
  if (lines[0]?.trim() !== "flowchart TD") {
    throw new MermaidParseError('expected a "flowchart TD" header on the first line');
  }
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  for (const line of lines.slice(1)) {
    if (line.trim().length === 0) continue;
    const nodeMatch = NODE_LINE.exec(line);
    if (nodeMatch) {
      const [, id, open, label] = nodeMatch;
      nodes.push({ id: id!, shape: OPEN_TO_SHAPE[open!]!, label: label! });
      continue;
    }
    const edgeMatch = EDGE_LINE.exec(line);
    if (edgeMatch) {
      const [, from, to] = edgeMatch;
      edges.push({ from: from!, to: to! });
      continue;
    }
    throw new MermaidParseError(`unrecognized line: ${JSON.stringify(line)}`);
  }
  return { nodes, edges };
}

/** The inverse of `parseMermaid` -- canonical rendering, two-space indent, one entity per
 *  line, nodes before edges (this module's own canonical order; a diagram round-tripped
 *  through `parseMermaid` already comes out in this order, so re-rendering it is a no-op). */
export function renderMermaid(diagram: CanvasDiagram): string {
  const lines = ["flowchart TD"];
  for (const n of diagram.nodes) {
    const [open, close] = SHAPE_BRACKETS[n.shape];
    lines.push(`  ${n.id}${open}${n.label}${close}`);
  }
  for (const e of diagram.edges) {
    lines.push(`  ${e.from} --> ${e.to}`);
  }
  return lines.join("\n") + "\n";
}

/** A minimal, deterministic "layout snapshot" -- structured JSON rather than an image, per
 *  R3's "布局快照（图片或结构化布局 JSON）". One row per node, in the same order the mermaid
 *  source lists them, so the snapshot and the authoritative source never disagree about
 *  which node is which. */
export function buildLayoutSnapshot(diagram: CanvasDiagram): Uint8Array {
  const layout = diagram.nodes.map((n, i) => ({ id: n.id, shape: n.shape, x: i * 160, y: 0 }));
  return new TextEncoder().encode(JSON.stringify({ nodes: layout, edges: diagram.edges }, null, 2) + "\n");
}
