/**
 * User journey plugin: mermaid `journey` ⇄ DiagramModel.
 *
 * Each task becomes a 'round' node in a single horizontal row. Score and
 * actors live in node.data; serialization rebuilds the source purely from
 * data/meta and never reads coordinates.
 */
import { registerDiagram, type DiagramParseContext } from './registry';
import type { DiagramModel, DiagramNode } from '../model';
import { paletteSoftAt, INK, FONT } from '../theme';

const LEFT = 130;
const STEP = 190;
const ROW_Y = 140;
const NODE_WIDTH = 160;
const NODE_HEIGHT = 56;

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

interface JourneyTask {
  section?: string;
  people?: unknown;
  task?: string;
  score?: number;
}

/** Score → card tint: red (bad) → amber → green (good). */
function scoreColor(score: number): string {
  if (score >= 4) return '#bbf7d0';
  if (score >= 3) return '#fde68a';
  return '#fecaca';
}

/**
 * Score → face, echoing the smiley faces official mermaid renders per task.
 * Display-only prefix — data.task stays the pure name for serialization.
 */
function scoreFace(score: number): string {
  if (score >= 4) return '😀';
  if (score >= 3) return '😐';
  return '☹️';
}

export function parseJourney(ctx: DiagramParseContext): DiagramModel {
  const { db } = ctx;
  const tasks = asArray(callGetter(db, 'getTasks')) as JourneyTask[];
  const sections = asArray(callGetter(db, 'getSections')).map(String);
  const title = String(callGetter(db, 'getDiagramTitle') ?? '');

  const nodes: DiagramNode[] = [];
  if (title) {
    nodes.push({
      id: 'journey-title',
      label: title,
      shape: 'text',
      x: LEFT + (Math.max(1, tasks.length) * STEP) / 2,
      y: 36,
      width: 320,
      height: 26,
      data: { role: 'title', locked: true, fontSize: 17, bold: true, color: INK },
    });
  }

  // Task cards show name + score + actors; the raw fields live in data and
  // stay authoritative for serialization.
  const sectionSpan = new Map<string, { minX: number; maxX: number }>();
  tasks.forEach((t, i) => {
    const task = String(t.task ?? '').trim();
    const score = typeof t.score === 'number' ? t.score : Number(t.score ?? 0);
    const people = asArray(t.people).map(String);
    const section = String(t.section ?? '');
    const x = LEFT + i * STEP;
    const info = `⭐ ${score}${people.length ? ' · ' + people.join('、') : ''}`;
    nodes.push({
      id: `task${i}`,
      label: `${scoreFace(score)} ${task}\n${info}`,
      shape: 'round',
      x,
      y: ROW_Y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT + 16,
      data: {
        role: 'task',
        task,
        section,
        score,
        people,
        order: i,
        color: scoreColor(score),
        fontSize: 12.5,
      },
    });
    const span = sectionSpan.get(section) ?? { minX: x, maxX: x };
    span.minX = Math.min(span.minX, x);
    span.maxX = Math.max(span.maxX, x);
    sectionSpan.set(section, span);
  });

  // Section headers sit above their task group.
  let s = 0;
  for (const [section, span] of sectionSpan) {
    if (!section) continue;
    nodes.push({
      id: `section${s}`,
      label: section,
      shape: 'stadium',
      x: (span.minX + span.maxX) / 2,
      y: 78,
      width: Math.max(120, span.maxX - span.minX + NODE_WIDTH * 0.7),
      height: 34,
      data: { role: 'section', locked: true, color: paletteSoftAt(s), fontSize: FONT.body },
    });
    s++;
  }

  return {
    kind: 'journey',
    direction: 'LR',
    nodes,
    edges: [],
    meta: { title, sections },
  };
}

export function serializeJourney(model: DiagramModel): string {
  const meta = model.meta ?? {};
  const title = String(meta.title ?? '');
  const sections = Array.isArray(meta.sections) ? meta.sections.map(String) : [];

  const lines: string[] = ['journey'];
  if (title) lines.push(`    title ${title}`);

  // Group by section: known sections in meta order, unknown ones appended.
  const groups = new Map<string, DiagramNode[]>();
  for (const s of sections) groups.set(s, []);
  const extraOrder: string[] = [];
  for (const node of model.nodes) {
    // Only task cards serialize; titles/section headers are decoration.
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
      const score = Number(node.data?.score ?? 0);
      const people = Array.isArray(node.data?.people)
        ? (node.data!.people as unknown[]).map(String)
        : [];
      // data.task is authoritative; multi-line display labels keep only the
      // first line as a fallback name (minus the display-only face prefix).
      const task = String(node.data?.task ?? node.label.split('\n')[0] ?? '')
        .replace(/^(?:😀|😐|☹️)\s*/u, '')
        .trim();
      lines.push(
        people.length > 0
          ? `      ${task}: ${score}: ${people.join(', ')}`
          : `      ${task}: ${score}`,
      );
    }
  };

  for (const s of sections) emitGroup(s, groups.get(s)!);
  for (const s of extraOrder) emitGroup(s, groups.get(s)!);

  return lines.join('\n');
}

registerDiagram({
  kind: 'journey',
  detects: ['journey'],
  parse: parseJourney,
  serialize: serializeJourney,
});
