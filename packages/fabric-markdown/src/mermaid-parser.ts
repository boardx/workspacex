/**
 * Mermaid text (flowchart / class / state / sequence) → DiagramModel.
 *
 * Hybrid strategy (same as @excalidraw/mermaid-to-excalidraw):
 *  - logical structure (ids, labels, shapes, edges) from mermaid's internal
 *    diagram db via `getDiagramFromText` (deprecated but stable within a
 *    pinned major version; a pure-SVG fallback covers its absence),
 *  - geometry (positions/sizes) from the rendered SVG, read from element
 *    attributes (translate/width/height/points/r) so extraction itself does
 *    not depend on getBBox and stays unit-testable under jsdom.
 *
 * mermaid.render() itself requires a real browser DOM.
 */
import mermaid from 'mermaid';
import type { DiagramModel, DiagramNode, DiagramEdge, Direction, EdgeKind, NodeShape } from './model';
import { pluginForType } from './diagrams/registry';

interface MermaidDiagram {
  type?: string;
  db: Record<string, unknown>;
}

interface MermaidWithApi {
  mermaidAPI: { getDiagramFromText(text: string): Promise<MermaidDiagram> };
}

let initialized = false;

function ensureInit(): void {
  if (initialized) return;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'neutral' });
  initialized = true;
}

export interface NodeGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

const TRANSLATE_RE = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/;
// Flowchart nodes: "...flowchart-<id>-<n>"; class nodes: "...classId-<id>-<n>";
// state nodes: "...state-<id>-<n>".
const NODE_ID_RE = /(?:flowchart|classId|state)-(.+)-\d+$/;

/** Size of one shape element, from attributes where possible. */
function shapeSize(el: Element): { width: number; height: number } | null {
  switch (el.tagName.toLowerCase()) {
    case 'rect': {
      const width = parseFloat(el.getAttribute('width') ?? '0');
      const height = parseFloat(el.getAttribute('height') ?? '0');
      return width > 0 && height > 0 ? { width, height } : null;
    }
    case 'circle': {
      const r = parseFloat(el.getAttribute('r') ?? '0');
      return r > 0 ? { width: r * 2, height: r * 2 } : null;
    }
    case 'ellipse': {
      const rx = parseFloat(el.getAttribute('rx') ?? '0');
      const ry = parseFloat(el.getAttribute('ry') ?? '0');
      return rx > 0 && ry > 0 ? { width: rx * 2, height: ry * 2 } : null;
    }
    case 'polygon': {
      const pts = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i + 1 < pts.length; i += 2) {
        xs.push(pts[i]!);
        ys.push(pts[i + 1]!);
      }
      if (xs.length === 0) return null;
      const width = Math.max(...xs) - Math.min(...xs);
      const height = Math.max(...ys) - Math.min(...ys);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    case 'path': {
      // Prefer live-DOM measurement (mermaid stadium/cylinder etc render as paths).
      const bboxFn = (el as SVGGraphicsElement).getBBox;
      if (typeof bboxFn === 'function') {
        try {
          const b = (el as SVGGraphicsElement).getBBox();
          if (b.width > 0 && b.height > 0) return { width: b.width, height: b.height };
        } catch {
          /* detached element or non-SVG DOM — fall through */
        }
      }
      // Crude fallback: bound all coordinates in the path data (control points
      // of mermaid's rounded shapes stay on/inside the true bbox).
      const nums = (el.getAttribute('d') ?? '').match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) {
        xs.push(nums[i]!);
        ys.push(nums[i + 1]!);
      }
      if (xs.length < 2) return null;
      const width = Math.max(...xs) - Math.min(...xs);
      const height = Math.max(...ys) - Math.min(...ys);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    default:
      return null;
  }
}

/**
 * Extract per-node geometry from a rendered mermaid flowchart SVG.
 * Node groups look like <g class="node" id="...flowchart-<nodeId>-<n>"
 * transform="translate(cx,cy)"> containing the shape (rect/circle/polygon,
 * or a path wrapped in <g class="outer-path"> for stadium-like shapes) plus
 * a <g class="label"> subtree that must be ignored (it contains its own
 * small <rect>). We collect all candidate shapes outside the label and keep
 * the largest. Exposed for unit testing with fixture SVG strings.
 */
export function extractNodeGeometry(svgRoot: SVGElement | Element): Map<string, NodeGeometry> {
  const result = new Map<string, NodeGeometry>();
  for (const g of Array.from(svgRoot.querySelectorAll('g.node'))) {
    const idAttr = g.getAttribute('id') ?? '';
    const idMatch = NODE_ID_RE.exec(idAttr);
    if (!idMatch) continue;
    const nodeId = idMatch[1]!;
    const tMatch = TRANSLATE_RE.exec(g.getAttribute('transform') ?? '');
    if (!tMatch) continue;
    const cx = parseFloat(tMatch[1]!);
    const cy = parseFloat(tMatch[2]!);

    // Candidate shape elements: direct children (and children of wrapper
    // <g>s such as "outer-path"), excluding anything inside <g class="label">.
    const candidates: Element[] = [];
    for (const child of Array.from(g.children)) {
      if (child.classList.contains('label')) continue;
      if (child.tagName.toLowerCase() === 'g') {
        candidates.push(...Array.from(child.children));
      } else {
        candidates.push(child);
      }
    }

    let best: { width: number; height: number } | null = null;
    for (const el of candidates) {
      const size = shapeSize(el);
      if (size && (!best || size.width * size.height > best.width * best.height)) {
        best = size;
      }
    }
    if (best) {
      result.set(nodeId, { x: cx, y: cy, width: best.width, height: best.height });
    }
  }
  return result;
}

