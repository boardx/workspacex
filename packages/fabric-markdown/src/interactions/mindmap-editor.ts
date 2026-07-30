/**
 * Miro-style interactive editing for mindmaps rendered on a fabric canvas.
 *
 * - Tab   → add a child of the selected node (inherits the branch color).
 * - Enter → add a sibling of the selected node (root falls back to child).
 * - Drag a node onto another node → re-hang it (with its subtree) as a child
 *   of that node (cycle-safe), then re-layout the whole tree.
 *
 * The same operations are exposed as a command API (addChild / addSibling /
 * removeSubtree / isActive) so UI chrome (e.g. the demo's floating toolbar)
 * can drive them programmatically; the keyboard path reuses the exact same
 * implementations.
 *
 * After every structural change the tree is re-styled and re-laid-out
 * (styleMindmap: per-depth metrics, branch colors, layout); new
 * coordinates/colors are written back to the canvas objects — with a short
 * position animation in the browser — and the ConnectionManager re-routes
 * every edge.
 *
 * The editor only acts when the canvas currently shows a mindmap (there is a
 * FlowEdge on the canvas and extractModel(canvas).kind === 'mindmap'); it can
 * therefore stay attached while other diagram kinds are displayed.
 */
import type { Canvas, FabricObject } from 'fabric';
import { FlowNode, FlowEdge } from '../fabric-objects';
import { extractModel, getConnectionManager } from '../canvas-io';
import { styleMindmap, mindmapNodeMetrics, reparent } from '../diagrams/mindmap';
import type { DiagramModel } from '../model';

export interface MindmapEditor {
  dispose(): void;
  /** True when the canvas currently shows a mindmap (editing enabled). */
  isActive(): boolean;
  /**
   * Add a child under `nodeId` (default: the currently selected node).
   * Returns the new node's id, or null when not applicable.
   */
  addChild(nodeId?: string): string | null;
  /**
   * Add a sibling after `nodeId` (default: the currently selected node);
   * on the root this falls back to adding a child.
   * Returns the new node's id, or null when not applicable.
   */
  addSibling(nodeId?: string): string | null;
  /**
   * Remove `nodeId` together with its whole subtree and every edge touching
   * it, then re-layout. Returns false when the node does not exist or the
   * canvas is not a mindmap.
   */
  removeSubtree(nodeId: string): boolean;
}

export interface MindmapEditorOptions {
  /** Called after every structural change (demo refreshes the markdown panel). */
  onChange?: () => void;
}

const NEW_NODE_LABEL = '新节点';
const ANIMATE_MS = 150;

let uniqueSeq = 0;

/** Unique-ish id: timestamp base36 + per-session counter, then collision-checked. */
function freshId(prefix: string, taken: Set<string>): string {
  let id: string;
  do {
    id = `${prefix}${Date.now().toString(36)}${(uniqueSeq++).toString(36)}`;
  } while (taken.has(id));
  return id;
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== 'string') return false;
  const tag = (el as HTMLElement).tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable === true;
}

