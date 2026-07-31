/**
 * Gantt chart plugin: mermaid `gantt` ⇄ DiagramModel.
 *
 * Each task becomes a 'rect' node laid out on a horizontal time axis
 * (26 px/day, origin = earliest task start). Logical data (section, dates,
 * order) lives in node.data; serialization rebuilds the source purely from
 * data/meta and never reads coordinates.
 */
import { registerDiagram, type DiagramParseContext } from './registry';
import type { DiagramModel, DiagramNode } from '../model';
import { paletteAt, paletteSoftAt, INK_SOFT, FONT } from '../theme';

const MS_PER_DAY = 86_400_000;
const SCALE = 26; // px per day
const LEFT = 180;
const TOP = 90;
const ROW = 54;
const BAR_HEIGHT = 34;
const MIN_BAR_WIDTH = 90;
const TICK_Y = 58;
const GRID_TOP = 70;
const GRID_COLOR = '#e2e8f0';

/** Call a db getter defensively; normalize Map/object results into arrays. */
function callGetter(db: Record<string, unknown>, name: string): unknown {
  const fn = db[name];
  if (typeof fn !== 'function') return undefined;
  return (fn as () => unknown).call(db);
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v instanceof Map) return Array.from(v.values());
  if (v && typeof v === 'object') return Object.values(v);
  return [];
}

function asDate(v: unknown): Date {
  if (v instanceof Date) return v;
  return new Date(String(v));
}

/** Local-timezone YYYY-MM-DD (toISOString would shift across timezones). */
function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface GanttTask {
  section?: string;
  task?: string;
  id?: string;
  order?: number;
  startTime?: unknown;
  endTime?: unknown;
  // Official task tags (mermaid ganttDb sets these booleans on each task).
  milestone?: boolean;
  crit?: boolean;
  active?: boolean;
  done?: boolean;
  // Raw parse info; startTime.startData keeps the source start token
  // (e.g. "after a1") for lossless serialization.
  raw?: { startTime?: { startData?: unknown } };
}

/** Serialization order for task tags, matching official examples. */
const TAG_ORDER = ['milestone', 'crit', 'active', 'done'] as const;

/** Styling for tagged tasks (crit border / done fill, VISUAL-SPEC §2). */
const CRIT_STROKE = '#f87171';
const DONE_FILL = '#e2e8f0';
const DONE_INK = '#94a3b8';

