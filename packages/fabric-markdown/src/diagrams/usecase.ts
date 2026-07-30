/**
 * UML Use Case Diagram (```usecase fence — NOT a mermaid type).
 *
 * Like ```persona/```canvas, the text is parsed directly (no mermaid pass).
 * Syntax (half- and full-width brackets/arrows both accepted):
 *
 *   系统: 在线商城            ← optional system-boundary title
 *   actor 顾客               ← declare an actor
 *   顾客 -> (浏览商品)        ← actor→usecase association (usecase auto-created)
 *   (下单) include (支付)     ← «include» between usecases
 *   (下单) extend (使用优惠券) ← «extend» between usecases
 *
 * Canvas mapping (zero new fabric shapes):
 *   actor    → shape 'text', label "🧍\n名字",   data { role: 'actor', name }
 *   usecase  → shape 'stadium' (capsule≈ellipse), data { role: 'usecase', name }
 *   boundary → locked decoration rect + locked title text around all usecases
 *   assoc    → edge kind 'open'   (straight line)
 *   include  → edge kind 'dotted' label '«include»'
 *   extend   → edge kind 'dotted' label '«extend»'
 *
 * NOTE: node names containing parentheses are not escapable (soft doc
 * constraint, same spirit as mermaid labels).
 */
import { registerDiagram } from './registry';
import type { DiagramModel, DiagramNode, DiagramEdge, DiagramKind } from '../model';
import { INK, PAPER } from '../theme';

/**
 * Cast needed until the integrator adds 'usecase' to the DiagramKind union in
 * src/model.ts (shared file — not touched here by design).
 */
const KIND = 'usecase' as DiagramKind;

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const ACTOR_X = 140;
const ACTOR_Y0 = 160;
const ACTOR_STEP = 150;
const ACTOR_W = 110;
const ACTOR_H = 64;

const UC_COL_X = [620, 960] as const;
const UC_Y0 = 140;
const UC_STEP = 110;
const UC_H = 56;
const BOUNDARY_PAD = 40;

const ucWidth = (name: string): number => Math.min(300, Math.max(150, name.length * 16));

// ---------------------------------------------------------------------------
// Text parsing
// ---------------------------------------------------------------------------

type RelType = 'assoc' | 'include' | 'extend';

interface Rel {
  type: RelType;
  /** Actor name (assoc from actor) or usecase name. */
  source: string;
  sourceIsUsecase: boolean;
  /** Always a usecase name. */
  target: string;
}

/** Normalize full-width punctuation so one regex set handles both. */
function normalizeLine(raw: string): string {
  return raw
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/→/g, '->')
    .replace(/：/g, ':')
    .trim();
}

export function parseUsecase(code: string): DiagramModel {
  let system = '';
  const actors: string[] = [];
  const actorSet = new Set<string>();
  const usecases: string[] = [];
  const usecaseSet = new Set<string>();
  const rels: Rel[] = [];

  const addActor = (name: string): void => {
    if (!actorSet.has(name)) {
      actorSet.add(name);
      actors.push(name);
    }
  };
  const addUsecase = (name: string): void => {
    if (!usecaseSet.has(name)) {
      usecaseSet.add(name);
      usecases.push(name);
    }
  };

  for (const raw of code.split('\n')) {
    const line = normalizeLine(raw);
    if (line === '' || line.startsWith('%%') || line.startsWith('//')) continue;

    const sys = /^(?:系统|system)\s*:\s*(.+)$/i.exec(line);
    if (sys) {
      system = sys[1]!.trim();
      continue;
    }

    const actor = /^actor\s+(.+)$/i.exec(line);
    if (actor) {
      addActor(actor[1]!.trim());
      continue;
    }

    const inc = /^\((.+?)\)\s*(include|extend)\s*\((.+?)\)$/i.exec(line);
    if (inc) {
      const a = inc[1]!.trim();
      const b = inc[3]!.trim();
      addUsecase(a);
      addUsecase(b);
      rels.push({ type: inc[2]!.toLowerCase() as RelType, source: a, sourceIsUsecase: true, target: b });
      continue;
    }

    const assoc = /^(.+?)\s*->\s*\((.+?)\)$/.exec(line);
    if (assoc) {
      let src = assoc[1]!.trim();
      const tgt = assoc[2]!.trim();
      const srcParen = /^\((.+)\)$/.exec(src);
      addUsecase(tgt);
      if (srcParen) {
        src = srcParen[1]!.trim();
        addUsecase(src);
        rels.push({ type: 'assoc', source: src, sourceIsUsecase: true, target: tgt });
      } else {
        addActor(src); // forgiving: undeclared actors are auto-created
        rels.push({ type: 'assoc', source: src, sourceIsUsecase: false, target: tgt });
      }
      continue;
    }
    // Unrecognized lines are ignored (soft syntax, hand-written fences).
  }

  return buildModel(system, actors, usecases, rels);
}

// ---------------------------------------------------------------------------
// Model building (pure layout math — no SVG/mermaid dependency)
// ---------------------------------------------------------------------------

