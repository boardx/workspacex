import type {
  DiagramImportBundleData as DiagramImportContract,
  DiagramImportLossCode,
} from '@repo/contracts/whiteboard-import';
import { WhiteboardObject, WhiteboardCommandBatch, WhiteboardObjectId, WHITEBOARD_LIMITS, type WhiteboardCommand } from '@repo/contracts/whiteboard-document';

/** Structural boundary: core imports no Fabric or Mermaid runtime. */
export type DiagramImportBundle = Pick<
  DiagramImportContract,
  'model' | 'groupId' | 'nodeIds' | 'edgeIds' | 'diagnostics'
>;
export interface DiagramImportLoss { code: DiagramImportLossCode; objectId?: string; detail: string }
export type DiagramImportResult =
  | { ok: true; groupId: string; objects: WhiteboardObject[]; commands: WhiteboardCommand[]; losses: DiagramImportLoss[] }
  | { ok: false; code: 'CAPACITY' | 'INVALID'; detail: string; losses: DiagramImportLoss[] };

/** Caller supplies a fresh legal importId and authorized sourceRef, never actor identity. */
export function prepareDiagramImport(bundle: DiagramImportBundle, importId: string, sourceRef: Record<string, unknown>): DiagramImportResult {
  const losses: DiagramImportLoss[] = bundle.diagnostics.map(detail => ({ code: 'SOURCE_DIAGNOSTIC', detail }));
  const count = bundle.model.nodes.length + bundle.model.edges.length + 1;
  if (count > WHITEBOARD_LIMITS.batch) return { ok: false, code: 'CAPACITY', detail: `Whole diagram requires ${count} commands; limit is ${WHITEBOARD_LIMITS.batch}. No partial batch produced.`, losses };
  try {
    const groupId = WhiteboardObjectId.parse(`diagram_${importId}`);
    const ids = new Map<string, string>();
    for (const [i, node] of bundle.model.nodes.entries()) {
      if (ids.has(node.id)) throw new Error('Duplicate source node ID');
      ids.set(node.id, WhiteboardObjectId.parse(`${groupId}_n${i}`));
    }
    const edgeSet = new Set<string>();
    const nodes: WhiteboardObject[] = bundle.model.nodes.map((node, i) => {
      if (![node.x, node.y, node.width, node.height].every(Number.isFinite) || node.width < 0 || node.height < 0) throw new Error('Invalid source geometry');
      const id = ids.get(node.id)!;
      const native: Record<string, WhiteboardObject['kind']> = { rect: 'rectangle', circle: 'ellipse', sticky: 'sticky', text: 'text' };
      const kind = native[node.shape] ?? 'rectangle';
      if (!native[node.shape]) losses.push({ code: 'SHAPE_APPROXIMATION', objectId: id, detail: `${node.shape} rendered as editable rectangle; specialized shape data is preserved.` });
      if (node.data || node.members || node.methods || node.lifelineHeight !== undefined) losses.push({ code: 'SPECIALIZED_EDITING_UNAVAILABLE', objectId: id, detail: 'Specialized semantics retained in extensionData; generic geometry/text editing only.' });
      if (node.width <= 0 || node.height <= 0) losses.push({ code: 'ZERO_SIZE_EXPANDED', objectId: id, detail: 'Zero-size geometry expanded to one world unit for selectable objects.' });
      const width = Math.max(1, node.width), height = Math.max(1, node.height);
      return WhiteboardObject.parse({ id, schemaVersion: 1, kind,
        geometry: { x: node.x - width / 2, y: node.y - height / 2, width, height, rotation: 0 },
        text: node.label, style: {}, parentId: groupId, orderKey: String(i).padStart(6, '0'),
        extensionData: jsonCopy({ sourceRef, diagramKind: bundle.model.kind, diagramNode: node }),
      });
    });
    const edges: WhiteboardObject[] = bundle.model.edges.map((edge, i) => {
      if (edgeSet.has(edge.id)) throw new Error('Duplicate source edge ID');
      edgeSet.add(edge.id);
      const from = ids.get(edge.source), to = ids.get(edge.target);
      if (!from || !to) throw new Error('Dangling source edge');
      const id = `${groupId}_e${i}`;
      if (edge.kind !== 'arrow' || edge.seqY !== undefined || edge.sourceLabel || edge.targetLabel || edge.data) losses.push({ code: 'CONNECTOR_SEMANTICS_APPROXIMATED', objectId: id, detail: 'Generic editable connector; markers, cardinality and sequence layout retained as metadata.' });
      return WhiteboardObject.parse({ id, schemaVersion: 1, kind: 'connector',
        geometry: { x: 0, y: 0, width: 1, height: 1, rotation: 0 }, text: edge.label ?? '',
        style: {}, parentId: groupId, orderKey: `edge${i}`, connector: { from, to },
        extensionData: jsonCopy({ sourceRef, diagramKind: bundle.model.kind, diagramEdge: edge }),
      });
    });
    const minX = nodes.length ? Math.min(...nodes.map(n => n.geometry.x)) : 0;
    const minY = nodes.length ? Math.min(...nodes.map(n => n.geometry.y)) : 0;
    const maxX = nodes.length ? Math.max(...nodes.map(n => n.geometry.x + n.geometry.width)) : 1;
    const maxY = nodes.length ? Math.max(...nodes.map(n => n.geometry.y + n.geometry.height)) : 1;
    const remap = Object.fromEntries(ids);
    const group = WhiteboardObject.parse({ id: groupId, schemaVersion: 1, kind: 'group',
      geometry: { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY), rotation: 0 },
      text: '', style: {}, parentId: null, orderKey: '',
      extensionData: jsonCopy({ sourceRef, diagramKind: bundle.model.kind, direction: bundle.model.direction,
        meta: bundle.model.meta ?? {}, sourceGroupId: bundle.groupId, sourceNodeIds: bundle.nodeIds, sourceEdgeIds: bundle.edgeIds,
        boardNodeIds: remap, boardEdgeIds: Object.fromEntries(bundle.model.edges.map((e, i) => [e.id, `${groupId}_e${i}`])), payloadReferenceSpace: 'source-local' }),
    });
    if (nodes.some(n => n.extensionData?.diagramNode)) losses.push({ code: 'PLUGIN_STYLE_NOT_RENDERED', detail: 'Plugin styles remain preserved data; core native style uses defaults.' });
    const objects = [group, ...nodes, ...edges];
    const commands = WhiteboardCommandBatch.parse(objects.map(object => ({ type: 'create', object })));
    return { ok: true, groupId, objects, commands, losses };
  } catch (error) {
    return { ok: false, code: 'INVALID', detail: error instanceof Error ? error.message : 'Invalid diagram', losses };
  }
}

/** IR optional properties are omitted from persisted JSON, not stored as undefined. */
function jsonCopy(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
