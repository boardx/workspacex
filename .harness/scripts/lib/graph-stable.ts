import { createHash } from "node:crypto";
import type { GraphEdge, GraphNode, GraphSnapshot } from "./graph-types";
import { GRAPH_SCHEMA_VERSION } from "./graph-types";

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sortJson(child)])
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value), null, 2) + "\n";
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function graphEdgeId(
  type: string,
  from: string,
  to: string,
  qualifier: Record<string, unknown> = {}
): string {
  const payload = stableJson({ from, qualifier, to, type });
  return `EDGE-${sha256(payload).slice(0, 16).toUpperCase()}`;
}

export function graphFindingId(constraintId: string, focusNode: string, path: string): string {
  const payload = stableJson({ constraintId, focusNode, path });
  return `HGF-${sha256(payload).slice(0, 16).toUpperCase()}`;
}

export function createGraphSnapshot(
  sourceRevision: string,
  nodes: GraphNode[],
  edges: GraphEdge[]
): GraphSnapshot {
  const normalizedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const normalizedEdges = [...edges].sort((a, b) => a.id.localeCompare(b.id));
  const content = {
    graph_schema_version: GRAPH_SCHEMA_VERSION,
    source_revision: sourceRevision,
    nodes: normalizedNodes,
    edges: normalizedEdges,
  };
  return {
    graph_schema_version: GRAPH_SCHEMA_VERSION,
    source_revision: sourceRevision,
    fingerprint: `sha256:${sha256(stableJson(content))}`,
    nodes: normalizedNodes,
    edges: normalizedEdges,
  };
}

export function serializeGraphSnapshot(snapshot: GraphSnapshot): string {
  return stableJson(snapshot);
}
