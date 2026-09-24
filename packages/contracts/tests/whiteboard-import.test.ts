import { describe, expect, it } from 'vitest';
import { DiagramImportBundle, ImportDiagramInput } from '../src/whiteboard-import';
import * as contracts from '../src/index';

const bundle = {
  schemaVersion: 1,
  converterVersion: 'diagram-copy/1',
  groupId: 'diagram:source',
  payloadReferenceSpace: 'source-local',
  nodeIds: { source: 'diagram:source:node:0' },
  edgeIds: {},
  diagnostics: [],
  model: {
    kind: 'flowchart',
    direction: 'LR',
    nodes: [{
      id: 'diagram:source:node:0', label: 'Start', shape: 'rect',
      x: 10, y: 20, width: 120, height: 60,
    }],
    edges: [],
  },
} as const;

describe('whiteboard diagram import contract', () => {
  it('is available through the namespaced package entry and accepts a strict import', () => {
    expect(contracts.whiteboardImport.DiagramImportBundle.parse(bundle)).toEqual(bundle);
    expect(ImportDiagramInput.parse({
      requestId: 'c6072f71-7f41-45f4-b228-f47f709e9819',
      acceptedLosses: [],
      sourceRef: { threadId: 'thread', messageId: 'message', blockId: 'block', kind: 'mermaid' },
      bundle,
    }).bundle).toEqual(bundle);
  });

  it('rejects unknown fields and non-finite geometry at the boundary', () => {
    expect(DiagramImportBundle.safeParse({ ...bundle, unexpected: true }).success).toBe(false);
    expect(DiagramImportBundle.safeParse({
      ...bundle,
      model: { ...bundle.model, nodes: [{ ...bundle.model.nodes[0], x: Number.NaN }] },
    }).success).toBe(false);
  });
});
