/**
 * Quadrant chart plugin: mermaid `quadrantChart` ⇄ DiagramModel.
 *
 * db.getQuadrantData() reports rendered pixel positions, so parsing
 * normalizes point coordinates back to 0..1 using the bounding box of the
 * four quadrant rectangles. On canvas, the four quadrants become 240x240
 * 'rect' nodes forming a fixed 480x480 plot area, and each data point is a
 * small 'circle' node. Serialization recomputes each point's normalized
 * coordinates from its canvas position relative to the quadrant nodes'
 * bounding box — dragging a point on canvas changes its exported [x, y].
 */
import { registerDiagram, type DiagramParseContext } from './registry';
import type { DiagramModel, DiagramNode } from '../model';
import { PALETTE_SOFT, PRIMARY, PAPER, INK } from '../theme';

/** Canvas plot area: quadrant nodes tile 80..560 in both axes. */
const PLOT = { x0: 80, y0: 80, w: 480, h: 480 };

/** Centers for quadrant nodes 1..4 (q1 top-right, q2 top-left, q3 bottom-left, q4 bottom-right). */
const QUADRANT_CENTERS: Array<[number, number]> = [
  [440, 200],
  [200, 200],
  [200, 440],
  [440, 440],
];

function dbCall<T>(db: Record<string, unknown>, name: string): T | undefined {
  const fn = db[name];
  if (typeof fn === 'function') return (fn as (this: unknown) => T).call(db);
  return undefined;
}

/** Extract plain text from either a string or a {text: string} wrapper. */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'text' in value) {
    const t = (value as { text: unknown }).text;
    return typeof t === 'string' ? t : '';
  }
  return '';
}

interface QuadrantRect {
  text?: unknown;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface QuadrantPoint {
  x: number;
  y: number;
  text?: unknown;
}

interface QuadrantData {
  title?: string;
  points?: QuadrantPoint[];
  quadrants?: QuadrantRect[];
  axisLabels?: Array<{ text?: unknown; x: number; y: number; rotation?: number }>;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Classify axisLabels into [xLeft, xRight, yBottom, yTop] regardless of how
 * many were declared. Official mermaid only emits the labels present (e.g.
 * `x-axis 左` alone), so blind index mapping would misattribute them; y-axis
 * labels carry rotation, x-axis ones do not, and position breaks ties.
 */
function classifyAxisLabels(
  axisLabels: NonNullable<QuadrantData['axisLabels']>,
): [string, string, string, string] {
  const xs = axisLabels.filter((l) => !l.rotation);
  const ys = axisLabels.filter((l) => Boolean(l.rotation));
  xs.sort((a, b) => a.x - b.x); // left → right
  ys.sort((a, b) => b.y - a.y); // bottom (larger pixel y) → top
  const t = (l?: { text?: unknown }): string => textOf(l?.text ?? l);
  return [t(xs[0]), t(xs[1]), t(ys[0]), t(ys[1])];
}

export function parseQuadrant(ctx: DiagramParseContext): DiagramModel {
  const data = dbCall<QuadrantData>(ctx.db, 'getQuadrantData') ?? {};
  const quadrants = data.quadrants ?? [];
  // mermaid returns points in reverse declaration order; restore it so the
  // serialized output matches the source line order.
  const points = [...(data.points ?? [])].reverse();
  const axisLabels = data.axisLabels ?? [];

  // Plot bbox in rendered pixel space, from the four quadrant rectangles.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const q of quadrants) {
    minX = Math.min(minX, q.x);
    minY = Math.min(minY, q.y);
    maxX = Math.max(maxX, q.x + q.width);
    maxY = Math.max(maxY, q.y + q.height);
  }
  const plotW = maxX - minX;
  const plotH = maxY - minY;

  const nodes: DiagramNode[] = [];

  // q1 (top-right, e.g. 快赢) green, q2 (top-left, 战略) sky,
  // q3 (bottom-left) red, q4 (bottom-right) amber — soft palette tints.
  const QUAD_COLORS = [PALETTE_SOFT[2], PALETTE_SOFT[4], PALETTE_SOFT[5], PALETTE_SOFT[3]];
  quadrants.forEach((q, i) => {
    const center = QUADRANT_CENTERS[i] ?? [PLOT.x0 + PLOT.w / 2, PLOT.y0 + PLOT.h / 2];
    nodes.push({
      id: `quad-${i + 1}`,
      label: textOf(q.text),
      shape: 'rect',
      x: center[0],
      y: center[1],
      width: 240,
      height: 240,
      // Backgrounds are locked (not draggable) and keep their label at the
      // top edge so data points never overlap the quadrant name.
      data: { role: 'quadrant', index: i + 1, locked: true, labelAlign: 'top', color: QUAD_COLORS[i % 4] },
    });
  });