interface DbVertex {
  id: string;
  text?: string;
  type?: string;
}

/** Normalized view of one flowDb subgraph record. */
export interface DbSubGraph {
  id: string;
  title: string;
  /** Member node ids (may include nested subgraph ids). */
  members: string[];
}

/** One rendered flowchart cluster (subgraph box) with its SVG geometry. */
export interface ClusterGeometry extends NodeGeometry {
  /** The <g class="cluster"> id attribute ('' when absent). */
  idAttr: string;
  /** The cluster label text ('' when absent). */
  title: string;
}

/**
 * Extract subgraph (cluster) boxes from a rendered mermaid flowchart SVG.
 * Clusters look like <g class="cluster" id="..."><rect x y width height/>
 * <g class="cluster-label">…</g></g>. x/y are returned as the box center to
 * match extractNodeGeometry's convention. Exposed for unit testing.
 */
export function extractClusterGeometry(svgRoot: SVGElement | Element): ClusterGeometry[] {
  const result: ClusterGeometry[] = [];
  for (const g of Array.from(svgRoot.querySelectorAll('g.cluster'))) {
    let rect: Element | null = null;
    for (const child of Array.from(g.children)) {
      if (child.tagName.toLowerCase() === 'rect') {
        rect = child;
        break;
      }
    }
    if (!rect) continue;
    let x = parseFloat(rect.getAttribute('x') ?? '');
    let y = parseFloat(rect.getAttribute('y') ?? '');
    const width = parseFloat(rect.getAttribute('width') ?? '');
    const height = parseFloat(rect.getAttribute('height') ?? '');
    if ([x, y, width, height].some(Number.isNaN) || width <= 0 || height <= 0) continue;
    const tMatch = TRANSLATE_RE.exec(g.getAttribute('transform') ?? '');
    if (tMatch) {
      x += parseFloat(tMatch[1]!);
      y += parseFloat(tMatch[2]!);
    }
    result.push({
      idAttr: g.getAttribute('id') ?? '',
      title: (g.querySelector('.cluster-label')?.textContent ?? '').trim(),
      x: x + width / 2,
      y: y + height / 2,
      width,
      height,
    });
  }
  return result;
}

/**
 * Read subgraphs out of mermaid's flow db, defensively probing field names
 * (nodes/children, or any all-string array as a last resort) so a minor
 * mermaid upgrade degrades gracefully instead of crashing.
 */
export function readSubGraphs(db: Record<string, unknown>): DbSubGraph[] {
  const fn = db['getSubGraphs'] as (() => unknown) | undefined;
  if (typeof fn !== 'function') return [];
  let raw: unknown;
  try {
    raw = fn.call(db);
  } catch {
    return [];
  }
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : raw instanceof Map
      ? [...raw.values()]
      : raw && typeof raw === 'object'
        ? Object.values(raw)
        : [];
  const out: DbSubGraph[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const id = typeof rec['id'] === 'string' ? rec['id'] : undefined;
    if (!id) continue;
    const isStringArray = (v: unknown): v is string[] =>
      Array.isArray(v) && v.every((s) => typeof s === 'string');
    let members: string[] | undefined;
    if (isStringArray(rec['nodes'])) members = rec['nodes'];
    else if (isStringArray(rec['children'])) members = rec['children'];
    else {
      for (const key of Object.keys(rec)) {
        if (key === 'classes' || key === 'styles') continue;
        const v = rec[key];
        if (isStringArray(v) && v.length > 0) {
          members = v;
          break;
        }
      }
    }
    const title =
      typeof rec['title'] === 'string'
        ? rec['title']
        : typeof rec['label'] === 'string'
          ? rec['label']
          : id;
    out.push({ id, title, members: [...(members ?? [])] });
  }
  return out;
}

/** Extra padding (px) around a matched cluster box in the IR. */
const SUBGRAPH_CLUSTER_PADDING = 6;
/** Padding around the member bounding box when the SVG has no cluster. */
const SUBGRAPH_BBOX_PADDING = 24;
/** Subgraph box fill / stroke on canvas. */
const SUBGRAPH_FILL = '#fefce8';
const SUBGRAPH_STROKE = '#eab308';

/**
 * Build IR nodes for flowchart subgraphs: one locked background rect per
 * subgraph plus a locked title text node. Cluster matching is defensive:
 * id-attribute match, then title match, then "which cluster contains the
 * most member centers" (smallest area wins ties, for nesting). When the SVG
 * offers no cluster geometry, the member bounding box + padding is used.
 */