export function attachMindmapEditor(canvas: Canvas, opts: MindmapEditorOptions = {}): MindmapEditor {
  const flowNodes = (): FlowNode[] =>
    canvas.getObjects().filter((o): o is FlowNode => o instanceof FlowNode);
  const flowEdges = (): FlowEdge[] =>
    canvas.getObjects().filter((o): o is FlowEdge => o instanceof FlowEdge);

  const isMindmap = (): boolean =>
    flowEdges().length > 0 && extractModel(canvas).kind === 'mindmap';

  const selectedNode = (): FlowNode | null => {
    const active = canvas.getActiveObject();
    return active instanceof FlowNode ? active : null;
  };

  const nodeById = (nodeId: string): FlowNode | null =>
    flowNodes().find((n) => n.nodeId === nodeId) ?? null;

  /** Depth of a node = hops to the root along first incoming edges (cycle-safe). */
  const depthOf = (node: FlowNode): number => {
    let depth = 0;
    let cur = node.nodeId;
    const seen = new Set<string>();
    for (;;) {
      if (seen.has(cur)) break;
      seen.add(cur);
      const incoming = flowEdges().find((e) => e.target === cur);
      if (!incoming) break;
      cur = incoming.source;
      depth += 1;
    }
    return depth;
  };

  /** Write model coordinates/colors back onto the canvas objects. */
  const applyModel = (model: DiagramModel): void => {
    const modelNodes = new Map(model.nodes.map((n) => [n.id, n]));
    const modelEdges = new Map(model.edges.map((e) => [e.id, e]));
    const animate = typeof window !== 'undefined' && typeof requestAnimationFrame === 'function';
    const mgr = getConnectionManager(canvas);

    for (const node of flowNodes()) {
      const mn = modelNodes.get(node.nodeId);
      if (!mn) continue;
      // Color/stroke write-back: data for round-tripping + the base shape.
      const color = mn.data?.['color'] as string | undefined;
      const stroke = mn.data?.['stroke'] as string | undefined;
      const base = node.getObjects()[0] as FabricObject | undefined;
      if (color !== undefined && node.data?.['color'] !== color) {
        node.data = { ...node.data, color };
        if (base && 'fill' in base) {
          base.set({ fill: color });
          node.dirty = true;
        }
      }
      if (stroke !== undefined && node.data?.['stroke'] !== stroke) {
        node.data = { ...node.data, stroke };
        if (base && 'stroke' in base) {
          base.set({ stroke });
          node.dirty = true;
        }
      }
      // Position write-back (center origin: left/top ARE the center).
      const dx = Math.abs(node.left - mn.x);
      const dy = Math.abs(node.top - mn.y);
      if (dx < 0.5 && dy < 0.5) continue;
      if (animate) {
        node.animate(
          { left: mn.x, top: mn.y },
          {
            duration: ANIMATE_MS,
            onChange: () => {
              node.setCoords();
              mgr.updateEdgesFor([node.nodeId]);
            },
            onComplete: () => {
              node.set({ left: mn.x, top: mn.y });
              node.setCoords();
              mgr.updateEdgesFor([node.nodeId]);
            },
          },
        );
      } else {
        node.set({ left: mn.x, top: mn.y });
        node.setCoords();
      }
    }
    for (const edge of flowEdges()) {
      const me = modelEdges.get(edge.edgeId);
      if (!me) continue;
      const color = me.data?.['color'] as string | undefined;
      if (color !== undefined && edge.data?.['color'] !== color) {
        edge.data = { ...edge.data, color };
        edge.dirty = true;
      }
    }
  };

  /** Re-style + re-layout from the current canvas state, write back, notify. */
  const refresh = (): void => {
    const model = extractModel(canvas);
    styleMindmap(model);
    applyModel(model);
    getConnectionManager(canvas).updateAllEdges();
    canvas.requestRenderAll();
    opts.onChange?.();
  };

  const addChildOf = (parent: FlowNode): string => {
    const nodeIds = new Set(flowNodes().map((n) => n.nodeId));
    const edgeIds = new Set(flowEdges().map((e) => e.edgeId));
    const nodeId = freshId('n', nodeIds);
    const pc = parent.center();
    // Inherit the branch color right away (styleMindmap will confirm it on
    // refresh) so the connector never flashes in the default gray.
    // The parent's own incoming edge carries the branch hue; a child of the
    // root starts a new branch and gets its hue from the refresh instead.
    const parentEdge = flowEdges().find((e) => e.target === parent.nodeId);
    const branchColor = parentEdge?.data?.['color'] as string | undefined;
    const edge = new FlowEdge({
      edgeId: freshId('e', edgeIds),
      source: parent.nodeId,
      target: nodeId,
      kind: 'open',
      data: { mindmap: true, ...(branchColor ? { color: branchColor } : {}) },
    });
    // Size/typography follow the visual hierarchy of the new node's depth.
    const metrics = mindmapNodeMetrics(depthOf(parent) + 1, NEW_NODE_LABEL);
    const node = new FlowNode({
      nodeId,
      label: NEW_NODE_LABEL,
      shape: 'round',
      // Provisional spot next to the parent; refresh() lays it out properly.
      x: pc.x + 120,
      y: pc.y,
      width: metrics.width,
      height: metrics.height,
      data: { mmType: 0, fontSize: metrics.fontSize },
    });
    canvas.add(edge);
    // Keep connectors under the nodes, like renderToCanvas does.
    const sendBack = (canvas as unknown as { sendObjectToBack?: (o: FabricObject) => void })
      .sendObjectToBack;
    if (typeof sendBack === 'function') sendBack.call(canvas, edge);
    canvas.add(node);
    canvas.setActiveObject(node);
    refresh();
    return nodeId;
  };

  const addSiblingOf = (node: FlowNode): string => {
    const incoming = flowEdges().find((e) => e.target === node.nodeId);
    if (!incoming) {
      // Root has no parent — treat Enter like Tab.
      return addChildOf(node);
    }
    const parent = flowNodes().find((n) => n.nodeId === incoming.source);
    return parent ? addChildOf(parent) : addChildOf(node);
  };

  /** Resolve a command target: explicit id, else the current selection. */
  const resolveNode = (nodeId?: string): FlowNode | null =>
    nodeId !== undefined ? nodeById(nodeId) : selectedNode();

  const removeSubtree = (nodeId: string): boolean => {
    if (!isMindmap()) return false;
    if (!nodeById(nodeId)) return false;
    // Children map under the same first-parent rule as buildTree.
    const childMap = new Map<string, string[]>();
    const hasParent = new Set<string>();
    for (const e of flowEdges()) {
      if (hasParent.has(e.target)) continue;
      hasParent.add(e.target);
      const kids = childMap.get(e.source);
      if (kids) kids.push(e.target);
      else childMap.set(e.source, [e.target]);
    }
    const doomed = new Set<string>();
    const stack = [nodeId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (doomed.has(id)) continue;
      doomed.add(id);
      stack.push(...(childMap.get(id) ?? []));
    }
    canvas.discardActiveObject();
    for (const e of flowEdges()) {
      if (doomed.has(e.source) || doomed.has(e.target)) canvas.remove(e);
    }
    for (const n of flowNodes()) {
      if (doomed.has(n.nodeId)) canvas.remove(n);
    }
    refresh();
    return true;
  };

  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Tab' && ev.key !== 'Enter') return;
    if (isEditableTarget(ev.target)) return;
    if (!isMindmap()) return;
    const node = selectedNode();
    if (!node) return;
    ev.preventDefault();
    if (ev.key === 'Tab') addChildOf(node);
    else addSiblingOf(node);
  };

  /** Axis-aligned bbox (absolute coords) contains point? */
  const bboxContains = (obj: FabricObject, x: number, y: number): boolean => {
    const coords = obj.getCoords();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of coords) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  };

  const onModified = (opt: { target?: FabricObject }): void => {
    const dragged = opt.target;
    if (!(dragged instanceof FlowNode)) return;
    if (!isMindmap()) return;
    const c = dragged.center();
    const drop = flowNodes().find((n) => n !== dragged && bboxContains(n, c.x, c.y));
    if (!drop) return;
    const model = extractModel(canvas);
    if (!reparent(model, dragged.nodeId, drop.nodeId)) return;
    // Mirror the structural change onto the canvas edge itself.
    const incoming = flowEdges().find((e) => e.target === dragged.nodeId);
    if (incoming) {
      incoming.source = drop.nodeId;
      incoming.dirty = true;
    }
    refresh();
  };

  const hasDocument = typeof document !== 'undefined';
  if (hasDocument) document.addEventListener('keydown', onKeyDown);
  canvas.on('object:modified', onModified);

  return {
    dispose(): void {
      if (hasDocument) document.removeEventListener('keydown', onKeyDown);
      canvas.off('object:modified', onModified);
    },
    isActive: isMindmap,
    addChild(nodeId?: string): string | null {
      if (!isMindmap()) return null;
      const parent = resolveNode(nodeId);
      return parent ? addChildOf(parent) : null;
    },
    addSibling(nodeId?: string): string | null {
      if (!isMindmap()) return null;
      const node = resolveNode(nodeId);
      return node ? addSiblingOf(node) : null;
    },
    removeSubtree,
  };
}
