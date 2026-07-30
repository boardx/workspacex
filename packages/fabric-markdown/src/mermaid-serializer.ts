/**
 * DiagramModel → mermaid flowchart text. Pure functions.
 */
import type { DiagramModel, DiagramNode, DiagramEdge, EdgeKind, NodeShape } from './model';
import { pluginForKind } from './diagrams/registry';

const SHAPE_BRACKETS: Record<NodeShape, [string, string]> = {
  rect: ['[', ']'],
  round: ['(', ')'],
  stadium: ['([', '])'],
  diamond: ['{', '}'],
  circle: ['((', '))'],
  class: ['[', ']'], // class boxes degrade to rects if emitted as flowchart
  // State/sequence/chart shapes degrade to simple boxes if emitted as flowchart.
  stateStart: ['((', '))'],
  stateEnd: ['((', '))'],
  participant: ['[', ']'],
  pieSlice: ['[', ']'],
  text: ['[', ']'],
  sticky: ['[', ']'],
  image: ['[', ']'],
};

const EDGE_OPS: Record<EdgeKind, string> = {
  arrow: '-->',
  open: '---',
  dotted: '-.->',
  thick: '==>',
  // UML kinds degrade to plain arrows in flowchart output.
  inheritance: '-->',
  realization: '-.->',
  composition: '-->',
  aggregation: '-->',
  dependency: '-.->',
};

/**
 * Mermaid node ids must be word-ish; sanitize anything else. Unicode letters
 * (e.g. Chinese state names) are valid mermaid ids and are preserved.
 */
export function sanitizeNodeId(id: string, taken: Set<string>): string {
  let safe = id.replace(/[^\p{L}\p{N}_]/gu, '_');
  if (!/^[\p{L}_]/u.test(safe)) safe = 'n' + safe;
  if (safe === '') safe = 'n';
  let candidate = safe;
  let counter = 2;
  while (taken.has(candidate)) candidate = `${safe}${counter++}`;
  taken.add(candidate);
  return candidate;
}

