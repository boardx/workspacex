/**
 * Pie chart plugin: mermaid `pie` ⇄ DiagramModel.
 *
 * Each section becomes one 'pieSlice' node — a real sector whose angles are
 * proportional to its value, all sharing the same pie center. The section's
 * name/value live in node.data (authoritative for serialization — label
 * edits and slice dragging do not affect output). Title/showData live in
 * model.meta; the title is shown as a locked text node.
 *
 * Visual extras (VISUAL-SPEC §2 pie): slices use the theme PALETTE; narrow
 * slices (span < 0.35 rad) get their label moved outside as a draggable text
 * node tinted with a darkened slice color; a legend column (swatch + name
 * value) is rendered to the right. None of these decoration nodes carry
 * `value` in data, so serializePie ignores them.
 */
import { registerDiagram, type DiagramParseContext } from './registry';
import type { DiagramModel, DiagramNode } from '../model';
import { paletteAt, INK, FONT } from '../theme';

/** Call a db getter if present (mermaid db exposes getters as functions). */
function dbCall<T>(db: Record<string, unknown>, name: string): T | undefined {
  const fn = db[name];
  if (typeof fn === 'function') return (fn as (this: unknown) => T).call(db);
  return undefined;
}

/** Normalize a Map or plain object into [name, value] entries. */
function toEntries(value: unknown): Array<[string, number]> {
  if (value instanceof Map) {
    return [...(value as Map<string, number>).entries()];
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, number>);
  }
  return [];
}

/** Darken a #rrggbb color by a factor (readable label ink from a slice hue). */
function darken(hex: string, factor = 0.55): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const PIE_R = 150;
const PIE_CX = 240;
const PIE_CY = 230;
/** Slices narrower than this (radians) get their label moved outside. */
const NARROW_SPAN = 0.35;
/** Outside labels sit on the bisector at this multiple of the radius. */
const LABEL_R = 1.18;

export function parsePie(ctx: DiagramParseContext): DiagramModel {
  const { db } = ctx;
  const sections = toEntries(dbCall(db, 'getSections'));
  const title = dbCall<string>(db, 'getDiagramTitle') ?? '';
  const showData = dbCall<boolean>(db, 'getShowData') ?? false;

  const total = sections.reduce((sum, [, v]) => sum + (Number(v) || 0), 0) || 1;
  const nodes: DiagramNode[] = [];
  if (title) {
    nodes.push({
      id: 'pie-title',
      label: title,
      shape: 'text',
      x: PIE_CX,
      y: 34,
      width: 320,
      height: 26,
      data: { role: 'title', locked: true, fontSize: 17, bold: true, color: INK },
    });
  }
  let angle = 0;
  sections.forEach(([name, value], order) => {
    const span = ((Number(value) || 0) / total) * Math.PI * 2;
    const pct = Math.round(((Number(value) || 0) / total) * 100);
    const color = paletteAt(order);
    const narrow = span < NARROW_SPAN;
    nodes.push({
      id: `pie-${order}`,
      label: narrow ? '' : `${name} ${pct}%`,
      shape: 'pieSlice',
      x: PIE_CX,
      y: PIE_CY,
      width: PIE_R * 2,
      height: PIE_R * 2,
      data: {
        name,
        value,
        order,
        r: PIE_R,
        a1: angle,
        a2: angle + span,
        color,
      },
    });
    if (narrow) {
      // Outside label on the slice bisector, tinted a dark shade of the
      // slice hue; draggable (not locked) so users can fine-tune placement.
      const mid = angle + span / 2;
      nodes.push({
        id: `pie-label-${order}`,
        label: `${name} ${pct}%`,
        shape: 'text',
        x: PIE_CX + Math.cos(mid) * PIE_R * LABEL_R,
        y: PIE_CY + Math.sin(mid) * PIE_R * LABEL_R,
        width: 120,
        height: 18,
        data: { role: 'sliceLabel', color: darken(color), fontSize: FONT.small },
      });
    }
    angle += span;
  });

  // Legend column to the right: swatch + "name value" per section.
  const legendX = PIE_CX + PIE_R + 120;
  const legendY0 = PIE_CY - PIE_R + 16;
  sections.forEach(([name, value], order) => {
    const color = paletteAt(order);
    const rowY = legendY0 + order * 28;
    nodes.push({
      id: `pie-legend-swatch-${order}`,
      label: '',
      shape: 'rect',
      x: legendX,
      y: rowY,
      width: 16,
      height: 16,
      data: { role: 'legend', locked: true, color, stroke: 'transparent' },
    });
    nodes.push({
      id: `pie-legend-label-${order}`,
      label: `${name} ${value}`,
      shape: 'text',
      x: legendX + 90,
      y: rowY,
      width: 150,
      height: 18,
      data: { role: 'legend', locked: true, align: 'left', fontSize: FONT.body, color: INK },
    });
  });

  return {
    kind: 'pie',
    direction: 'TB',
    nodes,
    edges: [],
    meta: { title, showData },
  };
}

export function serializePie(model: DiagramModel): string {
  const meta = model.meta ?? {};
  let header = 'pie';
  if (meta.showData === true) header += ' showData';
  const title = typeof meta.title === 'string' ? meta.title : '';
  if (title) header += ` title ${title}`;

  const entries = model.nodes
    .filter((n) => n.data && 'value' in n.data)
    .slice()
    .sort((a, b) => Number(a.data?.order ?? 0) - Number(b.data?.order ?? 0));

  const lines = [header];
  for (const node of entries) {
    const name = String(node.data?.name ?? node.id).replace(/"/g, "'");
    const value = node.data?.value ?? 0;
    lines.push(`    "${name}" : ${value}`);
  }
  return lines.join('\n');
}

registerDiagram({
  kind: 'pie',
  detects: ['pie'],
  parse: parsePie,
  serialize: serializePie,
});
