import { RenderedDiagramLayout, type RenderedDiagramLayout as Layout, type WhiteboardOperationActor } from '@repo/contracts/whiteboard-operation';
import type { WhiteboardCommand, WhiteboardObject } from '@repo/contracts/whiteboard-document';
import { stableBoardDigest } from './operation-kernel';

function safeId(value: string): string { return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80); }
export function computeRenderedLayoutHash(layout: Omit<Layout, 'layoutHash'>): string { return stableBoardDigest('layout-v1', layout); }
export function verifyRenderedDiagramLayout(untrusted: unknown): Layout {
  const layout = RenderedDiagramLayout.parse(untrusted);
  const { layoutHash: _layoutHash, ...body } = layout;
  if (computeRenderedLayoutHash(body) !== layout.layoutHash) throw new Error('BOARD_ARTIFACT_LAYOUT_HASH_MISMATCH');
  const ids = new Set(layout.objects.map(object => object.sourceId));
  if(ids.size!==layout.objects.length)throw new Error('BOARD_ARTIFACT_DUPLICATE_ID');
  if(layout.selectedSourceIds.some(id=>!ids.has(id)))throw new Error('BOARD_ARTIFACT_SELECTION_UNKNOWN');
  for (const object of layout.objects) if (object.kind === 'edge' && (!object.fromSourceId || !object.toSourceId || !ids.has(object.fromSourceId) || !ids.has(object.toSourceId))) throw new Error('BOARD_ARTIFACT_DANGLING_EDGE');
  return layout;
}
export function renderedLayoutToCommands(input: unknown, actor: WhiteboardOperationActor, boardOrgId: string, offset = { x: 0, y: 0 }): WhiteboardCommand[] {
  const layout = verifyRenderedDiagramLayout(input);
  if (layout.orgId !== boardOrgId || actor.orgId !== boardOrgId || !actor.scopes.includes('artifact:read') || !actor.scopes.includes('board:write')) throw new Error('BOARD_ARTIFACT_FORBIDDEN');
  const selected = layout.selectedSourceIds.length ? new Set(layout.selectedSourceIds) : null;
  const selectedObjects = layout.objects.filter(object => !selected || selected.has(object.sourceId));
  const included = new Set(selectedObjects.map(object => object.sourceId));
  const id = (sourceId: string) => `artifact_${safeId(layout.artifactId)}_${safeId(sourceId)}`;
  if (new Set(selectedObjects.map(object => id(object.sourceId))).size !== selectedObjects.length) throw new Error('BOARD_ARTIFACT_ID_COLLISION');
  const commands: WhiteboardCommand[] = [];
  for (const source of selectedObjects) {
    if (source.kind === 'edge' && (!source.fromSourceId || !source.toSourceId || !included.has(source.fromSourceId) || !included.has(source.toSourceId))) continue;
    const object: WhiteboardObject = {
      id: id(source.sourceId), schemaVersion: 1,
      kind: source.kind === 'edge' ? 'connector' : source.kind === 'group' ? 'group' : source.kind === 'image' ? 'image' : source.kind === 'unknown' ? 'extension' : 'rectangle',
      geometry: { ...source.geometry, x: source.geometry.x + offset.x, y: source.geometry.y + offset.y }, text: source.text,
      style: { fill: typeof source.style.fill === 'string' ? source.style.fill : undefined, stroke: typeof source.style.stroke === 'string' ? source.style.stroke : undefined,
        color: typeof source.style.color === 'string' ? source.style.color : undefined, fontSize: typeof source.style.fontSize === 'number' ? source.style.fontSize : undefined },
      parentId: null, orderKey: source.sourceId,
      ...(source.kind === 'edge' ? { connector: { from: id(source.fromSourceId!), to: id(source.toSourceId!), type: 'straight' as const, endStyle: 'arrow' as const } } : {}),
      extensionData: { content: { version: 1, type: 'artifact', artifactId: layout.artifactId, sourceId: source.sourceId, sourceRevision: layout.sourceRevision, layoutHash: layout.layoutHash, originalKind: source.kind, originalStyle: source.style } },
    };
    commands.push({ type: 'create', object });
  }
  return commands;
}
