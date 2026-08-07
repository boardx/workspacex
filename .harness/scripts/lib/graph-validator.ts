import type { GraphEdge, GraphFinding, GraphRegistry, GraphSnapshot } from "./graph-types";
import { graphFindingId } from "./graph-stable";

function finding(constraintId: string, focusNode: string, path: string, message: string): GraphFinding {
  return {
    finding_id: graphFindingId(constraintId, focusNode, path),
    constraint_id: constraintId,
    focus_node: focusNode,
    path,
    severity: "error",
    message,
  };
}

function canonicalCycle(nodes: string[]): string[] {
  const open = nodes[0] === nodes[nodes.length - 1] ? nodes.slice(0, -1) : [...nodes];
  const rotations = open.map((_, index) => [...open.slice(index), ...open.slice(0, index)]);
  rotations.sort((a, b) => a.join("\u0000").localeCompare(b.join("\u0000")));
  const selected = rotations[0] ?? [];
  return [...selected, selected[0]!];
}

function dependencyCycles(edges: GraphEdge[]): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges.filter((candidate) => candidate.type === "depends_on")) {
    const targets = adjacency.get(edge.from) ?? [];
    targets.push(edge.to);
    adjacency.set(edge.from, targets);
  }
  for (const targets of adjacency.values()) targets.sort();

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const cycles = new Map<string, string[]>();

  function visit(node: string): void {
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const target of adjacency.get(node) ?? []) {
      if (visiting.has(target)) {
        const start = stack.indexOf(target);
        const cycle = canonicalCycle([...stack.slice(start), target]);
        cycles.set(cycle.join(" -> "), cycle);
      } else {
        visit(target);
      }
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of [...adjacency.keys()].sort()) visit(node);
  return [...cycles.values()].sort((a, b) => a.join("\u0000").localeCompare(b.join("\u0000")));
}

function duplicateValues(values: string[]): string[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort();
}

export function validateGraph(snapshot: GraphSnapshot, registry: GraphRegistry): GraphFinding[] {
  const findings: GraphFinding[] = [];
  const knownNodeTypes = new Set(registry.nodeTypes.map((type) => type.name));
  const edgeDefinitions = new Map(registry.edgeTypes.map((type) => [type.name, type]));
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));

  for (const duplicateId of duplicateValues(snapshot.nodes.map((node) => node.id))) {
    findings.push(finding("HGC-IDENTITY-001", duplicateId, "nodes.id", `重复 node id: ${duplicateId}`));
  }
  for (const duplicateId of duplicateValues(snapshot.edges.map((edge) => edge.id))) {
    findings.push(finding("HGC-IDENTITY-002", duplicateId, "edges.id", `重复 edge id: ${duplicateId}`));
  }
  for (const node of snapshot.nodes) {
    if (!knownNodeTypes.has(node.type)) {
      findings.push(finding("HGC-TYPE-001", node.id, "node.type", `未知 node type: ${node.type}`));
    }
  }
  for (const edge of snapshot.edges) {
    const definition = edgeDefinitions.get(edge.type);
    if (!definition) {
      findings.push(finding("HGC-TYPE-002", edge.id, "edge.type", `未知 edge type: ${edge.type}`));
      continue;
    }
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from) {
      findings.push(finding("HGC-REFERENCE-001", edge.id, "edge.from", `悬空 from: ${edge.from}`));
    }
    if (!to) {
      findings.push(finding("HGC-REFERENCE-002", edge.id, "edge.to", `悬空 to: ${edge.to}`));
    }
    if (from && to) {
      const allowed = definition.allowed_pairs.some((pair) => pair.from === from.type && pair.to === to.type);
      if (!allowed) {
        findings.push(
          finding(
            "HGC-TYPE-003",
            edge.id,
            "edge.endpoints",
            `${edge.type} 不允许 ${from.type} -> ${to.type}`
          )
        );
      }
    }
  }
  for (const cycle of dependencyCycles(snapshot.edges)) {
    const path = cycle.join(" -> ");
    findings.push(finding("HGC-DEPENDENCY-001", cycle[0]!, "depends_on", `依赖成环: ${path}`));
  }

  return [...new Map(findings.map((item) => [item.finding_id, item])).values()].sort((a, b) =>
    a.finding_id.localeCompare(b.finding_id)
  );
}
