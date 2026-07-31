/**
 * Keeps FlowEdge endpoints attached to their FlowNodes while nodes move.
 *
 * Fabric has no native connector concept, so we listen to object:moving /
 * object:modified and recompute the straight-line anchor points between the
 * connected nodes' boundaries.
 */
import type { Canvas, FabricObject } from 'fabric';
import { ActiveSelection } from 'fabric';
import { FlowNode, FlowEdge } from './fabric-objects';

/**
 * Point on the boundary of `node` along the ray from its center toward
 * (tx, ty). Uses bounding-box intersection for rect-ish shapes and radial
 * intersection for circles/diamonds — visually close enough for v1.
 */
export function anchorPoint(node: FlowNode, tx: number, ty: number): { x: number; y: number } {
  const c = node.center();
  const dx = tx - c.x;
  const dy = ty - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = (node.width * (node.scaleX ?? 1)) / 2;
  const hh = (node.height * (node.scaleY ?? 1)) / 2;

  // stateStart/stateEnd are drawn as (concentric) circles, so they share the
  // radial-intersection math with 'circle'.
  if (node.shape === 'circle' || node.shape === 'stateStart' || node.shape === 'stateEnd') {
    const r = Math.max(hw, hh);
    const len = Math.hypot(dx, dy);
    return { x: c.x + (dx / len) * r, y: c.y + (dy / len) * r };
  }
  if (node.shape === 'diamond') {
    // |x|/hw + |y|/hh = 1 boundary
    const t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    return { x: c.x + dx * t, y: c.y + dy * t };
  }
  // Rectangle boundary intersection. Near a corner the box intersection can
  // poke past a rounded corner's arc, so pull the anchor 1px back toward the
  // center along the ray to keep line ends from sitting on the border stroke.
  const tX = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const tY = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(tX, tY);
  const len = Math.hypot(dx, dy);
  const inset = Math.min(1, len * t); // never overshoot past the center
  return { x: c.x + dx * t - (dx / len) * inset, y: c.y + dy * t - (dy / len) * inset };
}

export class ConnectionManager {
  private canvas: Canvas;
  private handler: (opt: { target?: FabricObject }) => void;

  constructor(canvas: Canvas) {
    this.canvas = canvas;
    this.handler = (opt) => {
      const target = opt.target;
      if (!target) return;
      if (target instanceof FlowNode) {
        this.updateEdgesFor([target.nodeId]);
      } else if (target instanceof ActiveSelection) {
        const ids = target
          .getObjects()
          .filter((o): o is FlowNode => o instanceof FlowNode)
          .map((n) => n.nodeId);
        if (ids.length > 0) this.updateEdgesFor(ids);
      }
    };
    canvas.on('object:moving', this.handler);
    canvas.on('object:modified', this.handler);
  }

  dispose(): void {
    this.canvas.off('object:moving', this.handler);
    this.canvas.off('object:modified', this.handler);
  }

  private nodesById(): Map<string, FlowNode> {
    const map = new Map<string, FlowNode>();
    for (const obj of this.canvas.getObjects()) {
      if (obj instanceof FlowNode) map.set(obj.nodeId, obj);
    }
    return map;
  }

  /** Recompute endpoints of every edge touching any of the given node ids. */
  updateEdgesFor(nodeIds: string[]): void {
    const idSet = new Set(nodeIds);
    const nodes = this.nodesById();
    for (const obj of this.canvas.getObjects()) {
      if (!(obj instanceof FlowEdge)) continue;
      if (!idSet.has(obj.source) && !idSet.has(obj.target)) continue;
      this.routeEdge(obj, nodes);
    }
    this.canvas.requestRenderAll();
  }

  /** Recompute endpoints of all edges (e.g. right after initial render). */
  updateAllEdges(): void {
    const nodes = this.nodesById();
    for (const obj of this.canvas.getObjects()) {
      if (obj instanceof FlowEdge) this.routeEdge(obj, nodes);
    }
    this.canvas.requestRenderAll();
  }

  private routeEdge(edge: FlowEdge, nodes: Map<string, FlowNode>): void {
    const src = nodes.get(edge.source);
    const tgt = nodes.get(edge.target);
    if (!src || !tgt) return;
    const sc = src.center();
    const tc = tgt.center();
    // Sequence messages are horizontal lines between lifelines: x comes from
    // each participant's box center (a participant's group center shares the
    // box's x — the lifeline only extends it downward), y from the message's
    // own seqY. No boundary clipping — arrowheads sit directly on the lifeline.
    if (typeof edge.seqY === 'number') {
      // Self-message (A->>A): a vertical span on the lifeline; FlowEdge
      // renders it as the classic right-hand loop with a return arrow.
      if (edge.source === edge.target) {
        edge.setEndpoints(sc.x, edge.seqY, sc.x, edge.seqY + 28);
      } else {
        edge.setEndpoints(sc.x, edge.seqY, tc.x, edge.seqY);
      }
      return;
    }
    // Mindmap edges always leave/enter at the horizontal mid-point of the
    // facing side (not wherever a center-to-center ray happens to cross the
    // box), matching the S-curve renderer and avoiding anchors that creep
    // toward a corner when the child sits well above/below its parent.
    if (edge.data?.['mindmap'] === true) {
      const srcHW = (src.width * (src.scaleX ?? 1)) / 2;
      const tgtHW = (tgt.width * (tgt.scaleX ?? 1)) / 2;
      const goingRight = tc.x >= sc.x;
      const ax = goingRight ? sc.x + srcHW : sc.x - srcHW;
      const bx = goingRight ? tc.x - tgtHW : tc.x + tgtHW;
      edge.setEndpoints(ax, sc.y, bx, tc.y);
      return;
    }
    const a = anchorPoint(src, tc.x, tc.y);
    const b = anchorPoint(tgt, sc.x, sc.y);
    edge.setEndpoints(a.x, a.y, b.x, b.y);
  }
}