/** Darken a #rrggbb color (deeper border for `active` tasks). */
function darken(hex: string, factor = 0.72): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function parseGantt(ctx: DiagramParseContext): DiagramModel {
  const { db } = ctx;
  const tasks = asArray(callGetter(db, 'getTasks')) as GanttTask[];
  const sections = asArray(callGetter(db, 'getSections')).map(String);
  const title = String(callGetter(db, 'getDiagramTitle') ?? '');
  const dateFormat = String(callGetter(db, 'getDateFormat') ?? '') || 'YYYY-MM-DD';

  let minStart = Infinity;
  let maxEnd = -Infinity;
  const parsed = tasks.map((t) => {
    const start = asDate(t.startTime);
    const end = asDate(t.endTime);
    if (start.getTime() < minStart) minStart = start.getTime();
    if (end.getTime() > maxEnd) maxEnd = end.getTime();
    return { t, start, end };
  });

  // Section → palette index, following the declared section order first.
  const sectionIndex = new Map<string, number>();
  for (const s of sections) if (!sectionIndex.has(s)) sectionIndex.set(s, sectionIndex.size);

  const usedIds = new Set<string>();
  const nodes: DiagramNode[] = parsed.map(({ t, start, end }, i) => {
    const days = Math.max(0, (end.getTime() - start.getTime()) / MS_PER_DAY);
    const width = Math.max(MIN_BAR_WIDTH, days * SCALE);
    const offsetDays = (start.getTime() - minStart) / MS_PER_DAY;
    const taskId = String(t.id ?? '');
    let nodeId = taskId;
    if (!nodeId || usedIds.has(nodeId)) nodeId = `task${i}`;
    usedIds.add(nodeId);
    const section = String(t.section ?? '');
    if (!sectionIndex.has(section)) sectionIndex.set(section, sectionIndex.size);
    const si = sectionIndex.get(section)!;

    // Official task tags → data.flags (authoritative for serialization).
    const flags = TAG_ORDER.filter((f) => t[f] === true);
    const milestone = flags.includes('milestone');
    // Tag styling: done → gray fill + gray ink; crit → red border
    // (crit beats active); active → deepened section border.
    let color = flags.includes('done') ? DONE_FILL : paletteSoftAt(si);
    let stroke = paletteAt(si);
    if (flags.includes('active')) stroke = darken(paletteAt(si));
    if (flags.includes('crit')) stroke = CRIT_STROKE;
    if (milestone && !flags.includes('done')) color = paletteAt(si);

    const data: Record<string, unknown> = {
      role: 'task',
      section,
      taskId,
      start: localDate(start),
      end: localDate(end),
      order: typeof t.order === 'number' ? t.order : i,
      color,
      stroke,
    };
    if (flags.length > 0) data.flags = flags;
    if (flags.includes('done')) data.textColor = DONE_INK;
    if (milestone) data.labelAlign = 'bottom';
    // Preserve the raw start token ("after a1" dependencies) losslessly.
    const startData = t.raw?.startTime?.startData;
    if (typeof startData === 'string' && startData.trim()) data.rawStart = startData.trim();

    // Milestones render as a small diamond centered on the date point.
    return {
      id: nodeId,
      label: String(t.task ?? '').trim(),
      shape: milestone ? 'diamond' : 'rect',
      x: milestone ? LEFT + offsetDays * SCALE : LEFT + offsetDays * SCALE + width / 2,
      y: TOP + i * ROW,
      width: milestone ? 28 : width,
      height: milestone ? 28 : BAR_HEIGHT,
      data,
    } as DiagramNode;
  });

  // Top time scale + vertical gridlines (decorations, never serialized).
  if (parsed.length > 0 && Number.isFinite(minStart) && Number.isFinite(maxEnd)) {
    const spanDays = (maxEnd - minStart) / MS_PER_DAY;
    const gridHeight = tasks.length * ROW + 20;
    const ticks: Date[] = [];
    if (spanDays > 60) {
      // Monthly ticks: start date, then the 1st of each following month.
      const d = new Date(minStart);
      ticks.push(new Date(d));
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      while (d.getTime() <= maxEnd) {
        ticks.push(new Date(d));
        d.setMonth(d.getMonth() + 1);
      }
    } else {
      for (let ms = minStart; ms <= maxEnd; ms += 7 * MS_PER_DAY) ticks.push(new Date(ms));
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    ticks.forEach((d, k) => {
      const x = LEFT + ((d.getTime() - minStart) / MS_PER_DAY) * SCALE;
      nodes.push({
        id: `tick${k}`,
        label: `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        shape: 'text',
        x,
        y: TICK_Y,
        width: 48,
        height: 16,
        data: { role: 'decoration', locked: true, fontSize: FONT.small, color: INK_SOFT },
      });
      nodes.push({
        id: `grid${k}`,
        label: '',
        shape: 'rect',
        x,
        y: GRID_TOP + gridHeight / 2,
        width: 2,
        height: gridHeight,
        data: { role: 'decoration', locked: true, color: GRID_COLOR, stroke: 'transparent' },
      });
    });
  }

  // Section group labels on the left, before each section's first row.
  const seenSections = new Set<string>();
  parsed.forEach(({ t }, i) => {
    const section = String(t.section ?? '');
    if (!section || seenSections.has(section)) return;
    seenSections.add(section);
    const si = sectionIndex.get(section)!;
    nodes.push({
      id: `sectionLabel${si}`,
      label: section,
      shape: 'text',
      x: 90,
      y: TOP + i * ROW,
      width: 140,
      height: 20,
      data: {
        role: 'decoration',
        locked: true,
        bold: true,
        align: 'left',
        fontSize: FONT.section,
        color: paletteAt(si),
      },
    });
  });

  return {
    kind: 'gantt',
    direction: 'LR',
    nodes,
    edges: [],
    meta: { title, dateFormat, sections },
  };
}

export function serializeGantt(model: DiagramModel): string {
  const meta = model.meta ?? {};
  const title = String(meta.title ?? '');
  const dateFormat = String(meta.dateFormat ?? '') || 'YYYY-MM-DD';
  const sections = Array.isArray(meta.sections) ? meta.sections.map(String) : [];

  const lines: string[] = ['gantt'];
  if (title) lines.push(`    title ${title}`);
  lines.push(`    dateFormat ${dateFormat}`);

  // Group nodes by section: known sections in meta order, unknown ones last
  // (each forming its own section, in first-seen order).
  const groups = new Map<string, DiagramNode[]>();
  for (const s of sections) groups.set(s, []);
  const extraOrder: string[] = [];
  for (const node of model.nodes) {
    // Only task bars serialize. Older models carry no role, so anything
    // without an explicit non-task role still counts as a task.
    const role = node.data?.role;
    if (role !== undefined && role !== 'task') continue;
    const section = String(node.data?.section ?? '');
    if (!groups.has(section)) {
      groups.set(section, []);
      extraOrder.push(section);
    }
    groups.get(section)!.push(node);
  }

  const emitGroup = (section: string, nodes: DiagramNode[]) => {
    if (nodes.length === 0) return;
    if (section) lines.push(`    section ${section}`);
    const sorted = [...nodes].sort(
      (a, b) => Number(a.data?.order ?? 0) - Number(b.data?.order ?? 0),
    );
    for (const node of sorted) {
      const taskId = String(node.data?.taskId ?? '');
      // Prefer the raw start token ("after a1") over the computed date.
      const start = String(node.data?.rawStart ?? node.data?.start ?? '');
      const end = String(node.data?.end ?? '');
      // Restore official task tags in canonical order: milestone, crit, active, done.
      const flags = Array.isArray(node.data?.flags) ? node.data!.flags.map(String) : [];
      const parts: string[] = TAG_ORDER.filter((f) => flags.includes(f));
      if (taskId) parts.push(taskId);
      parts.push(start, end);
      lines.push(`    ${node.label} :${parts.join(', ')}`);
    }
  };

  for (const s of sections) emitGroup(s, groups.get(s)!);
  for (const s of extraOrder) emitGroup(s, groups.get(s)!);

  return lines.join('\n');
}

registerDiagram({
  kind: 'gantt',
  detects: ['gantt'],
  parse: parseGantt,
  serialize: serializeGantt,
});
