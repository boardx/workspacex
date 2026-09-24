/** Copy boundary from a Chat diagram into a Board. No Mermaid re-layout. */
import type { Canvas } from 'fabric';
import type { DiagramModel } from './model';
import { validateModel } from './model';
import { extractModel } from './canvas-io';
import { FlowNode, FlowEdge } from './fabric-objects';

export interface WhiteboardDiagramCopy {
  schemaVersion: 1;
  converterVersion: 'diagram-copy/1';
  groupId: string;
  /** Independent editable IR; x/y are node centers in world coordinates. */
  model: DiagramModel;
  nodeIds: Record<string, string>;
  edgeIds: Record<string, string>;
  /** Plugin payload remains source-local; resolve references with nodeIds/edgeIds. */
  payloadReferenceSpace: 'source-local';
  diagnostics: string[];
}

/**
 * importId must be newly allocated for an intentional second insertion. Reusing
 * it produces the same IDs, but API idempotency/authorization remain server work.
 * Opaque plugin data is deep-copied, never guessed to be an object reference.
 */
export function diagramToWhiteboard(
  source: DiagramModel,
  importId: string,
  offset: { x: number; y: number } = { x: 0, y: 0 },
): WhiteboardDiagramCopy {
  if (!importId.trim()) throw new Error('importId is required');
  if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y)) throw new Error('Invalid offset');
  const problems = validateModel(source);
  const edgeIds = new Set<string>();
  for (const edge of source.edges) {
    if (edgeIds.has(edge.id)) problems.push(`duplicate edge id: ${edge.id}`);
    edgeIds.add(edge.id);
    if (edge.seqY !== undefined && !Number.isFinite(edge.seqY)) problems.push(`invalid seqY: ${edge.id}`);
  }
  for (const node of source.nodes) {
    if (![node.x, node.y, node.width, node.height].every(Number.isFinite) || node.width < 0 || node.height < 0) {
      problems.push(`invalid geometry: ${node.id}`);
    }
  }
  if (problems.length) throw new Error(problems.join('; '));
  const groupId = `diagram:${encodeURIComponent(importId)}`;
  const nodeIds = Object.fromEntries(source.nodes.map((n, i) => [n.id, `${groupId}:node:${i}`]));
  const mappedEdges = Object.fromEntries(source.edges.map((e, i) => [e.id, `${groupId}:edge:${i}`]));
  const model = structuredClone(source);
  model.nodes = model.nodes.map(n => ({ ...n, id: nodeIds[n.id]!, x: n.x + offset.x, y: n.y + offset.y }));
  model.edges = model.edges.map(e => ({
    ...e, id: mappedEdges[e.id]!, source: nodeIds[e.source]!, target: nodeIds[e.target]!,
    ...(e.seqY === undefined ? {} : { seqY: e.seqY + offset.y }),
  }));
  return {
    schemaVersion: 1, converterVersion: 'diagram-copy/1', groupId, model,
    nodeIds, edgeIds: mappedEdges, payloadReferenceSpace: 'source-local', diagnostics: [],
  };
}

/**
 * Extract the edited canvas without its pan/zoom. Reject unsupported transforms
 * rather than silently flattening them: current DiagramModel cannot represent
 * rotation/skew/scale or arbitrary nested Fabric groups. The caller must surface
 * the error, never replace it with an allegedly editable screenshot.
 */
export function canvasToWhiteboard(canvas: Canvas, importId: string, offset?: { x: number; y: number }): WhiteboardDiagramCopy {
  const objects = canvas.getObjects();
  for (const object of objects) {
    if (!(object instanceof FlowNode) && !(object instanceof FlowEdge)) {
      throw new Error(`Unsupported Fabric object: ${object.type}`);
    }
    if (object.group || object.angle !== 0 || object.skewX !== 0 || object.skewY !== 0 ||
        object.scaleX !== 1 || object.scaleY !== 1 || object.flipX || object.flipY) {
      throw new Error('Unsupported Fabric transform; insertion would lose edited geometry');
    }
  }
  // extractModel intentionally filters dangling edges; do not hide that loss.
  const model = extractModel(canvas);
  if (model.edges.length !== objects.filter(o => o instanceof FlowEdge).length) {
    throw new Error('Dangling Fabric edge; insertion would lose connections');
  }
  const result = diagramToWhiteboard(model, importId, offset);
  result.diagnostics.push('Fabric child-style overrides are not represented by DiagramModel; plugin data styles are preserved.');
  return result;
}