function buildSubgraphNodes(
  subGraphs: DbSubGraph[],
  clusters: ClusterGeometry[],
  nodes: DiagramNode[],
): DiagramNode[] {
  const pool = [...clusters];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rects: DiagramNode[] = [];
  const titles: DiagramNode[] = [];

  for (const sg of subGraphs) {
    const memberNodes = sg.members
      .map((m) => byId.get(m))
      .filter((n): n is DiagramNode => Boolean(n));

    // 1. id match, 2. title match, 3. member-containment score.
    let idx = pool.findIndex((c) => c.idAttr === sg.id || (c.idAttr !== '' && c.idAttr.includes(sg.id)));
    if (idx < 0 && sg.title !== '') idx = pool.findIndex((c) => c.title === sg.title);
    if (idx < 0 && memberNodes.length > 0) {
      let bestScore = 0;
      let bestArea = Infinity;
      pool.forEach((c, i) => {
        const score = memberNodes.filter(
          (n) => Math.abs(n.x - c.x) <= c.width / 2 && Math.abs(n.y - c.y) <= c.height / 2,
        ).length;
        const area = c.width * c.height;
        if (score > bestScore || (score === bestScore && score > 0 && area < bestArea)) {
          idx = i;
          bestScore = score;
          bestArea = area;
        }
      });
    }

    let geo: NodeGeometry;
    if (idx >= 0) {
      const c = pool.splice(idx, 1)[0]!;
      geo = {
        x: c.x,
        y: c.y,
        width: c.width + SUBGRAPH_CLUSTER_PADDING * 2,
        height: c.height + SUBGRAPH_CLUSTER_PADDING * 2,
      };
    } else if (memberNodes.length > 0) {
      const minX = Math.min(...memberNodes.map((n) => n.x - n.width / 2));
      const maxX = Math.max(...memberNodes.map((n) => n.x + n.width / 2));
      const minY = Math.min(...memberNodes.map((n) => n.y - n.height / 2));
      const maxY = Math.max(...memberNodes.map((n) => n.y + n.height / 2));
      geo = {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        width: maxX - minX + SUBGRAPH_BBOX_PADDING * 2,
        height: maxY - minY + SUBGRAPH_BBOX_PADDING * 2,
      };
    } else {
      console.warn(`[fabric-markdown] no geometry for subgraph "${sg.id}", skipping`);
      continue;
    }

    rects.push({
      id: `subgraph:${sg.id}`,
      label: '',
      shape: 'rect',
      x: geo.x,
      y: geo.y,
      width: geo.width,
      height: geo.height,
      data: {
        role: 'subgraph',
        sgId: sg.id,
        title: sg.title,
        members: [...sg.members],
        locked: true,
        color: SUBGRAPH_FILL,
        stroke: SUBGRAPH_STROKE,
      },
    });
    if (sg.title !== '') {
      titles.push({
        id: `subgraphTitle:${sg.id}`,
        label: sg.title,
        shape: 'text',
        x: geo.x,
        y: geo.y - geo.height / 2 + 13,
        width: Math.max(40, geo.width - 16),
        height: 18,
        data: { role: 'subgraphTitle', sgId: sg.id, locked: true, bold: true, fontSize: 13 },
      });
    }
  }
  // Bigger boxes first so nested subgraphs paint above their parents.
  rects.sort((a, b) => b.width * b.height - a.width * a.height);
  return [...rects, ...titles];
}

interface DbEdge {
  start: string;
  end: string;
  type?: string;
  text?: string;
  stroke?: string;
}

function mapShape(dbType: string | undefined): NodeShape {
  switch (dbType) {
    case 'round':
      return 'round';
    case 'stadium':
      return 'stadium';
    case 'diamond':
    case 'question':
      return 'diamond';
    case 'circle':
    case 'doublecircle':
      return 'circle';
    case 'square':
    default:
      return 'rect';
  }
}

function mapEdgeKind(edge: DbEdge): EdgeKind {
  if (edge.stroke === 'dotted') return 'dotted';
  if (edge.stroke === 'thick') return 'thick';
  if (edge.type === 'arrow_open') return 'open';
  return 'arrow';
}

function normalizeDirection(dir: string | undefined): Direction {
  switch (dir) {
    case 'LR':
    case 'RL':
    case 'BT':
      return dir;
    case 'TB':
      return 'TB';
    case 'TD':
    default:
      return 'TD';
  }
}

/** Read vertices/edges out of mermaid's internal flow db (Map or plain object). */
function readDb(db: Record<string, unknown>): {
  vertices: DbVertex[];
  edges: DbEdge[];
  direction: Direction;
} {
  const getVertices = db['getVertices'] as (() => unknown) | undefined;
  const getEdges = db['getEdges'] as (() => unknown) | undefined;
  const getDirection = db['getDirection'] as (() => string | undefined) | undefined;
  if (!getVertices || !getEdges) throw new Error('flow db missing getVertices/getEdges');

  const rawVertices = getVertices.call(db);
  const vertices: DbVertex[] = [];
  if (rawVertices instanceof Map) {
    for (const v of rawVertices.values()) vertices.push(v as DbVertex);
  } else if (rawVertices && typeof rawVertices === 'object') {
    for (const v of Object.values(rawVertices)) vertices.push(v as DbVertex);
  }
  const edges = (getEdges.call(db) as DbEdge[]) ?? [];
  return {
    vertices,
    edges,
    direction: normalizeDirection(getDirection?.call(db)),
  };
}

