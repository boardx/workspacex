import { RenderedDiagramLayout, type RenderedDiagramLayout as Layout, type WhiteboardOperationActor } from '@repo/contracts/whiteboard-operation';
import type { WhiteboardCommand, WhiteboardObject } from '@repo/contracts/whiteboard-document';
import type { ShapeContent, ShapeVariant } from './content-object-model';
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
  const generatedIds = new Set(selectedObjects.map(object => id(object.sourceId)));
  for (const [sourceIndex, source] of selectedObjects.entries()) {
    if (source.kind === 'edge' && (!source.fromSourceId || !source.toSourceId || !included.has(source.fromSourceId) || !included.has(source.toSourceId))) continue;
    if (source.kind === 'node' && source.style.shape !== undefined && !['rect','round','stadium','diamond','circle','participant','text','sticky'].includes(String(source.style.shape))) throw new Error('BOARD_DIAGRAM_SHAPE_UNSUPPORTED');
    const object: WhiteboardObject = {
      id: id(source.sourceId), schemaVersion: 1,
      kind: source.kind === 'node' && source.style.shape === 'text' ? 'text' : source.kind === 'node' && source.style.shape === 'sticky' ? 'sticky' : source.kind === 'node' && source.style.shape === 'circle' ? 'ellipse' : source.kind === 'edge' ? 'connector' : source.kind === 'group' ? 'group' : source.kind === 'image' ? 'image' : source.kind === 'unknown' ? 'extension' : 'rectangle',
      geometry: { ...source.geometry, x: source.geometry.x + offset.x, y: source.geometry.y + offset.y }, text: source.text,
      style: { fill: typeof source.style.fill === 'string' ? source.style.fill : undefined, stroke: typeof source.style.stroke === 'string' ? source.style.stroke : undefined,
        color: typeof source.style.color === 'string' ? source.style.color : undefined, fontSize: typeof source.style.fontSize === 'number' ? source.style.fontSize : undefined },
      parentId: null, orderKey: String(sourceIndex).padStart(8, '0'),
      ...(source.kind === 'edge' ? { connector: connectorFor(source, id, offset) } : {}),
      extensionData: { content: { version: 1, type: 'artifact', artifactId: layout.artifactId, sourceId: source.sourceId, sourceRevision: layout.sourceRevision, layoutHash: layout.layoutHash, originalKind: source.kind, originalStyle: source.style, diagramKind: layout.diagramKind, orgId: layout.orgId, offset, fromSourceId: source.fromSourceId, toSourceId: source.toSourceId } },
    };
    if (source.kind === 'node' && !['text', 'sticky'].includes(String(source.style.shape))) {
      const variants: Record<string, ShapeVariant> = { rect: 'rectangle', round: 'rounded-rectangle', stadium: 'terminator', diamond: 'diamond', circle: 'circle', participant: 'rectangle' };
      const variant = variants[String(source.style.shape)] ?? 'rectangle';
      const content: ShapeContent = { version: 1, type: 'shape', variant, fill: object.style.fill === 'transparent' ? '#00000000' : object.style.fill ?? '#ffffff', borderColor: object.style.stroke === 'transparent' ? '#00000000' : object.style.stroke ?? '#1e293b', borderWidth: typeof source.style.borderWidth === 'number' ? source.style.borderWidth : 1, borderStyle: 'solid', opacity: 1, radius: 8, textColor: object.style.color ?? '#1e293b', horizontalAlign: 'center', verticalAlign: 'middle' };
      object.extensionData!.contentObject = content;
    }
    if (object.kind === 'text') object.extensionData!.thinkingInput = { text: { preset: 'body', fontSize: object.style.fontSize ?? 13, color: object.style.color ?? '#1e293b', bold: source.style.bold === true, alignment: ['left','center','right'].includes(String(source.style.alignment)) ? source.style.alignment : 'center' } };
    commands.push({ type: 'create', object });
    if (source.kind === 'edge' && typeof source.style.selfLoopWidth === 'number' && source.style.selfLoopWidth > 0 && object.connector?.toPoint && object.connector.fromPoint) {
      const helperId = `${object.id}_return`;
      if (generatedIds.has(helperId)) throw new Error('BOARD_ARTIFACT_ID_COLLISION');
      generatedIds.add(helperId);
      const fromPoint = object.connector.toPoint;
      const toPoint = { x: object.connector.fromPoint.x, y: fromPoint.y };
      commands.push({ type: 'create', object: { id: helperId, schemaVersion: 1, kind: 'connector', geometry: { x: toPoint.x, y: toPoint.y, width: source.style.selfLoopWidth, height: 1, rotation: 0 }, text: '', style: object.style, parentId: null, orderKey: `${object.orderKey}-return`, connector: { fromPoint, toPoint, type: 'straight', endStyle: 'arrow', lineStyle: object.connector.lineStyle }, extensionData: { content: {type:'artifact-helper',artifactId:layout.artifactId,sourceId:source.sourceId,role:'message-return'} } } });
    }
    if (source.kind === 'node' && source.style.shape === 'participant' && typeof source.style.lifelineHeight === 'number' && source.style.lifelineHeight > 0) {
      const helperId = `${id(source.sourceId)}_lifeline`;
      if (generatedIds.has(helperId)) throw new Error('BOARD_ARTIFACT_ID_COLLISION');
      generatedIds.add(helperId);
      const x = object.geometry.x + object.geometry.width / 2, y = object.geometry.y + object.geometry.height;
      commands.push({ type: 'create', object: { id: helperId, schemaVersion: 1, kind: 'connector', geometry: { x, y, width: 1, height: source.style.lifelineHeight, rotation: 0 }, text: '', style: { stroke: '#64748b' }, parentId: null, orderKey: `${object.orderKey}-lifeline`, connector: { fromPoint: { x, y }, toPoint: { x, y: y + source.style.lifelineHeight }, type: 'straight', endStyle: 'none', lineStyle: 'dashed' }, extensionData: { content: { type: 'artifact-helper', artifactId: layout.artifactId, sourceId: source.sourceId, role: 'lifeline' } } } });
    }
  }
  return commands;
}

function connectorFor(source: Layout['objects'][number], id: (sourceId: string) => string, offset: {x:number;y:number}): NonNullable<WhiteboardObject['connector']> {
  if (source.text.length > 1000) throw new Error('BOARD_ARTIFACT_CONNECTOR_LABEL_TOO_LONG');
  const style = source.style;
  const sequence = ['seqY', 'fromX', 'fromY', 'toX', 'toY'].every(key => typeof style[key] === 'number');
  return {
    ...(sequence ? { fromPoint: { x: Number(style.fromX) + offset.x, y: Number(style.fromY) + offset.y }, toPoint: { x: Number(style.toX) + offset.x + (typeof style.selfLoopWidth === 'number' ? style.selfLoopWidth : 0), y: Number(style.toY) + offset.y } } : { from: id(source.fromSourceId!), to: id(source.toSourceId!) }),
    type: sequence && source.fromSourceId === source.toSourceId ? 'elbow' : 'straight',
    endStyle: typeof style.selfLoopWidth === 'number' || style.edgeKind === 'open' ? 'none' : 'arrow',
    lineStyle: style.edgeKind === 'dotted' ? 'dotted' : 'solid', label: source.text,
  };
}