  // Title + axis labels as locked text decorations (meta stays authoritative).
  const title =
    ((ctx.db['getDiagramTitle'] as (() => string) | undefined)?.call(ctx.db) ?? '') ||
    textOf(data.title);
  if (title) {
    nodes.push({
      id: 'quad-title',
      label: title,
      shape: 'text',
      x: PLOT.x0 + PLOT.w / 2,
      y: PLOT.y0 - 44,
      width: 300,
      height: 26,
      data: { role: 'title', locked: true, fontSize: 17, bold: true, color: INK },
    });
  }
  const [xLeft, xRight, yBottom, yTop] = classifyAxisLabels(axisLabels);
  const axisTexts: Array<[string, number, number]> = [
    [xLeft, PLOT.x0 + PLOT.w * 0.25, PLOT.y0 + PLOT.h + 24],
    [xRight, PLOT.x0 + PLOT.w * 0.75, PLOT.y0 + PLOT.h + 24],
    [yBottom, PLOT.x0 - 44, PLOT.y0 + PLOT.h * 0.75],
    [yTop, PLOT.x0 - 44, PLOT.y0 + PLOT.h * 0.25],
  ];
  axisTexts.forEach(([text, ax, ay], i) => {
    if (!text) return;
    nodes.push({
      id: `quad-axis-${i}`,
      label: text,
      shape: 'text',
      x: ax,
      y: ay,
      width: 80,
      height: 20,
      data: { role: 'axisLabel', locked: true },
    });
  });

  points.forEach((p, i) => {
    const nx = plotW > 0 ? (p.x - minX) / plotW : 0;
    const ny = plotH > 0 ? 1 - (p.y - minY) / plotH : 0;
    const name = textOf(p.text);
    nodes.push({
      id: `point-${i}`,
      label: name,
      shape: 'circle',
      x: PLOT.x0 + nx * PLOT.w,
      y: PLOT.y0 + (1 - ny) * PLOT.h,
      width: 20,
      height: 20,
      data: {
        role: 'point',
        name,
        x: nx,
        y: ny,
        color: PRIMARY,
        stroke: PAPER,
        labelAlign: 'bottom',
        fontSize: 12,
      },
    });
  });

  return {
    kind: 'quadrant',
    direction: 'TB',
    nodes,
    edges: [],
    meta: {
      // getQuadrantData().title can be a {text} object; the commonDb title
      // getter is the reliable string source right after parsing.
      title:
        ((ctx.db['getDiagramTitle'] as (() => string) | undefined)?.call(ctx.db) ?? '') ||
        textOf(data.title),
      xAxisLeft: xLeft,
      xAxisRight: xRight,
      yAxisBottom: yBottom,
      yAxisTop: yTop,
      q1: textOf(quadrants[0]?.text),
      q2: textOf(quadrants[1]?.text),
      q3: textOf(quadrants[2]?.text),
      q4: textOf(quadrants[3]?.text),
    },
  };
}

export function serializeQuadrant(model: DiagramModel): string {
  const meta = model.meta ?? {};
  const metaStr = (key: string): string => {
    const v = meta[key];
    return typeof v === 'string' ? v : '';
  };

  const lines = ['quadrantChart'];
  if (metaStr('title')) lines.push(`    title ${metaStr('title')}`);

  const xLeft = metaStr('xAxisLeft');
  const xRight = metaStr('xAxisRight');
  if (xLeft) lines.push(xRight ? `    x-axis ${xLeft} --> ${xRight}` : `    x-axis ${xLeft}`);
  const yBottom = metaStr('yAxisBottom');
  const yTop = metaStr('yAxisTop');
  if (yBottom) lines.push(yTop ? `    y-axis ${yBottom} --> ${yTop}` : `    y-axis ${yBottom}`);

  for (let i = 1; i <= 4; i++) {
    const label = metaStr(`q${i}`);
    if (label) lines.push(`    quadrant-${i} ${label}`);
  }

  // Recompute the plot area from the quadrant nodes' bounding box so that
  // dragging a point on canvas is reflected in the exported coordinates.
  const quadNodes = model.nodes.filter((n) => n.data?.role === 'quadrant');
  let plotX0 = PLOT.x0;
  let plotY0 = PLOT.y0;
  let plotW = PLOT.w;
  let plotH = PLOT.h;
  const hasPlot = quadNodes.length === 4;
  if (hasPlot) {
    const xs = quadNodes.map((n) => n.x);
    const ys = quadNodes.map((n) => n.y);
    plotX0 = Math.min(...xs) - 120;
    plotY0 = Math.min(...ys) - 120;
    plotW = Math.max(...xs) + 120 - plotX0;
    plotH = Math.max(...ys) + 120 - plotY0;
  }

  for (const node of model.nodes) {
    if (node.data?.role !== 'point') continue;
    let nx: number;
    let ny: number;
    if (hasPlot && plotW > 0 && plotH > 0) {
      nx = (node.x - plotX0) / plotW;
      ny = 1 - (node.y - plotY0) / plotH;
    } else {
      nx = Number(node.data.x ?? 0);
      ny = Number(node.data.y ?? 0);
    }
    nx = round2(clamp01(nx));
    ny = round2(clamp01(ny));
    const name = String(node.data.name ?? node.label);
    lines.push(`    ${name}: [${nx}, ${ny}]`);
  }

  return lines.join('\n');
}

registerDiagram({
  kind: 'quadrant',
  detects: ['quadrantChart'],
  parse: parseQuadrant,
  serialize: serializeQuadrant,
});