/** Pure-SVG fallback: reconstruct logical structure from the rendered SVG only. */
function structureFromSvg(svgRoot: Element): { vertices: DbVertex[]; edges: DbEdge[] } {
  const vertices: DbVertex[] = [];
  for (const g of Array.from(svgRoot.querySelectorAll('g.node'))) {
    const m = NODE_ID_RE.exec(g.getAttribute('id') ?? '');
    if (!m) continue;
    const label = (g.querySelector('.nodeLabel')?.textContent ?? m[1]!).trim();
    let type: string | undefined;
    if (g.querySelector('polygon')) type = 'diamond';
    else if (g.querySelector('circle')) type = 'circle';
    else if (g.querySelector('rect[rx]')?.getAttribute('rx') !== '0' && g.querySelector('rect[rx]')) type = 'round';
    vertices.push({ id: m[1]!, text: label, type });
  }
  const edges: DbEdge[] = [];
  for (const path of Array.from(svgRoot.querySelectorAll('path.flowchart-link'))) {
    const classes = path.getAttribute('class') ?? '';
    const src = /LS-([^\s]+)/.exec(classes)?.[1];
    const tgt = /LE-([^\s]+)/.exec(classes)?.[1];
    if (!src || !tgt) continue;
    const stroke = classes.includes('edge-thickness-thick')
      ? 'thick'
      : classes.includes('edge-pattern-dotted')
        ? 'dotted'
        : 'normal';
    edges.push({ start: src, end: tgt, stroke, type: 'arrow_point' });
  }
  return { vertices, edges };
}

// ---------------------------------------------------------------------------
// UML class diagrams
// ---------------------------------------------------------------------------

interface DbClassMember {
  getDisplayDetails?: () => { displayText?: string };
  text?: string;
}

interface DbClass {
  id: string;
  label?: string;
  members?: DbClassMember[];
  methods?: DbClassMember[];
  /** Class annotations, e.g. ['interface'] for <<interface>>. */
  annotations?: string[];
}

/** Shape of one entry of classDb.getRelations(). */
export interface DbClassRelation {
  id1: string;
  id2: string;
  relation: { type1: number | 'none'; type2: number | 'none'; lineType: number };
  relationTitle1?: string;
  relationTitle2?: string;
  title?: string;
}

function memberText(m: DbClassMember): string {
  return (m.getDisplayDetails?.().displayText ?? m.text ?? '').trim();
}

/**
 * Convert one mermaid class relation into a directed IR edge. Mermaid puts
 * the marker (triangle/diamond/arrow) on whichever side declared it: type1
 * set → marker at id1, so the IR edge (marker always at target) runs id2→id1.
 * Relation type codes: 0 aggregation, 1 extension, 2 composition, 3 arrow.
 * Exported for unit testing.
 */
export function classRelationToEdge(rel: DbClassRelation, index: number): DiagramEdge {
  const markerAt1 = rel.relation.type1 !== 'none' && rel.relation.type1 !== undefined;
  const markerType = markerAt1 ? rel.relation.type1 : rel.relation.type2;
  const source = markerAt1 ? rel.id2 : rel.id1;
  const target = markerAt1 ? rel.id1 : rel.id2;
  const srcTitle = markerAt1 ? rel.relationTitle2 : rel.relationTitle1;
  const tgtTitle = markerAt1 ? rel.relationTitle1 : rel.relationTitle2;
  const dotted = rel.relation.lineType === 1;

  let kind: EdgeKind;
  switch (markerType) {
    case 1:
      kind = dotted ? 'realization' : 'inheritance';
      break;
    case 2:
      kind = 'composition';
      break;
    case 0:
      kind = 'aggregation';
      break;
    case 3:
      kind = dotted ? 'dependency' : 'arrow';
      break;
    default:
      kind = dotted ? 'dotted' : 'open';
  }

  const clean = (s?: string) => (s && s !== 'none' ? s : undefined);
  return {
    id: `e${index}`,
    source,
    target,
    label: clean(rel.title),
    kind,
    sourceLabel: clean(srcTitle),
    targetLabel: clean(tgtTitle),
  };
}

function classModelFromDb(
  db: Record<string, unknown>,
  geometry: Map<string, NodeGeometry>,
): DiagramModel {
  const getClasses = db['getClasses'] as () => Map<string, DbClass> | Record<string, DbClass>;
  const getRelations = db['getRelations'] as () => DbClassRelation[];
  const getDirection = db['getDirection'] as (() => string | undefined) | undefined;

  const rawClasses = getClasses.call(db);
  const classList: DbClass[] =
    rawClasses instanceof Map ? [...rawClasses.values()] : Object.values(rawClasses);

  const nodes: DiagramNode[] = [];
  for (const cls of classList) {
    const geo = geometry.get(cls.id);
    if (!geo) {
      console.warn(`[fabric-markdown] no geometry for class "${cls.id}", skipping`);
      continue;
    }
    const annotations = (cls.annotations ?? []).filter(
      (a): a is string => typeof a === 'string' && a.trim() !== '',
    );
    nodes.push({
      id: cls.id,
      label: (cls.label ?? cls.id).trim(),
      shape: 'class',
      x: geo.x,
      y: geo.y,
      width: geo.width,
      height: geo.height,
      // Annotations render as the first member row(s), guillemet-quoted.
      members: [
        ...annotations.map((a) => `«${a.trim()}»`),
        ...(cls.members ?? []).map(memberText).filter(Boolean),
      ],
      methods: (cls.methods ?? []).map(memberText).filter(Boolean),
      ...(annotations.length > 0 ? { data: { annotations } } : {}),
    });
  }
  const edges = (getRelations.call(db) ?? []).map(classRelationToEdge);
  return {
    kind: 'class',
    direction: normalizeDirection(getDirection?.call(db) ?? 'TB'),
    nodes,
    edges,
  };
}

