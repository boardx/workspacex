/**
 * erDiagram plugin: entities render as 'class' nodes (three-compartment box,
 * attributes in the members slot), relationships as 'open' edges whose
 * sourceLabel/targetLabel carry the crow's-foot cardinality symbols.
 *
 * Cardinality semantics (verified against mermaid 11.16): for the text
 * `A ||--o{ B : role`, the db reports entityA=A with cardB='ONLY_ONE' (drawn
 * at the A end) and cardA='ZERO_OR_MORE' (drawn at the B end). I.e. cardB
 * belongs to the entityA end and cardA to the entityB end.
 */
import { registerDiagram, type DiagramParseContext } from './registry';
import type { DiagramModel, DiagramNode, DiagramEdge, Direction } from '../model';

interface ErAttribute {
  type?: string;
  name?: string;
  keys?: string[];
  comment?: string;
}

interface ErEntity {
  id?: string;
  label?: string;
  alias?: string;
  attributes?: ErAttribute[];
}

interface ErRelSpec {
  cardA?: string;
  cardB?: string;
  relType?: string;
}

interface ErRelationship {
  entityA?: string;
  roleA?: string;
  entityB?: string;
  relSpec?: ErRelSpec;
}

/** DiagramEdge with the plugin-owned payload (raw cardinality enums). */
type ErEdge = DiagramEdge & { data?: Record<string, unknown> };

/** Symbol at the entityA (left/source) end, keyed by cardB enum. */
const LEFT_CARD: Record<string, string> = {
  ONLY_ONE: '||',
  ZERO_OR_ONE: '|o',
  ZERO_OR_MORE: '}o',
  ONE_OR_MORE: '}|',
};

/** Symbol at the entityB (right/target) end, keyed by cardA enum. */
const RIGHT_CARD: Record<string, string> = {
  ONLY_ONE: '||',
  ZERO_OR_ONE: 'o|',
  ZERO_OR_MORE: 'o{',
  ONE_OR_MORE: '|{',
};

const DIRECTIONS = new Set(['TD', 'TB', 'LR', 'RL', 'BT']);