const actorId = (name: string): string => `actor:${name}`;
const usecaseId = (name: string): string => `uc:${name}`;

function buildModel(system: string, actors: string[], usecases: string[], rels: Rel[]): DiagramModel {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];

  // Use cases: two columns inside the system boundary.
  const ucNodes: DiagramNode[] = usecases.map((name, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    return {
      id: usecaseId(name),
      label: name,
      shape: 'stadium',
      x: UC_COL_X[col]!,
      y: UC_Y0 + row * UC_STEP,
      width: ucWidth(name),
      height: UC_H,
      data: { role: 'usecase', name },
    };
  });

  // System boundary: locked decoration rect + title, enclosing all usecases.
  if (ucNodes.length > 0) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of ucNodes) {
      minX = Math.min(minX, n.x - n.width / 2);
      maxX = Math.max(maxX, n.x + n.width / 2);
      minY = Math.min(minY, n.y - n.height / 2);
      maxY = Math.max(maxY, n.y + n.height / 2);
    }
    const boxX = (minX + maxX) / 2;
    const boxW = maxX - minX + BOUNDARY_PAD * 2;
    const titleH = system ? 34 : 0;
    const boxTop = minY - BOUNDARY_PAD - titleH;
    const boxH = maxY + BOUNDARY_PAD - boxTop;
    nodes.push({
      id: 'uc-system',
      label: '',
      shape: 'rect',
      x: boxX,
      y: boxTop + boxH / 2,
      width: boxW,
      height: boxH,
      data: { role: 'systemBox', locked: true, color: PAPER, stroke: INK },
    });
    if (system) {
      nodes.push({
        id: 'uc-system-title',
        label: system,
        shape: 'text',
        x: boxX,
        y: boxTop + 20,
        width: boxW - 24,
        height: 24,
        data: { role: 'systemTitle', locked: true, fontSize: 15, bold: true, color: INK },
      });
    }
  }

  // Actors: left column of emoji stick figures.
  actors.forEach((name, i) => {
    nodes.push({
      id: actorId(name),
      label: `🧍\n${name}`,
      shape: 'text',
      x: ACTOR_X,
      y: ACTOR_Y0 + i * ACTOR_STEP,
      width: ACTOR_W,
      height: ACTOR_H,
      data: { role: 'actor', name, fontSize: 15, bold: true },
    });
  });

  nodes.push(...ucNodes);

  rels.forEach((rel, i) => {
    const source = rel.sourceIsUsecase ? usecaseId(rel.source) : actorId(rel.source);
    const target = usecaseId(rel.target);
    if (rel.type === 'assoc') {
      edges.push({ id: `e${i}`, source, target, kind: 'open', data: { straight: true } });
    } else {
      edges.push({
        id: `e${i}`,
        source,
        target,
        kind: 'dotted',
        label: rel.type === 'include' ? '«include»' : '«extend»',
      });
    }
  });

  const model: DiagramModel = { kind: KIND, direction: 'LR', nodes, edges };
  if (system) model.meta = { system };
  return model;
}

// ---------------------------------------------------------------------------
// Serialization (model → text)
// ---------------------------------------------------------------------------

export function serializeUsecase(model: DiagramModel): string {
  const lines: string[] = [];

  const system = String(model.meta?.system ?? '').trim();
  if (system) lines.push(`系统: ${system}`);

  const nameOf = new Map<string, { name: string; role: string }>();
  for (const n of model.nodes) {
    const role = String(n.data?.role ?? '');
    if (role === 'actor' || role === 'usecase') {
      const name = String(n.data?.name ?? n.label.replace(/^🧍\s*\n?/, '')).trim();
      nameOf.set(n.id, { name, role });
    }
  }

  // Actor declarations in vertical (y) order.
  const actorNodes = model.nodes
    .filter((n) => n.data?.role === 'actor')
    .sort((a, b) => a.y - b.y);
  for (const a of actorNodes) lines.push(`actor ${nameOf.get(a.id)!.name}`);

  // Associations (open edges) in edge order.
  for (const e of model.edges) {
    if (e.kind !== 'open') continue;
    const src = nameOf.get(e.source);
    const tgt = nameOf.get(e.target);
    if (!src || !tgt) continue;
    const lhs = src.role === 'actor' ? src.name : `(${src.name})`;
    lines.push(`${lhs} -> (${tgt.name})`);
  }

  // include / extend (dotted edges, discriminated by label).
  for (const e of model.edges) {
    if (e.kind !== 'dotted') continue;
    const src = nameOf.get(e.source);
    const tgt = nameOf.get(e.target);
    if (!src || !tgt) continue;
    const word = (e.label ?? '').toLowerCase().includes('extend') ? 'extend' : 'include';
    lines.push(`(${src.name}) ${word} (${tgt.name})`);
  }

  return lines.join('\n');
}

registerDiagram({
  kind: KIND,
  detects: [],
  parse: () => {
    throw new Error('usecase diagrams are parsed from text, not mermaid');
  },
  serialize: serializeUsecase,
});
