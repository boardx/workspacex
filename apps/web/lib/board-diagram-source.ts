import {rotatedAnchorPoint} from '@repo/whiteboard-core';
import type { DiagramModel } from '@repo/fabric-markdown/model';

/** Rebuild editable source from current canonical objects. Coordinates remain in Board
 * world space; never use the original source string in place of current labels/geometry. */
export function diagramModelFromBoardObjects(objects: import('@repo/contracts/whiteboard-document').WhiteboardObject[], artifactId: string): DiagramModel {
  const source = objects.filter(object => {
    const content = object.extensionData?.content as Record<string, unknown> | undefined;
    return content?.type === 'artifact' && content.artifactId === artifactId;
  });
  if (!source.length) throw new Error('BOARD_ARTIFACT_NOT_FOUND');
  const first = source[0]!.extensionData!.content as Record<string, unknown>;
  const kind = first.diagramKind === 'sequence' ? 'sequence' : first.diagramKind === 'persona' ? 'template' : 'flowchart';
  const model: DiagramModel = { kind, direction: 'TD', nodes: [], edges: [] };
  const byId=new Map(objects.map(object=>[object.id,object]));
  const ids = new Map(source.map(object => [object.id, String((object.extensionData!.content as Record<string, unknown>).sourceId)]));
  const lifelines=new Map(objects.flatMap(object=>{
    const extra=object.extensionData?.content as Record<string,unknown>|undefined;
    return extra?.type==='artifact-helper' && extra.artifactId===artifactId && extra.role==='lifeline' ? [[String(extra.sourceId),object] as const] : [];
  }));
  for (const object of source) {
    const content = object.extensionData!.content as Record<string, unknown>;
    if (content.layoutHash !== first.layoutHash || content.sourceRevision !== first.sourceRevision || content.diagramKind !== first.diagramKind) throw new Error('BOARD_ARTIFACT_MIXED_SOURCE');
    const style = content.originalStyle as Record<string, string | number | boolean | null>;
    const sourceId = String(content.sourceId);
    const data = typeof style.dataJson === 'string' ? JSON.parse(style.dataJson) as Record<string, unknown> : undefined;
    if (content.originalKind === 'node') {
      if (typeof style.direction === 'string') model.direction = style.direction as DiagramModel['direction'];
      if (typeof style.modelMetaJson === 'string') model.meta = JSON.parse(style.modelMetaJson) as Record<string, unknown>;
      const lifeline = lifelines.get(sourceId);
      const shapeContent=object.extensionData?.contentObject as Record<string,unknown>|undefined;
      const shapeMap:Record<string,DiagramModel['nodes'][number]['shape']>={rectangle:'rect','rounded-rectangle':'round',terminator:'stadium',diamond:'diamond',circle:'circle',ellipse:'circle'};
      const shape=style.shape==='participant'?'participant':object.kind==='text'?'text':object.kind==='sticky'?'sticky':shapeContent?.type==='shape'?shapeMap[String(shapeContent.variant)]:style.shape as DiagramModel['nodes'][number]['shape'];
      if(!shape)throw new Error('BOARD_DIAGRAM_SHAPE_UNSUPPORTED');
      model.nodes.push({ id: sourceId, label: object.text, shape,
        x: object.geometry.x + object.geometry.width/2, y: object.geometry.y + object.geometry.height/2, width: object.geometry.width, height: object.geometry.height,
        ...(data === undefined ? {} : { data }),
        ...(typeof style.lifelineHeight === 'number' ? { lifelineHeight: lifeline?.geometry.height ?? style.lifelineHeight } : {}),
        ...(typeof style.membersJson === 'string' ? { members: JSON.parse(style.membersJson) as string[] } : {}),
        ...(typeof style.methodsJson === 'string' ? { methods: JSON.parse(style.methodsJson) as string[] } : {}),
      });
    } else if (content.originalKind === 'edge') {
      const from = object.connector?.from ? ids.get(object.connector.from) : content.fromSourceId;
      const to = object.connector?.to ? ids.get(object.connector.to) : content.toSourceId;
      if (typeof from !== 'string' || typeof to !== 'string') throw new Error('BOARD_ARTIFACT_DANGLING_EDGE');
      model.edges.push({ id: sourceId, source: from, target: to, kind: object.connector?.lineStyle==='dotted' || object.connector?.lineStyle==='dashed' ? 'dotted' : object.connector?.endStyle==='none' && typeof style.selfLoopWidth!=='number' ? 'open' : style.edgeKind==='dotted' || style.edgeKind==='open' ? 'arrow' : style.edgeKind as DiagramModel['edges'][number]['kind'], label: (object.connector?.label ?? object.text) || undefined,
        ...(data === undefined ? {} : { data }),
        ...(typeof style.order === 'number' ? { order: style.order } : {}),
        ...(typeof style.seqY === 'number' ? { seqY: object.connector?.from && byId.has(object.connector.from) ? rotatedAnchorPoint(byId.get(object.connector.from)!,object.connector.fromAnchor??'center',object.connector.fromOffset).y : object.connector?.fromPoint?.y ?? object.geometry.y } : {}),
        ...(typeof style.sourceLabel === 'string' ? { sourceLabel: style.sourceLabel } : {}),
        ...(typeof style.targetLabel === 'string' ? { targetLabel: style.targetLabel } : {}),
      });
    }
  }
  const nodeIds = new Set(model.nodes.map(node => node.id));
  if (model.edges.some(edge => !nodeIds.has(edge.source) || !nodeIds.has(edge.target))) throw new Error('BOARD_ARTIFACT_DANGLING_EDGE');
  return model;
}
