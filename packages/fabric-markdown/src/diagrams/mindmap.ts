/**
 * mindmap plugin. The mermaid db exposes a single tree (getMindmap). Nodes
 * flatten to IR nodes keyed by the numeric db id (`n${id}` — nodeId text can
 * repeat across branches), parent→child links become 'open' edges.
 *
 * mermaid node type codes (kept in data.mmType for round-tripping):
 * 0=default(no frame) 1=rounded `(x)` 2=square `[x]` 3=circle `((x))`
 * 4=cloud `)x(` 5=bang `))x((` 6=hexagon `{{x}}`.
 *
 * Layout: left-to-right tree. x grows with the real recursion depth (the db
 * `level` field is unreliable), leaves stack top-to-bottom in preorder and
 * every parent sits at the mean y of its children.
 *
 * Visuals (VISUAL-SPEC §2 mindmap): root is a big stadium; each first-level
 * branch owns one PALETTE hue — soft fill on every node of the branch, the
 * full-strength hue on every edge of the branch.
 */
import { registerDiagram, type DiagramParseContext } from './registry';
import type { DiagramModel, DiagramNode, DiagramEdge } from '../model';
import { paletteAt, paletteSoftAt, PAPER, LINE } from '../theme';

/** Root fill: mid-tone of the primary indigo ramp (PRIMARY is too dark for
 * the fixed dark node text, PRIMARY_SOFT too faint to anchor the tree). */
const ROOT_FILL = '#c7d2fe';

const LEVEL_GAP = 240;
const LEAF_GAP = 72;
const TREE_X = 140;

interface MmTreeNode {
  id: number;
  nodeId?: string;
  level?: number;
  descr?: string;
  type?: number;
  children?: MmTreeNode[];
  isRoot?: boolean;
}

