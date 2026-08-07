export const GRAPH_SCHEMA_VERSION = "1.0";

export interface GraphSource {
  path: string;
  pointer: string;
}

export interface GraphNode {
  id: string;
  type: string;
  properties: Record<string, unknown>;
  source: GraphSource;
}

export interface GraphEdge {
  id: string;
  type: string;
  from: string;
  to: string;
  properties: Record<string, unknown>;
  source: GraphSource;
}

export interface GraphSnapshot {
  graph_schema_version: string;
  source_revision: string;
  fingerprint: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphNodeTypeDefinition {
  name: string;
  authority?: string;
}

export interface GraphEdgePair {
  from: string;
  to: string;
}

export interface GraphEdgeTypeDefinition {
  name: string;
  allowed_pairs: GraphEdgePair[];
}

export interface GraphRegistry {
  nodeTypes: GraphNodeTypeDefinition[];
  edgeTypes: GraphEdgeTypeDefinition[];
}

export type GraphFindingSeverity = "error" | "warning";

export interface GraphFinding {
  finding_id: string;
  constraint_id: string;
  focus_node: string;
  path: string;
  severity: GraphFindingSeverity;
  message: string;
}
