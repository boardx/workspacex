/**
 * DiagramModel ⇄ Fabric canvas.
 */
import type { Canvas } from 'fabric';
import type { DiagramModel, DiagramNode, Direction, DiagramKind } from './model';
import { FlowNode, FlowEdge } from './fabric-objects';
import { ConnectionManager } from './connection-manager';

const managers = new WeakMap<Canvas, ConnectionManager>();
const directions = new WeakMap<Canvas, Direction>();
const kinds = new WeakMap<Canvas, DiagramKind>();
const metas = new WeakMap<Canvas, Record<string, unknown> | undefined>();

/** The ConnectionManager attached to a canvas (created on first render). */
export function getConnectionManager(canvas: Canvas): ConnectionManager {
  let mgr = managers.get(canvas);
  if (!mgr) {
    mgr = new ConnectionManager(canvas);
    managers.set(canvas, mgr);
  }
  return mgr;
}

export interface FitToContentOptions {
  /** Pixels of viewport margin around the content. Default 40. */
  padding?: number;
  /** Upper bound on the resulting zoom. Default 1 (never zoom in past 100%). */
  maxZoom?: number;
}

/**
 * Zoom & pan the viewport so all objects fit inside the canvas with padding.
 * Only changes the viewport transform — object coordinates are untouched, so
 * extractModel / serialization are unaffected. Empty canvas resets to identity.
 */
export function fitToContent(canvas: Canvas, opts: FitToContentOptions = {}): void {
  const { padding = 40, maxZoom = 1 } = opts;
  const objects = canvas.getObjects();
  if (objects.length === 0) {
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    return;
  }
  // Absolute (viewport-independent) bounding box from each object's aCoords —
  // fabric v7 getBoundingRect() is viewport-dependent, aCoords are not.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const obj of objects) {
    for (const p of obj.getCoords()) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const cw = canvas.getWidth();
  const ch = canvas.getHeight();
  const zoom = Math.min(
    maxZoom,
    w > 0 ? (cw - 2 * padding) / w : maxZoom,
    h > 0 ? (ch - 2 * padding) / h : maxZoom,
  );
  canvas.setViewportTransform([
    zoom,
    0,
    0,
    zoom,
    (cw - w * zoom) / 2 - minX * zoom,
    (ch - h * zoom) / 2 - minY * zoom,
  ]);
}

export interface RenderOptions {
  /** Pixels of margin added around the diagram. Default 24. */
  margin?: number;
  /** Clear existing FlowNode/FlowEdge objects first. Default true. */
  clear?: boolean;
}

/**
 * Instantiate the model as editable fabric objects on the canvas.
 * Edges are added first so nodes render on top of connector lines.
 */
export function renderToCanvas(model: DiagramModel, canvas: Canvas, options: RenderOptions = {}): void {
  const { margin = 24, clear = true } = options;
  if (clear) {
    for (const obj of [...canvas.getObjects()]) {
      if (obj instanceof FlowNode || obj instanceof FlowEdge) canvas.remove(obj);
    }
  }

  // Normalize mermaid layout coordinates so the diagram starts at the margin.
  let minX = Infinity;
  let minY = Infinity;
  for (const n of model.nodes) {
    minX = Math.min(minX, n.x - n.width / 2);
    minY = Math.min(minY, n.y - n.height / 2);
  }
  if (!isFinite(minX)) {
    minX = 0;
    minY = 0;
  }
  const offsetX = margin - minX;
  const offsetY = margin - minY;

  // Stacking order matters: locked background/decoration shapes (subgraph
  // boxes, section boxes, chart backdrops) must sit BELOW connector lines,
  // which must sit BELOW interactive nodes — otherwise backgrounds visually
  // cover the lines. Split model.nodes into locked/unlocked groups (each
  // preserving its own relative order) and add locked → edges → unlocked.
  const lockedNodes = model.nodes.filter((n) => n.data?.['locked']);
  const unlockedNodes = model.nodes.filter((n) => !n.data?.['locked']);

  const buildNode = (n: DiagramNode): FlowNode => {
    const node = new FlowNode({
      nodeId: n.id,
      label: n.label,
      shape: n.shape,
      x: n.x + offsetX,
      y: n.y + offsetY,
      width: n.width,
      height: n.height,
      members: n.members,
      methods: n.methods,
      lifelineHeight: n.lifelineHeight,
      data: n.data,
    });
    // Decoration nodes (chart backgrounds, axis labels, titles) are pinned so
    // they can't be dragged away by accident.
    if (n.data?.['locked']) node.set({ selectable: false, evented: false });
    return node;
  };

  for (const n of lockedNodes) canvas.add(buildNode(n));
  for (const e of model.edges) {
    canvas.add(
      new FlowEdge({
        edgeId: e.id,
        source: e.source,
        target: e.target,
        kind: e.kind,
        label: e.label,
        sourceLabel: e.sourceLabel,
        data: e.data,
        targetLabel: e.targetLabel,
        // seqY is an absolute canvas y in the same coordinate space as the
        // nodes, so it must be shifted by the same normalization offset.
        seqY: typeof e.seqY === 'number' ? e.seqY + offsetY : undefined,
      }),
    );
  }
  for (const n of unlockedNodes) canvas.add(buildNode(n));

  directions.set(canvas, model.direction);
  kinds.set(canvas, model.kind);
  metas.set(canvas, model.meta);
  getConnectionManager(canvas).updateAllEdges();
  fitToContent(canvas);
  canvas.requestRenderAll();
}

/**
 * Read the current canvas back into a DiagramModel (logic + current positions).
 */
export function extractModel(canvas: Canvas): DiagramModel {
  const nodes = [];
  const edges = [];
  const nodeIds = new Set<string>();
  for (const obj of canvas.getObjects()) {
    if (obj instanceof FlowNode) {
      nodes.push(obj.toDiagramNode());
      nodeIds.add(obj.nodeId);
    }
  }
  for (const obj of canvas.getObjects()) {
    if (obj instanceof FlowEdge) {
      // Drop dangling edges whose nodes were deleted.
      if (nodeIds.has(obj.source) && nodeIds.has(obj.target)) {
        const edge = obj.toDiagramEdge();
        // seqY lives on the canvas object; copy it onto the exported edge so
        // the order re-derivation below (and serialization) can see it.
        if (typeof obj.seqY === 'number') edge.seqY = obj.seqY;
        edges.push(edge);
      }
    }
  }
  // Sequence messages: the user may have dragged messages vertically, so the
  // authoritative order is the current y position, not the parse-time order.
  const seqEdges = edges.filter((e) => typeof e.seqY === 'number');
  seqEdges.sort((a, b) => (a.seqY as number) - (b.seqY as number));
  seqEdges.forEach((e, i) => {
    e.order = i;
  });
  const meta = metas.get(canvas);
  return {
    kind: kinds.get(canvas) ?? 'flowchart',
    direction: directions.get(canvas) ?? 'TD',
    nodes,
    edges,
    ...(meta ? { meta } : {}),
  };
}