function callDb<T>(db: Record<string, unknown>, method: string, fallback: T): T {
  const fn = db[method];
  if (typeof fn === 'function') {
    try {
      const out = (fn as (this: unknown) => T).call(db);
      return out ?? fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/**
 * Tree view over a model's edges: children per node in edge order (a node
 * keeps its first incoming edge only), plus the root (= first node with no
 * incoming edge) and the incoming edge per node.
 */
function buildTree(model: DiagramModel): {
  root: DiagramNode | undefined;
  children: Map<string, string[]>;
  parentEdge: Map<string, DiagramEdge>;
} {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  const parentEdge = new Map<string, DiagramEdge>();
  for (const e of model.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    if (parentEdge.has(e.target)) continue; // a node keeps its first parent only
    parentEdge.set(e.target, e);
    const kids = children.get(e.source);
    if (kids) kids.push(e.target);
    else children.set(e.source, [e.target]);
  }
  const root = model.nodes.find((n) => !parentEdge.has(n.id));
  return { root, children, parentEdge };
}

/**
 * Recompute node positions in place: x grows with the real recursion depth,
 * leaves stack top-to-bottom in preorder (LEAF_GAP apart) and every parent
 * sits at the mean y of its children. The tree is rebuilt from the edges
 * (root = the node with no incoming edge).
 */
export function layoutMindmap(model: DiagramModel, leafGap: number = LEAF_GAP): void {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const { root, children } = buildTree(model);
  if (!root) return;
  let leafIndex = 0;
  const visited = new Set<string>();
  const place = (id: string, depth: number): number => {
    visited.add(id);
    const node = byId.get(id)!;
    node.x = TREE_X + depth * LEVEL_GAP;
    const kids = (children.get(id) ?? []).filter((k) => !visited.has(k));
    let y: number;
    if (kids.length === 0) {
      y = 90 + leafIndex * leafGap;
      leafIndex += 1;
    } else {
      const ys = kids.map((k) => place(k, depth + 1));
      y = ys.reduce((a, b) => a + b, 0) / ys.length;
    }
    node.y = y;
    return y;
  };
  place(root.id, 0);
}

/**
 * Recompute branch colors in place: the root keeps ROOT_FILL, each first-level
 * branch owns one PALETTE hue — soft fill on every node of the branch, the
 * full-strength hue on every edge of the branch. Used after parsing and again
 * whenever the tree structure changes (new nodes, reparenting).
 */
export function mindmapBranchColors(model: DiagramModel): void {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const { root, children, parentEdge } = buildTree(model);
  if (!root) return;
  root.data = { ...root.data, color: ROOT_FILL };
  const visited = new Set<string>([root.id]);
  const paint = (id: string, branch: number): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = byId.get(id)!;
    node.data = { ...node.data, color: paletteSoftAt(branch) };
    const edge = parentEdge.get(id);
    if (edge) edge.data = { ...edge.data, color: paletteAt(branch) };
    for (const kid of children.get(id) ?? []) paint(kid, branch);
  };
  (children.get(root.id) ?? []).forEach((kid, i) => paint(kid, i));
}

/** Leaf spacing used by the styled (editor/demo) hierarchy — taller level-1
 * nodes (48px) need more breathing room than the parse-time default. */
export const STYLED_LEAF_GAP = 80;

/**
 * Per-depth node metrics for the "Miro-level" visual hierarchy:
 * root (17px / 60 high) > first-level branch (14px / 48) > deeper (13px / 40).
 * Width tracks label length, clamped per level.
 */
export function mindmapNodeMetrics(
  depth: number,
  label: string,
): { width: number; height: number; fontSize: number } {
  const len = Math.max(1, label.length);
  if (depth === 0) return { width: Math.min(260, Math.max(180, len * 17)), height: 60, fontSize: 17 };
  if (depth === 1) return { width: Math.min(240, Math.max(100, len * 15)), height: 48, fontSize: 14 };
  return { width: Math.min(220, Math.max(90, len * 13)), height: 40, fontSize: 13 };
}

/**
 * Apply the full visual hierarchy in place (opt-in post-pass, used by the demo
 * after import and by the interactive editor on every structural change):
 * - per-depth metrics (see mindmapNodeMetrics), fontSize into data.fontSize;
 * - root keeps ROOT_FILL; level-1 branches get their branch's soft fill;
 * - depth >= 2 nodes get a clean white fill with the branch hue as stroke
 *   (data.stroke, supported by FlowNode);
 * - every branch edge carries the full-strength branch hue;
 * - re-layout with the wider STYLED_LEAF_GAP.
 *
 * Kept separate from parseMindmap so the parse-time model (and its public
 * defaults) stays unchanged.
 */
export function styleMindmap(model: DiagramModel): void {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const { root, children, parentEdge } = buildTree(model);
  if (!root) return;
  const visited = new Set<string>();
  const style = (id: string, depth: number, branch: number): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = byId.get(id)!;
    const m = mindmapNodeMetrics(depth, node.label);
    node.width = m.width;
    node.height = m.height;
    if (depth === 0) {
      node.data = { ...node.data, color: ROOT_FILL, stroke: LINE, fontSize: m.fontSize };
    } else if (depth === 1) {
      node.data = { ...node.data, color: paletteSoftAt(branch), stroke: LINE, fontSize: m.fontSize };
    } else {
      node.data = { ...node.data, color: PAPER, stroke: paletteAt(branch), fontSize: m.fontSize };
    }
    const edge = parentEdge.get(id);
    if (edge) edge.data = { ...edge.data, color: paletteAt(branch) };
    (children.get(id) ?? []).forEach((kid, i) => style(kid, depth + 1, depth === 0 ? i : branch));
  };
  style(root.id, 0, 0);
  layoutMindmap(model, STYLED_LEAF_GAP);
}

/**
 * Re-hang `childId` (with its whole subtree) under `newParentId` by updating
 * its incoming edge's source. Returns false (and changes nothing) when the
 * move is impossible or a no-op: unknown ids, the child is the root (no
 * incoming edge), the new parent already is its parent, or the new parent
 * lies inside the child's own subtree (would create a cycle).
 */
export function reparent(model: DiagramModel, childId: string, newParentId: string): boolean {
  if (childId === newParentId) return false;
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  if (!byId.has(childId) || !byId.has(newParentId)) return false;
  const { children, parentEdge } = buildTree(model);
  const edge = parentEdge.get(childId);
  if (!edge) return false; // root cannot be re-hung
  if (edge.source === newParentId) return false;
  // Cycle guard: the new parent must not be a descendant of the child.
  const stack = [childId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === newParentId) return false;
    stack.push(...(children.get(id) ?? []));
  }
  edge.source = newParentId;
  return true;
}