// ---------------------------------------------------------------------------
// State diagrams
// ---------------------------------------------------------------------------

/** Special state ids mermaid uses for the [*] pseudo-states at root level. */
const STATE_START_ID = 'root_start';
const STATE_END_ID = 'root_end';

interface DbState {
  id: string;
  type?: string;
  descriptions?: string[];
  /** Single description used by nested state statements. */
  description?: string;
  /** True on nested [*] start pseudo-states. */
  start?: boolean;
  /** Nested statements of a composite state (state X { ... }). */
  doc?: unknown[];
}

interface DbStateRelation {
  id1: string;
  id2: string;
  relationTitle?: string;
}

function stateShape(st: DbState): NodeShape {
  // Nested [*] pseudo-states inside composite states carry generated ids
  // (e.g. "Active_start" with start:true); root-level ones use fixed ids.
  if (st.type === 'start' || st.start === true || st.id === STATE_START_ID) return 'stateStart';
  if (st.type === 'end' || st.start === false || st.id === STATE_END_ID) return 'stateEnd';
  if (/_end\d*$/.test(st.id)) return 'stateEnd';
  return 'round';
}

/**
 * Geometry of a composite state's cluster box (state X { ... } renders as
 * <g class="statediagram-cluster" id="...state-<id>-<n>"> with absolute
 * rects instead of a g.node). Returns center-based geometry or null.
 */
function stateClusterGeometry(svgRoot: Element, stateId: string): NodeGeometry | null {
  for (const g of Array.from(svgRoot.querySelectorAll('g.statediagram-cluster'))) {
    const m = NODE_ID_RE.exec(g.getAttribute('id') ?? '');
    if (!m || m[1] !== stateId) continue;
    for (const rect of Array.from(g.querySelectorAll('rect'))) {
      const x = parseFloat(rect.getAttribute('x') ?? '');
      const y = parseFloat(rect.getAttribute('y') ?? '');
      const width = parseFloat(rect.getAttribute('width') ?? '');
      const height = parseFloat(rect.getAttribute('height') ?? '');
      if ([x, y, width, height].some(Number.isNaN) || width <= 0 || height <= 0) continue;
      return { x: x + width / 2, y: y + height / 2, width, height };
    }
  }
  return null;
}