function callDb<T>(db: Record<string, unknown>, method: string, fallback: T): T {
  const fn = db[method];
  if (typeof fn === 'function') {
    try {
      const out = (fn as (this: unknown) => T).call(db);
      return out ?? fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/** Map / plain-object duality of mermaid db collections → entries. */
function entriesOf<T>(v: unknown): Array<[string, T]> {
  if (v instanceof Map) return [...(v as Map<string, T>).entries()];
  if (v && typeof v === 'object') return Object.entries(v as Record<string, T>);
  return [];
}

export function parseEr(ctx: DiagramParseContext): DiagramModel {
  const { db } = ctx;
  const entities = entriesOf<ErEntity>(callDb<unknown>(db, 'getEntities', {}));
  const relationships = callDb<ErRelationship[]>(db, 'getRelationships', []);
  const rawDir = callDb<string>(db, 'getDirection', 'TB');
  const direction = (DIRECTIONS.has(rawDir) ? rawDir : 'TB') as Direction;

  const nodes: DiagramNode[] = [];
  /** Internal db id (entity-NAME-n) → display name, for relationship lookup. */
  const idToName = new Map<string, string>();

  entities.forEach(([key, ent], i) => {
    const name = ent.label || key;
    if (ent.id) idToName.set(ent.id, name);
    idToName.set(name, name);
    const attrs = ent.attributes ?? [];
    const members = attrs.map((a) => {
      let s = `${a.type ?? ''} ${a.name ?? ''}`.trim();
      if (a.keys && a.keys.length > 0) s += ` ${a.keys.join(',')}`;
      // Attribute comment (official: `string name PK "comment"`) — shown
      // truncated in the members compartment; full text lives in data.
      if (a.comment) {
        const c = a.comment.length > 14 ? `${a.comment.slice(0, 13)}…` : a.comment;
        s += ` "${c}"`;
      }
      return s;
    });
    const col = i % 3;
    const row = Math.floor(i / 3);
    const height = 60 + attrs.length * 22;
    nodes.push({
      id: name,
      label: name,
      shape: 'class',
      x: 140 + col * 260,
      // +90 row gap keeps relationship cardinality labels clear of the boxes.
      y: 110 + row * (height + 90),
      width: 170,
      height,
      members,
      methods: [],
      data: { attributes: attrs },
    });
  });

  const edges: DiagramEdge[] = relationships.map((rel, i) => {
    const spec = rel.relSpec ?? {};
    const source = idToName.get(rel.entityA ?? '') ?? rel.entityA ?? '';
    const target = idToName.get(rel.entityB ?? '') ?? rel.entityB ?? '';
    const edge: ErEdge = {
      id: `e${i}`,
      source,
      target,
      // NON_IDENTIFYING relationships (`..`) render as dashed lines in mermaid.
      kind: spec.relType === 'NON_IDENTIFYING' ? 'dotted' : 'open',
      sourceLabel: LEFT_CARD[spec.cardB ?? 'ONLY_ONE'] ?? '||',
      targetLabel: RIGHT_CARD[spec.cardA ?? 'ONLY_ONE'] ?? '||',
      data: { cardA: spec.cardA, cardB: spec.cardB, relType: spec.relType },
    };
    if (rel.roleA) edge.label = rel.roleA;
    return edge;
  });

  return { kind: 'er', direction, nodes, edges, meta: {} };
}

/** Fallback when node.data was lost: recover attributes from members strings. */
function attrsFromMembers(members: string[] | undefined): ErAttribute[] {
  if (!members) return [];
  return members
    .map((m) => m.trim())
    .filter((m) => m.length > 0)
    .map((m) => {
      // Trailing quoted segment is the (possibly truncated) comment.
      const cm = m.match(/^(.*?)\s*"([^"]*)"$/);
      const body = cm ? cm[1]! : m;
      const parts = body.split(/\s+/);
      const attr: ErAttribute = {
        type: parts[0] ?? 'string',
        name: parts[1] ?? 'field',
        keys:
          parts.length > 2
            ? parts.slice(2).join(' ').split(/[\s,]+/).filter((k) => k.length > 0)
            : [],
      };
      if (cm && cm[2]) attr.comment = cm[2];
      return attr;
    });
}

export function serializeEr(model: DiagramModel): string {
  const lines: string[] = ['erDiagram'];
  const nameOf = new Map<string, string>();

  for (const node of model.nodes) {
    const name = node.label || node.id;
    nameOf.set(node.id, name);
    const attrs =
      (node.data?.attributes as ErAttribute[] | undefined) ?? attrsFromMembers(node.members);
    // Entities without attributes are declared implicitly by relationship lines.
    if (attrs.length === 0) continue;
    lines.push(`  ${name} {`);
    for (const a of attrs) {
      let s = `    ${a.type ?? 'string'} ${a.name ?? 'field'}`;
      if (a.keys && a.keys.length > 0) s += ` ${a.keys.join(', ')}`;
      // Official: attribute comment as trailing quoted string.
      if (a.comment) s += ` "${a.comment}"`;
      lines.push(s);
    }
    lines.push('  }');
  }

  for (const edge of model.edges) {
    const data = (edge as ErEdge).data ?? {};
    const left = LEFT_CARD[(data.cardB as string) ?? 'ONLY_ONE'] ?? '||';
    const right = RIGHT_CARD[(data.cardA as string) ?? 'ONLY_ONE'] ?? '||';
    // data.relType is authoritative; a dashed edge whose data was lost still
    // serializes as non-identifying.
    const nonIdentifying =
      data.relType === 'NON_IDENTIFYING' || (data.relType === undefined && edge.kind === 'dotted');
    const line = nonIdentifying ? '..' : '--';
    const src = nameOf.get(edge.source) ?? edge.source;
    const tgt = nameOf.get(edge.target) ?? edge.target;
    let s = `  ${src} ${left}${line}${right} ${tgt}`;
    // Official syntax requires quotes when the label contains whitespace.
    if (edge.label) s += /\s/.test(edge.label) ? ` : "${edge.label}"` : ` : ${edge.label}`;
    lines.push(s);
  }

  return lines.join('\n');
}

registerDiagram({
  kind: 'er',
  detects: ['er', 'erDiagram'],
  parse: parseEr,
  serialize: serializeEr,
});