export function parseMindmap(ctx: DiagramParseContext): DiagramModel {
  const root = callDb<MmTreeNode | null>(ctx.db, 'getMindmap', null);
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  let edgeIndex = 0;

  const walk = (tn: MmTreeNode, depth: number, parentId: string | null): void => {
    const id = `n${tn.id}`;
    const label = tn.descr ?? String(tn.nodeId ?? '');
    const type = tn.type ?? 0;
    const node: DiagramNode =
      depth === 0
        ? {
            id,
            label,
            shape: 'stadium',
            x: 0, // filled in by layoutMindmap
            y: 0,
            width: 170,
            height: 56,
            data: { mmType: type, color: ROOT_FILL, fontSize: 16 },
          }
        : {
            id,
            label,
            // Hexagon (6) approximates as a stadium (no hexagon primitive);
            // the exact mermaid type survives in data.mmType.
            shape: type === 6 ? 'stadium' : 'round',
            x: 0, // filled in by layoutMindmap
            y: 0,
            width: Math.min(220, Math.max(90, label.length * 15)),
            height: 44,
            data: { mmType: type },
          };
    nodes.push(node);
    if (parentId !== null) {
      edges.push({
        id: `e${edgeIndex++}`,
        source: parentId,
        target: id,
        kind: 'open',
        data: { mindmap: true },
      });
    }
    for (const child of tn.children ?? []) walk(child, depth + 1, id);
  };

  if (root) walk(root, 0, null);
  const model: DiagramModel = { kind: 'mindmap', direction: 'LR', nodes, edges, meta: {} };
  layoutMindmap(model);
  mindmapBranchColors(model);
  return model;
}

function wrapDescr(node: DiagramNode, isRoot: boolean): string {
  const type = node.data?.mmType as number | undefined;
  const d = node.label;
  if (isRoot) {
    // Root usually carries a shape; default to the classic circle form.
    switch (type) {
      case 0:
        return d;
      case 1:
        return `root(${d})`;
      case 2:
        return `root[${d}]`;
      case 4:
        return `root)${d}(`;
      case 5:
        return `root))${d}((`;
      case 6:
        return `root{{${d}}}`;
      default:
        return `root((${d}))`;
    }
  }
  switch (type) {
    case 1:
      return `(${d})`;
    case 2:
      return `[${d}]`;
    case 3:
      return `((${d}))`;
    case 4:
      return `)${d}(`; // cloud
    case 5:
      return `))${d}((`; // bang
    case 6:
      return `{{${d}}}`;
    default:
      return d;
  }
}

export function serializeMindmap(model: DiagramModel): string {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const e of model.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    if (hasParent.has(e.target)) continue; // a node keeps its first parent only
    hasParent.add(e.target);
    const kids = children.get(e.source);
    if (kids) kids.push(e.target);
    else children.set(e.source, [e.target]);
  }

  const rootless = model.nodes.filter((n) => !hasParent.has(n.id));
  const root = rootless[0];
  if (!root) return 'mindmap';
  // Orphans (canvas-added nodes with no incoming edge) hang off the root.
  const orphans = rootless.slice(1).map((n) => n.id);
  if (orphans.length > 0) {
    children.set(root.id, [...(children.get(root.id) ?? []), ...orphans]);
  }

  const lines: string[] = ['mindmap'];
  const visited = new Set<string>();
  const emit = (id: string, depth: number): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = byId.get(id);
    if (!node) return;
    lines.push('  '.repeat(depth + 1) + wrapDescr(node, depth === 0));
    for (const kid of children.get(id) ?? []) emit(kid, depth + 1);
  };
  emit(root.id, 0);
  return lines.join('\n');
}

registerDiagram({
  kind: 'mindmap',
  detects: ['mindmap'],
  parse: parseMindmap,
  serialize: serializeMindmap,
});