function stateModelFromDb(
  db: Record<string, unknown>,
  geometry: Map<string, NodeGeometry>,
  svgRoot: Element,
): DiagramModel {
  const getStates = db['getStates'] as () => Map<string, DbState> | Record<string, DbState>;
  const getRelations = db['getRelations'] as () => DbStateRelation[];
  const getDirection = db['getDirection'] as (() => string | undefined) | undefined;

  const rawStates = getStates.call(db);
  const stateList: DbState[] =
    rawStates instanceof Map ? [...rawStates.values()] : Object.values(rawStates);

  // Defensive flattening for composite states (state X { ... }): mermaid's
  // getStates()/getRelations() only cover the top level; inner states and
  // transitions live in each composite's `doc` as state/relation statements.
  // Pull them up (flat — the grouping box itself is not imported) so the
  // inner states, which DO render as ordinary g.node groups, are kept.
  const seen = new Set<string>();
  const flat: DbState[] = [];
  const innerRelations: DbStateRelation[] = [];
  const pushState = (st: DbState): void => {
    if (!st || typeof st.id !== 'string' || seen.has(st.id)) return;
    seen.add(st.id);
    flat.push(st);
    if (Array.isArray(st.doc)) {
      for (const raw of st.doc) {
        if (!raw || typeof raw !== 'object') continue;
        const stmt = raw as {
          stmt?: string;
          state1?: DbState;
          state2?: DbState;
          description?: string;
        };
        if (stmt.stmt === 'state') {
          pushState(stmt as unknown as DbState);
        } else if (stmt.stmt === 'relation' && stmt.state1 && stmt.state2) {
          pushState(stmt.state1);
          pushState(stmt.state2);
          if (typeof stmt.state1.id === 'string' && typeof stmt.state2.id === 'string') {
            innerRelations.push({
              id1: stmt.state1.id,
              id2: stmt.state2.id,
              relationTitle: stmt.description,
            });
          }
        }
      }
    }
  };
  for (const st of stateList) pushState(st);

  const nodes: DiagramNode[] = [];
  for (const st of flat) {
    // Composite states render as clusters (no g.node); fall back to the
    // cluster box geometry so they stay addressable as a plain state (the
    // grouping itself is not modeled — see composite-state limitations).
    const geo = geometry.get(st.id) ?? stateClusterGeometry(svgRoot, st.id);
    if (!geo) {
      console.warn(`[fabric-markdown] no geometry for state "${st.id}", skipping`);
      continue;
    }
    const shape = stateShape(st);
    const label =
      shape === 'stateStart' || shape === 'stateEnd'
        ? '[*]'
        : st.descriptions?.[0]?.trim() || st.description?.trim() || st.id;
    nodes.push({
      id: st.id,
      label,
      shape,
      x: geo.x,
      y: geo.y,
      width: geo.width,
      height: geo.height,
    });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: DiagramEdge[] = [...(getRelations.call(db) ?? []), ...innerRelations]
    // Drop transitions whose endpoint was not imported (composite group
    // boxes render as clusters without node geometry and are skipped).
    .filter((rel) => nodeIds.has(rel.id1) && nodeIds.has(rel.id2))
    .map((rel, i) => ({
      id: `e${i}`,
      source: rel.id1,
      target: rel.id2,
      label: rel.relationTitle?.trim() || undefined,
      kind: 'arrow' as EdgeKind,
    }));

  return {
    kind: 'state',
    direction: normalizeDirection(getDirection?.call(db) ?? 'TB'),
    nodes,
    edges,
  };
}

// ---------------------------------------------------------------------------
// Sequence diagrams
// ---------------------------------------------------------------------------

interface DbActor {
  name: string;
  description?: string;
}

interface DbSequenceMessage {
  /** Actor id, or {actor} wrapper object for note records. */
  from?: unknown;
  to?: unknown;
  message?: unknown;
  type?: number;
  /** Note placement: 0 left of, 1 right of, 2 over. */
  placement?: unknown;
}

/** Message type codes rendered as a solid arrow (->, ->>, -x variants). */
const SEQ_SOLID_TYPES = new Set([0, 3, 5]);
/** Message type codes rendered as a dotted arrow (-->, -->>, --x variants). */
const SEQ_DOTTED_TYPES = new Set([1, 4, 6]);
/** Message type code for notes (LINETYPE.NOTE). */
const SEQ_NOTE_TYPE = 2;
/** Note placement codes (sequenceDb PLACEMENT). */
const SEQ_PLACEMENT_LEFT = 0;
const SEQ_PLACEMENT_RIGHT = 1;
/** Horizontal offset for left/right notes when the SVG has no note rect. */
const SEQ_NOTE_X_OFFSET = 120;
const SEQ_NOTE_FALLBACK_WIDTH = 150;
const SEQ_NOTE_FALLBACK_HEIGHT = 40;

/** Fallback vertical spacing between messages when the SVG line count is short. */
const SEQ_MESSAGE_FALLBACK_STEP = 40;

export interface SequenceActorGeometry {
  /** Center x/y of the top participant box in SVG coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Length of the dashed lifeline below the box (y2 - y1). */
  lifelineHeight: number;
}

/**
 * Extract geometry from a rendered mermaid sequence-diagram SVG. Sequence
 * SVGs have no <g class="node"> groups; instead:
 *  - participant boxes are <rect class="actor ..."> with a `name` attribute
 *    holding the actor id (the duplicated bottom boxes carry `actor-bottom`
 *    in their class and are skipped),
 *  - lifelines are <line class="actor-line"> matched to a box by x
 *    proximity (2px tolerance; unmatched boxes get the longest lifeline),
 *  - message lines are `.messageLine0` / `.messageLine1` elements whose y1
 *    gives each message's vertical position, in document order.
 * Exposed for unit testing with fixture SVG strings.
 */
export function extractSequenceGeometry(svgRoot: Element): {
  actors: Map<string, SequenceActorGeometry>;
  messageYs: number[];
  /** Center geometry of each <rect class="note">, in document order. */
  noteRects: NodeGeometry[];
} {
  interface LifeLine {
    x: number;
    height: number;
  }
  const lifelines: LifeLine[] = [];
  for (const line of Array.from(svgRoot.querySelectorAll('line.actor-line'))) {
    const x = parseFloat(line.getAttribute('x1') ?? '');
    const y1 = parseFloat(line.getAttribute('y1') ?? '');
    const y2 = parseFloat(line.getAttribute('y2') ?? '');
    if (Number.isNaN(x) || Number.isNaN(y1) || Number.isNaN(y2)) continue;
    lifelines.push({ x, height: y2 - y1 });
  }
  const maxLifeline = lifelines.length ? Math.max(...lifelines.map((l) => l.height)) : 0;

  const actors = new Map<string, SequenceActorGeometry>();
  for (const rect of Array.from(svgRoot.querySelectorAll('rect.actor'))) {
    if ((rect.getAttribute('class') ?? '').includes('actor-bottom')) continue;
    const name = rect.getAttribute('name');
    if (!name || actors.has(name)) continue;
    const x = parseFloat(rect.getAttribute('x') ?? '');
    const y = parseFloat(rect.getAttribute('y') ?? '');
    const width = parseFloat(rect.getAttribute('width') ?? '');
    const height = parseFloat(rect.getAttribute('height') ?? '');
    if ([x, y, width, height].some(Number.isNaN) || width <= 0 || height <= 0) continue;
    const cx = x + width / 2;
    const cy = y + height / 2;
    const matched = lifelines.find((l) => Math.abs(l.x - cx) <= 2);
    actors.set(name, {
      x: cx,
      y: cy,
      width,
      height,
      lifelineHeight: matched ? matched.height : maxLifeline,
    });
  }

  const messageYs: number[] = [];
  for (const line of Array.from(svgRoot.querySelectorAll('.messageLine0, .messageLine1'))) {
    const y = parseFloat(line.getAttribute('y1') ?? '');
    if (!Number.isNaN(y)) messageYs.push(y);
  }

  const noteRects: NodeGeometry[] = [];
  for (const rect of Array.from(svgRoot.querySelectorAll('rect.note'))) {
    const x = parseFloat(rect.getAttribute('x') ?? '');
    const y = parseFloat(rect.getAttribute('y') ?? '');
    const width = parseFloat(rect.getAttribute('width') ?? '');
    const height = parseFloat(rect.getAttribute('height') ?? '');
    if ([x, y, width, height].some(Number.isNaN) || width <= 0 || height <= 0) continue;
    noteRects.push({ x: x + width / 2, y: y + height / 2, width, height });
  }

  return { actors, messageYs, noteRects };
}

function sequenceModelFromDb(db: Record<string, unknown>, svgRoot: Element): DiagramModel {
  const getActors = db['getActors'] as () => Map<string, DbActor> | Record<string, DbActor>;
  const getMessages = db['getMessages'] as () => DbSequenceMessage[];

  const { actors: actorGeometry, messageYs, noteRects } = extractSequenceGeometry(svgRoot);

  const rawActors = getActors.call(db);
  const actorList: DbActor[] =
    rawActors instanceof Map ? [...rawActors.values()] : Object.values(rawActors);

  const nodes: DiagramNode[] = [];
  for (const actor of actorList) {
    const geo = actorGeometry.get(actor.name);
    if (!geo) {
      console.warn(`[fabric-markdown] no geometry for participant "${actor.name}", skipping`);
      continue;
    }
    nodes.push({
      id: actor.name,
      label: actor.description?.trim() || actor.name,
      shape: 'participant',
      x: geo.x,
      y: geo.y,
      width: geo.width,
      height: geo.height,
      lifelineHeight: geo.lifelineHeight,
    });
  }

  // Actor field of a note record is an {actor} wrapper; plain messages use
  // the bare id string.
  const actorName = (v: unknown): string => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object' && typeof (v as { actor?: unknown }).actor === 'string') {
      return (v as { actor: string }).actor;
    }
    return '';
  };
  const messageText = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

  const allMessages = getMessages.call(db) ?? [];
  const isArrow = (m: DbSequenceMessage): boolean =>
    typeof m.type === 'number' && (SEQ_SOLID_TYPES.has(m.type) || SEQ_DOTTED_TYPES.has(m.type));
  const arrowCount = allMessages.filter(isArrow).length;
  if (arrowCount !== messageYs.length) {
    console.warn(
      `[fabric-markdown] sequence message count (${arrowCount}) does not match ` +
        `SVG message lines (${messageYs.length}); falling back to index pairing`,
    );
  }

  // Walk the message stream in order with one shared `order` counter so notes
  // interleave correctly with arrows on re-serialization. Arrows pair with
  // .messageLine elements by index (notes/loops/alt produce no messageLine,
  // note rects are matched separately), unmatched records estimate y.
  const edges: DiagramEdge[] = [];
  let order = 0;
  let arrowIdx = 0;
  let noteIdx = 0;
  let lastY = 0;
  for (const m of allMessages) {
    if (isArrow(m)) {
      let seqY: number;
      if (arrowIdx < messageYs.length) {
        seqY = messageYs[arrowIdx]!;
      } else {
        seqY = lastY + SEQ_MESSAGE_FALLBACK_STEP;
      }
      arrowIdx++;
      lastY = Math.max(lastY, seqY);
      edges.push({
        id: `e${order}`,
        source: actorName(m.from),
        target: actorName(m.to),
        label: messageText(m.message) || undefined,
        kind: (SEQ_DOTTED_TYPES.has(m.type!) ? 'dotted' : 'arrow') as EdgeKind,
        order,
        seqY,
      });
      order++;
    } else if (m.type === SEQ_NOTE_TYPE) {
      const from = actorName(m.from);
      const to = actorName(m.to);
      const actors = to !== '' && to !== from ? [from, to] : [from];
      const placement = typeof m.placement === 'number' ? m.placement : 2;
      const geo = noteRects[noteIdx];
      noteIdx++;
      let x: number;
      let y: number;
      let width = SEQ_NOTE_FALLBACK_WIDTH;
      let height = SEQ_NOTE_FALLBACK_HEIGHT;
      if (geo) {
        ({ x, y, width, height } = geo);
      } else {
        const xs = actors
          .map((a) => actorGeometry.get(a)?.x)
          .filter((v): v is number => typeof v === 'number');
        const minX = xs.length ? Math.min(...xs) : 0;
        const maxX = xs.length ? Math.max(...xs) : 0;
        x =
          placement === SEQ_PLACEMENT_LEFT
            ? minX - SEQ_NOTE_X_OFFSET
            : placement === SEQ_PLACEMENT_RIGHT
              ? maxX + SEQ_NOTE_X_OFFSET
              : (minX + maxX) / 2;
        y = lastY + SEQ_MESSAGE_FALLBACK_STEP;
      }
      lastY = Math.max(lastY, y);
      nodes.push({
        id: `note:${noteIdx - 1}`,
        label: messageText(m.message),
        shape: 'sticky',
        x,
        y,
        width,
        height,
        data: { role: 'note', actors, placement, order },
      });
      order++;
    }
    // Other type codes (loop/alt/opt/activations/…) are control records
    // without an own arrow line: ignored, and they consume no messageY.
  }

  return { kind: 'sequence', direction: 'TB', nodes, edges };
}