/** Escape a label for use inside quoted mermaid node text. */
export function escapeLabel(label: string): string {
  return label.replace(/"/g, '#quot;').replace(/\r?\n/g, '<br/>');
}

function nodeDecl(node: DiagramNode, id: string): string {
  const [open, close] = SHAPE_BRACKETS[node.shape] ?? SHAPE_BRACKETS.rect;
  return `${id}${open}"${escapeLabel(node.label)}"${close}`;
}

function edgeDecl(edge: DiagramEdge, idMap: Map<string, string>): string {
  const op = EDGE_OPS[edge.kind] ?? EDGE_OPS.arrow;
  const src = idMap.get(edge.source) ?? edge.source;
  const tgt = idMap.get(edge.target) ?? edge.target;
  if (edge.label && edge.label.trim() !== '') {
    return `${src} ${op}|"${escapeLabel(edge.label)}"| ${tgt}`;
  }
  return `${src} ${op} ${tgt}`;
}

// UML relation operators; the marker lands on the target (right) side.
const CLASS_EDGE_OPS: Record<EdgeKind, string> = {
  inheritance: '--|>',
  realization: '..|>',
  composition: '--*',
  aggregation: '--o',
  dependency: '..>',
  arrow: '-->',
  dotted: '..',
  thick: '-->',
  open: '--',
};

function classEdgeDecl(edge: DiagramEdge, idMap: Map<string, string>): string {
  const op = CLASS_EDGE_OPS[edge.kind] ?? '-->';
  const src = idMap.get(edge.source) ?? edge.source;
  const tgt = idMap.get(edge.target) ?? edge.target;
  const srcCard = edge.sourceLabel ? ` "${escapeLabel(edge.sourceLabel)}"` : '';
  const tgtCard = edge.targetLabel ? `"${escapeLabel(edge.targetLabel)}" ` : '';
  const title = edge.label && edge.label.trim() !== '' ? ` : ${edge.label.trim()}` : '';
  return `${src}${srcCard} ${op} ${tgtCard}${tgt}${title}`;
}

function classModelToMermaid(model: DiagramModel): string {
  // classDiagram uses TB instead of TD.
  const dir = model.direction === 'TD' ? 'TB' : model.direction;
  const lines: string[] = ['classDiagram', `    direction ${dir}`];
  const taken = new Set<string>();
  const idMap = new Map<string, string>();
  for (const node of model.nodes) {
    idMap.set(node.id, sanitizeNodeId(node.id, taken));
  }
  for (const node of model.nodes) {
    const id = idMap.get(node.id)!;
    const alias = node.label !== node.id ? `["${escapeLabel(node.label)}"]` : '';
    // Annotations (<<interface>> …) come from data.annotations, plus any
    // member rows written as «xxx» (how the parser displays them on canvas).
    const annotations: string[] = [];
    const rawAnnotations = node.data?.['annotations'];
    if (Array.isArray(rawAnnotations)) {
      for (const a of rawAnnotations) {
        if (typeof a === 'string' && a.trim() !== '') annotations.push(a.trim());
      }
    }
    const members: string[] = [];
    for (const m of node.members ?? []) {
      const guillemet = /^«(.+)»$/.exec(m.trim());
      if (guillemet) {
        if (!annotations.includes(guillemet[1]!.trim())) annotations.push(guillemet[1]!.trim());
      } else {
        members.push(m);
      }
    }
    const methods = node.methods ?? [];
    if (annotations.length === 0 && members.length === 0 && methods.length === 0) {
      lines.push(`    class ${id}${alias}`);
      continue;
    }
    lines.push(`    class ${id}${alias} {`);
    for (const a of annotations) lines.push(`        <<${a}>>`);
    for (const m of members) lines.push(`        ${m}`);
    for (const m of methods) lines.push(`        ${m}`);
    lines.push('    }');
  }
  for (const edge of model.edges) {
    lines.push(`    ${classEdgeDecl(edge, idMap)}`);
  }
  return lines.join('\n');
}

function stateModelToMermaid(model: DiagramModel): string {
  // stateDiagram-v2 uses TB instead of TD.
  const dir = model.direction === 'TD' ? 'TB' : model.direction;
  const lines: string[] = ['stateDiagram-v2', `    direction ${dir}`];
  const taken = new Set<string>();
  // nodeId → token used in transitions: '[*]' for start/end pseudo-states,
  // sanitized id otherwise.
  const tokenMap = new Map<string, string>();
  for (const node of model.nodes) {
    if (node.shape === 'stateStart' || node.shape === 'stateEnd') {
      tokenMap.set(node.id, '[*]');
    } else {
      tokenMap.set(node.id, sanitizeNodeId(node.id, taken));
    }
  }
  for (const node of model.nodes) {
    if (node.shape === 'stateStart' || node.shape === 'stateEnd') continue;
    const id = tokenMap.get(node.id)!;
    // Declare when the display label differs from the emitted token (covers
    // both explicit labels and ids altered by sanitization).
    if (node.label !== id) {
      lines.push(`    state "${escapeLabel(node.label)}" as ${id}`);
    }
  }
  for (const edge of model.edges) {
    // Endpoints missing from the node list (e.g. a composite state whose
    // group box was not imported) still get a sanitized token so the
    // emitted source stays parseable instead of throwing/corrupting.
    let src = tokenMap.get(edge.source);
    if (!src) {
      src = sanitizeNodeId(edge.source, taken);
      tokenMap.set(edge.source, src);
    }
    let tgt = tokenMap.get(edge.target);
    if (!tgt) {
      tgt = sanitizeNodeId(edge.target, taken);
      tokenMap.set(edge.target, tgt);
    }
    const title = edge.label && edge.label.trim() !== '' ? ` : ${edge.label.trim()}` : '';
    lines.push(`    ${src} --> ${tgt}${title}`);
  }
  return lines.join('\n');
}

function sequenceModelToMermaid(model: DiagramModel): string {
  const lines: string[] = ['sequenceDiagram'];
  const taken = new Set<string>();
  const idMap = new Map<string, string>();
  // Note sticky-cards are not participants.
  const participants = model.nodes.filter((n) => n.data?.['role'] !== 'note');
  const notes = model.nodes.filter((n) => n.data?.['role'] === 'note');
  for (const node of participants) {
    idMap.set(node.id, sanitizeNodeId(node.id, taken));
  }
  // Participants keep the model's node order (left → right on canvas).
  for (const node of participants) {
    const id = idMap.get(node.id)!;
    if (node.label !== id) {
      lines.push(`    participant ${id} as ${escapeLabel(node.label)}`);
    } else {
      lines.push(`    participant ${id}`);
    }
  }
  // Messages and notes merged into one stream, sorted top-to-bottom:
  // explicit order wins, then canvas y, then original array position.
  interface Item {
    key: number;
    tiebreak: number;
    line: string;
  }
  const items: Item[] = [];
  model.edges.forEach((edge, index) => {
    const src = idMap.get(edge.source) ?? edge.source;
    const tgt = idMap.get(edge.target) ?? edge.target;
    const op = edge.kind === 'dotted' ? '-->>' : '->>';
    // Mermaid requires text after the colon; use a space placeholder.
    const label = edge.label && edge.label !== '' ? escapeLabel(edge.label) : ' ';
    items.push({
      key: edge.order ?? edge.seqY ?? index,
      tiebreak: index,
      line: `    ${src}${op}${tgt}: ${label}`,
    });
  });
  notes.forEach((note, index) => {
    const data = note.data ?? {};
    const rawActors = Array.isArray(data['actors']) ? (data['actors'] as unknown[]) : [];
    const actorIds = [
      ...new Set(
        rawActors
          .filter((a): a is string => typeof a === 'string' && a !== '')
          .map((a) => idMap.get(a) ?? a),
      ),
    ];
    if (actorIds.length === 0) return; // nothing to anchor the note on
    const placement = data['placement'];
    const pos =
      placement === 0 || placement === 'left' || placement === 'left_of'
        ? 'left'
        : placement === 1 || placement === 'right' || placement === 'right_of'
          ? 'right'
          : 'over';
    const text = note.label.trim() === '' ? ' ' : escapeLabel(note.label);
    const line =
      pos === 'over'
        ? `    Note over ${actorIds.join(',')}: ${text}`
        : `    Note ${pos} of ${actorIds[0]}: ${text}`;
    const orderVal = typeof data['order'] === 'number' ? (data['order'] as number) : undefined;
    items.push({ key: orderVal ?? note.y, tiebreak: model.edges.length + index, line });
  });
  items.sort((a, b) => a.key - b.key || a.tiebreak - b.tiebreak);
  for (const item of items) lines.push(item.line);
  return lines.join('\n');
}

/**
 * Serialize a DiagramModel to mermaid source (flowchart, classDiagram,
 * stateDiagram-v2 or sequenceDiagram).
 * Node coordinates are intentionally NOT emitted — mermaid has no coordinate
 * syntax; layout is recomputed by mermaid on re-import (logic-level round-trip).
 */
export function modelToMermaid(model: DiagramModel): string {
  const plugin = pluginForKind(model.kind);
  if (plugin) return plugin.serialize(model);
  if (model.kind === 'class') return classModelToMermaid(model);
  if (model.kind === 'state') return stateModelToMermaid(model);
  if (model.kind === 'sequence') return sequenceModelToMermaid(model);
  return flowchartModelToMermaid(model);
}

function flowchartModelToMermaid(model: DiagramModel): string {
  const role = (n: DiagramNode): unknown => n.data?.['role'];
  const sgRects = model.nodes.filter((n) => role(n) === 'subgraph');
  const sgTitles = model.nodes.filter((n) => role(n) === 'subgraphTitle');
  // Ordinary nodes: everything that is not part of the subgraph scaffolding.
  const normal = model.nodes.filter((n) => role(n) !== 'subgraph' && role(n) !== 'subgraphTitle');

  const lines: string[] = [`flowchart ${model.direction}`];
  const taken = new Set<string>();
  const idMap = new Map<string, string>();
  for (const node of normal) {
    idMap.set(node.id, sanitizeNodeId(node.id, taken));
  }

  interface Group {
    rect: DiagramNode;
    token: string;
    title: string;
    members: DiagramNode[];
  }
  const groups: Group[] = sgRects.map((rect) => {
    const sgId = typeof rect.data?.['sgId'] === 'string' ? (rect.data['sgId'] as string) : rect.id;
    const token = sanitizeNodeId(sgId, taken);
    // Edges may point at the subgraph box itself.
    idMap.set(rect.id, token);
    // The editable title text node wins over the stored title.
    const titleNode = sgTitles.find((t) => t.data?.['sgId'] === rect.data?.['sgId']);
    const storedTitle = typeof rect.data?.['title'] === 'string' ? (rect.data['title'] as string) : '';
    return { rect, token, title: (titleNode?.label ?? storedTitle).trim(), members: [] };
  });

  // Membership is recomputed from geometry (which box contains the node
  // center) so dragging nodes in/out of a group is reflected on export;
  // nested boxes resolve to the smallest containing one. Boxes without
  // usable geometry fall back to the parsed data.members list.
  const assigned = new Set<string>();
  for (const node of normal) {
    let best: Group | null = null;
    for (const g of groups) {
      const r = g.rect;
      if (
        r.width > 0 &&
        r.height > 0 &&
        Math.abs(node.x - r.x) <= r.width / 2 &&
        Math.abs(node.y - r.y) <= r.height / 2
      ) {
        if (!best || r.width * r.height < best.rect.width * best.rect.height) best = g;
      }
    }
    if (best) {
      best.members.push(node);
      assigned.add(node.id);
    }
  }
  for (const g of groups) {
    if (g.rect.width > 0 && g.rect.height > 0) continue; // geometry was authoritative
    const listed = Array.isArray(g.rect.data?.['members'])
      ? (g.rect.data!['members'] as unknown[])
      : [];
    for (const id of listed) {
      if (typeof id !== 'string' || assigned.has(id)) continue;
      const node = normal.find((n) => n.id === id);
      if (node) {
        g.members.push(node);
        assigned.add(node.id);
      }
    }
  }

  for (const g of groups) {
    lines.push(
      g.title !== '' && g.title !== g.token
        ? `    subgraph ${g.token}["${escapeLabel(g.title)}"]`
        : `    subgraph ${g.token}`,
    );
    for (const node of g.members) {
      lines.push(`        ${nodeDecl(node, idMap.get(node.id)!)}`);
    }
    lines.push('    end');
  }
  for (const node of normal) {
    if (!assigned.has(node.id)) lines.push(`    ${nodeDecl(node, idMap.get(node.id)!)}`);
  }
  for (const edge of model.edges) {
    lines.push(`    ${edgeDecl(edge, idMap)}`);
  }
  return lines.join('\n');
}
