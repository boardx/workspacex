import type { DiagramModel } from '@repo/fabric-markdown/model';
import { SEQ_SELF_MESSAGE_DROP, SEQ_SELF_MESSAGE_WIDTH, PRIMARY_SOFT, PRIMARY, INK, INK_SOFT, STICKY_FILL, FONT, STROKE_W, paletteSoftAt } from '@repo/fabric-markdown/theme';
import { computeRenderedLayoutHash } from '@repo/whiteboard-core';
import type { RenderedDiagramLayout } from '@repo/contracts/whiteboard-operation';

/** Capture the rendered model, never re-run Mermaid's layout during transport. */
export function renderedDiagramLayout(model: DiagramModel, artifactId: string, orgId: string, sourceRevision: string): RenderedDiagramLayout {
  if (model.kind !== 'flowchart' && model.kind !== 'sequence' && !(model.kind === 'template' && model.meta?.templateKey === 'persona')) throw new Error('BOARD_DIAGRAM_FAMILY_UNSUPPORTED');
  if (model.nodes.some(node => !['rect','round','stadium','diamond','circle','participant','text','sticky'].includes(node.shape))) throw new Error('BOARD_DIAGRAM_SHAPE_UNSUPPORTED');
  const nodes = new Map(model.nodes.map(node => [node.id, node]));
  const objects: RenderedDiagramLayout['objects'] = [
    ...model.nodes.map(node => ({
      sourceId: node.id, kind: 'node' as const,
      geometry: { x: node.x - node.width / 2, y: node.y - node.height / 2, width: node.width, height: node.height, rotation: 0 },
      text: node.label, style: {
        shape: node.shape, direction: model.direction,
        fill: node.shape === 'text' ? 'transparent' : typeof node.data?.color === 'string' ? node.data.color : node.shape === 'sticky' ? STICKY_FILL : node.shape === 'stadium' ? paletteSoftAt(2) : node.shape === 'diamond' ? paletteSoftAt(3) : PRIMARY_SOFT,
        stroke: typeof node.data?.stroke === 'string' ? node.data.stroke : PRIMARY,
        color: node.shape === 'text' ? typeof node.data?.color === 'string' ? node.data.color : INK_SOFT : INK,
        fontSize: typeof node.data?.fontSize === 'number' ? node.data.fontSize : node.shape === 'participant' ? FONT.section : FONT.body,
        borderWidth: STROKE_W.normal,
        alignment: typeof node.data?.align === 'string' ? node.data.align : 'center', bold: node.data?.bold === true,
        ...(model.meta === undefined ? {} : { modelMetaJson: JSON.stringify(model.meta) }),
        ...(node.data === undefined ? {} : { dataJson: JSON.stringify(node.data) }),
        ...(node.lifelineHeight === undefined ? {} : { lifelineHeight: node.lifelineHeight }),
        ...(node.members === undefined ? {} : { membersJson: JSON.stringify(node.members) }),
        ...(node.methods === undefined ? {} : { methodsJson: JSON.stringify(node.methods) }),
      }, fromSourceId: null, toSourceId: null,
    })),
    ...model.edges.map((edge, index) => {
      const from = nodes.get(edge.source), to = nodes.get(edge.target);
      if (!from || !to) throw new Error('BOARD_ARTIFACT_DANGLING_EDGE');
      const sequence = typeof edge.seqY === 'number';
      const ax = from.x, ay = sequence ? edge.seqY! : from.y;
      const bx = to.x, by = sequence ? edge.seqY! + (edge.source === edge.target ? SEQ_SELF_MESSAGE_DROP : 0) : to.y;
      return {
        sourceId: edge.id || `edge-${index}`, kind: 'edge' as const,
        geometry: { x: Math.min(ax, bx), y: Math.min(ay, by), width: sequence && edge.source === edge.target ? SEQ_SELF_MESSAGE_WIDTH : Math.max(1, Math.abs(bx-ax)), height: Math.max(1, Math.abs(by-ay)), rotation: 0 },
        text: edge.label ?? '', style: { edgeKind: edge.kind,
          ...(sequence && edge.source === edge.target ? { selfLoopWidth: SEQ_SELF_MESSAGE_WIDTH } : {}),
          ...(edge.order === undefined ? {} : { order: edge.order }),
          ...(edge.seqY === undefined ? {} : { seqY: edge.seqY, fromX: ax, fromY: ay, toX: bx, toY: by }),
          ...(edge.sourceLabel === undefined ? {} : { sourceLabel: edge.sourceLabel }),
          ...(edge.targetLabel === undefined ? {} : { targetLabel: edge.targetLabel }),
          ...(edge.data === undefined ? {} : { dataJson: JSON.stringify(edge.data) }),
        }, fromSourceId: edge.source, toSourceId: edge.target,
      };
    }),
  ];
  const body = { schemaVersion: 1 as const, artifactId, orgId, sourceRevision,
    diagramKind: model.kind === 'sequence' ? 'sequence' as const : model.kind === 'template' ? 'persona' as const : 'flowchart' as const,
    objects, selectedSourceIds: [] };
  return { ...body, layoutHash: computeRenderedLayoutHash(body) };
}

export { diagramModelFromBoardObjects } from './board-diagram-source';
