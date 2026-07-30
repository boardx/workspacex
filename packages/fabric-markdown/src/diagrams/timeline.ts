/**
 * Timeline plugin: mermaid `timeline` ⇄ DiagramModel.
 *
 * Classic center-axis look: a horizontal axis bar (locked decoration) runs
 * through the canvas; each period is a milestone pill sitting ON the axis,
 * and its event cards alternate above/below the axis (even periods above,
 * odd below), each card connected straight back to its period.
 *
 * Membership is recorded in event.data.period; serialization rebuilds the
 * source purely from data/meta and never reads coordinates or edges.
 */
import { registerDiagram, type DiagramParseContext } from './registry';
import type { DiagramModel, DiagramNode, DiagramEdge } from '../model';
import { INK, LINE, PAPER, PRIMARY_SOFT, paletteSoftAt } from '../theme';

/** y of the horizontal center axis. */
const AXIS_Y = 320;
/** Axis bar thickness and color (slate-400). */
const AXIS_HEIGHT = 4;
const AXIS_COLOR = '#94a3b8';
/** Axis extends from AXIS_LEFT to (last period x + AXIS_OVERHANG). */
const AXIS_LEFT = 100;
const AXIS_OVERHANG = 80;

const PERIOD_LEFT = 200;
const PERIOD_STEP = 260;
const PERIOD_WIDTH = 150;
const PERIOD_HEIGHT = 48;

const EVENT_WIDTH = 170;
const EVENT_HEIGHT = 52;
/** Distance from axis to the first event card's center. */
const EVENT_OFFSET = 90;
/** Vertical step between stacked event cards of one period. */
const EVENT_STEP = 66;

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

interface TimelineTask {
  section?: string;
  task?: string;
  events?: unknown;
}

export function parseTimeline(ctx: DiagramParseContext): DiagramModel {
  const { db } = ctx;
  const tasks = asArray(callGetter(db, 'getTasks')) as TimelineTask[];
  // Timeline keeps its title on the common db, not the diagram db itself.
  const title = String(
    ((db['getCommonDb'] as (() => { getDiagramTitle?: () => unknown }) | undefined)?.())
      ?.getDiagramTitle?.() ?? '',
  );

  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const sections: string[] = [];
  const sectionOf: Record<string, string> = {};

  const count = Math.max(1, tasks.length);
  const axisRight = PERIOD_LEFT + (count - 1) * PERIOD_STEP + AXIS_OVERHANG;
  const axisCenterX = (AXIS_LEFT + axisRight) / 2;

  if (title) {
    nodes.push({
      id: 'timeline-title',
      label: title,
      shape: 'text',
      x: axisCenterX,
      y: 40,
      width: 320,
      height: 26,
      data: { role: 'title', locked: true, fontSize: 17, bold: true, color: INK },
    });
  }

  // The horizontal center axis: a locked decoration bar spanning all periods.
  nodes.push({
    id: 'timeline-axis',
    label: '',
    shape: 'rect',
    x: axisCenterX,
    y: AXIS_Y,
    width: axisRight - AXIS_LEFT,
    height: AXIS_HEIGHT,
    data: { role: 'decoration', locked: true, color: AXIS_COLOR },
  });

  tasks.forEach((t, i) => {
    const periodLabel = String(t.task ?? '').trim();
    const section = String(t.section ?? '');
    if (section && !sections.includes(section)) sections.push(section);
    sectionOf[periodLabel] = section;
    const x = PERIOD_LEFT + i * PERIOD_STEP;

    // Milestone pill sitting directly on the axis. Sections rotate the soft
    // palette (official timeline colors periods per section); without
    // sections every pill keeps the primary-soft fill.
    const pillColor = section ? paletteSoftAt(sections.indexOf(section)) : PRIMARY_SOFT;
    nodes.push({
      id: `period${i}`,
      label: periodLabel,
      shape: 'stadium',
      x,
      y: AXIS_Y,
      width: PERIOD_WIDTH,
      height: PERIOD_HEIGHT,
      data: { order: i, role: 'period', color: pillColor, fontSize: 15 },
    });
    // Time flows left → right between periods.
    if (i > 0) {
      edges.push({ id: `flow${i}`, source: `period${i - 1}`, target: `period${i}`, kind: 'arrow' });
    }

    // Event cards alternate: even periods above the axis, odd below.
    const side = i % 2 === 0 ? -1 : 1;
    asArray(t.events).forEach((ev, j) => {
      nodes.push({
        id: `event${i}_${j}`,
        label: String(ev).trim(),
        shape: 'rect',
        x,
        y: AXIS_Y + side * (EVENT_OFFSET + j * EVENT_STEP),
        width: EVENT_WIDTH,
        height: EVENT_HEIGHT,
        data: { period: periodLabel, order: i, eventOrder: j, role: 'event', color: PAPER, stroke: LINE },
      });
      // Every card connects straight back to its period pill (fan layout).
      edges.push({
        id: `hang${i}_${j}`,
        source: `period${i}`,
        target: `event${i}_${j}`,
        kind: 'open',
        data: { color: AXIS_COLOR, straight: true },
      });
    });
  });

  return {
    kind: 'timeline',
    direction: 'LR',
    nodes,
    edges,
    meta: { title, sections, sectionOf },
  };
}

export function serializeTimeline(model: DiagramModel): string {
  const meta = model.meta ?? {};
  const title = String(meta.title ?? '');
  const sectionOf = (meta.sectionOf ?? {}) as Record<string, unknown>;

  const lines: string[] = ['timeline'];
  if (title) lines.push(`    title ${title}`);

  const periods = model.nodes
    .filter((n) => n.data?.role === 'period')
    .sort((a, b) => Number(a.data?.order ?? 0) - Number(b.data?.order ?? 0));
  const events = model.nodes.filter((n) => n.data?.role === 'event');

  let currentSection = '';
  for (const period of periods) {
    const section = String(sectionOf[period.label] ?? '');
    if (section && section !== currentSection) {
      lines.push(`    section ${section}`);
      currentSection = section;
    }
    const own = events
      .filter((e) => String(e.data?.period ?? '') === period.label)
      .sort((a, b) => Number(a.data?.eventOrder ?? 0) - Number(b.data?.eventOrder ?? 0));
    const parts = [period.label, ...own.map((e) => e.label)];
    lines.push(`    ${parts.join(' : ')}`);
  }

  return lines.join('\n');
}

registerDiagram({
  kind: 'timeline',
  detects: ['timeline'],
  parse: parseTimeline,
  serialize: serializeTimeline,
});