let renderCounter = 0;

/**
 * Parse mermaid source (flowchart, classDiagram, stateDiagram or
 * sequenceDiagram) into a DiagramModel with layout coordinates. Must run in
 * a real browser (mermaid needs DOM text measurement).
 */
export async function mermaidToModel(code: string): Promise<DiagramModel> {
  ensureInit();

  // 1. Render to SVG for geometry. The container must be in the live DOM.
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-99999px';
  container.style.top = '0';
  document.body.appendChild(container);
  try {
    const renderId = `fabric-md-${renderCounter++}`;
    const { svg } = await mermaid.render(renderId, code, container);
    container.innerHTML = svg;
    const svgRoot = container.querySelector('svg');
    if (!svgRoot) throw new Error('mermaid did not produce an SVG');

    const geometry = extractNodeGeometry(svgRoot);

    // 2. Logical structure from the internal db, falling back to SVG scraping.
    let diagram: MermaidDiagram | null = null;
    try {
      diagram = await (mermaid as unknown as MermaidWithApi).mermaidAPI.getDiagramFromText(code);
    } catch (err) {
      console.warn('[fabric-markdown] mermaid db unavailable, falling back to SVG parsing', err);
    }

    // Registered plugins (er/gantt/pie/mindmap/...) take precedence.
    if (diagram?.type) {
      const plugin = pluginForType(diagram.type);
      if (plugin) return plugin.parse({ db: diagram.db, svgRoot, geometry });
    }

    if (diagram?.type === 'class' || diagram?.type === 'classDiagram') {
      return classModelFromDb(diagram.db, geometry);
    }

    if (diagram?.type === 'stateDiagram' || diagram?.type === 'stateDiagram-v2') {
      return stateModelFromDb(diagram.db, geometry, svgRoot);
    }

    if (diagram?.type === 'sequence') {
      return sequenceModelFromDb(diagram.db, svgRoot);
    }

    let vertices: DbVertex[];
    let edges: DbEdge[];
    let direction: Direction = 'TD';
    if (diagram) {
      const parsed = readDb(diagram.db);
      vertices = parsed.vertices;
      edges = parsed.edges;
      direction = parsed.direction;
    } else {
      const parsed = structureFromSvg(svgRoot);
      vertices = parsed.vertices;
      edges = parsed.edges;
    }

    // 3. Merge logic + geometry into the IR.
    const nodes: DiagramNode[] = [];
    for (const v of vertices) {
      const geo = geometry.get(v.id);
      if (!geo) {
        console.warn(`[fabric-markdown] no geometry for node "${v.id}", skipping`);
        continue;
      }
      nodes.push({
        id: v.id,
        label: (v.text ?? v.id).trim(),
        shape: mapShape(v.type),
        x: geo.x,
        y: geo.y,
        width: geo.width,
        height: geo.height,
      });
    }
    const modelEdges: DiagramEdge[] = edges.map((e, i) => ({
      id: `e${i}`,
      source: e.start,
      target: e.end,
      label: e.text?.trim() || undefined,
      kind: mapEdgeKind(e),
    }));

    // Subgraphs: locked background boxes + title labels, pushed to the front
    // of the node list so they paint underneath their member nodes.
    const subGraphs = diagram ? readSubGraphs(diagram.db) : [];
    const sgNodes = subGraphs.length
      ? buildSubgraphNodes(subGraphs, extractClusterGeometry(svgRoot), nodes)
      : [];
    // Edges may reference a subgraph id directly (A --> sg1); retarget them
    // to the subgraph's rect node so referential integrity holds.
    if (sgNodes.length) {
      const sgIdMap = new Map(
        sgNodes
          .filter((n) => n.data?.['role'] === 'subgraph')
          .map((n) => [n.data!['sgId'] as string, n.id]),
      );
      const vertexIds = new Set(nodes.map((n) => n.id));
      for (const e of modelEdges) {
        if (!vertexIds.has(e.source) && sgIdMap.has(e.source)) e.source = sgIdMap.get(e.source)!;
        if (!vertexIds.has(e.target) && sgIdMap.has(e.target)) e.target = sgIdMap.get(e.target)!;
      }
    }

    return { kind: 'flowchart', direction, nodes: [...sgNodes, ...nodes], edges: modelEdges };
  } finally {
    container.remove();
  }
}
