import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { Canvas } from 'fabric';
import type { DiagramKind, DiagramModel } from '../src/model';
vi.mock('../src/canvas-io', () => ({ extractModel: vi.fn() }));
import { extractModel } from '../src/canvas-io';
import { FlowNode, FlowEdge } from '../src/fabric-objects';
import { diagramToWhiteboard, canvasToWhiteboard } from '../src/whiteboard-export';

// Derive the closed set from the authoritative type, not a second list.
const source = ts.createSourceFile('model.ts', readFileSync('src/model.ts', 'utf8'), ts.ScriptTarget.Latest);
const kindType = source.statements.find(n => ts.isTypeAliasDeclaration(n) && n.name.text === 'DiagramKind') as ts.TypeAliasDeclaration;
const kinds = (kindType.type as ts.UnionTypeNode).types.map(n => ((n as ts.LiteralTypeNode).literal as ts.StringLiteral).text as DiagramKind);
const fixture = (kind: DiagramKind): DiagramModel => ({
  kind, direction: 'LR', meta: { title: 'Chart', axes: ['days'], sourceRef: 'private-source-id' },
  nodes: [
    { id: 'a', label: 'Actor', shape: 'participant', x: -42, y: 70, width: 100, height: 40, lifelineHeight: 200, data: { value: 5, a1: 0, a2: 2, dates: ['2026-01-01'], nested: { color: 'red' } } },
    { id: 'b', label: 'Class', shape: 'class', x: 120, y: 150, width: 130, height: 60, members: ['+name'], methods: ['+run()'], data: { locked: true } },
  ],
  edges: [{ id: 'a', source: 'a', target: 'b', kind: 'composition', label: 'owns', sourceLabel: '1', targetLabel: '*', seqY: 123, order: 2, data: { cardinality: 'ONLY_ONE' } }],
});

describe('independent editable diagram copy', () => {
  it.each(kinds)('preserves all IR fields for %s without re-layout', kind => {
    const original = fixture(kind);
    const copy = diagramToWhiteboard(original, 'insert-1');
    expect(copy.model).toEqual({ ...original,
      nodes: original.nodes.map(n => ({ ...n, id: copy.nodeIds[n.id] })),
      edges: original.edges.map(e => ({ ...e, id: copy.edgeIds[e.id], source: copy.nodeIds[e.source], target: copy.nodeIds[e.target] })),
    });
    copy.model.nodes[0]!.data!.value = 100;
    copy.model.meta!.title = 'Changed';
    expect(original.nodes[0]!.data!.value).toBe(5);
    expect(original.meta!.title).toBe('Chart');
  });
  it('namespaces independent inserts, stable retry IDs, and moves sequence geometry with the group', () => {
    const model = fixture('sequence');
    const a = diagramToWhiteboard(model, 'first', { x: 20, y: -30 });
    const b = diagramToWhiteboard(model, 'second');
    expect(a.nodeIds).not.toEqual(b.nodeIds);
    expect(a.nodeIds).toEqual(diagramToWhiteboard(model, 'first').nodeIds);
    expect(a.model.nodes[0]!.x).toBe(-22);
    expect(a.model.edges[0]!.seqY).toBe(93);
    expect(a.model.edges[0]!.source).toBe(a.model.nodes[0]!.id);
    expect(a.model.edges[0]!.id).not.toBe(a.model.nodes[0]!.id);
  });
  it('rejects partial or invalid copies instead of dropping data', () => {
    const model = fixture('flowchart');
    model.edges[0]!.target = 'missing';
    expect(() => diagramToWhiteboard(model, 'x')).toThrow('unknown target');
    expect(() => diagramToWhiteboard(fixture('pie'), '')).toThrow('importId');
    const invalid = fixture('pie'); invalid.nodes[0]!.x = NaN;
    expect(() => diagramToWhiteboard(invalid, 'x')).toThrow('geometry');
  });
  it('uses edited world coordinates, ignoring viewport transform', () => {
    const node = Object.assign(Object.create(FlowNode.prototype), { angle: 0, skewX: 0, skewY: 0, scaleX: 1, scaleY: 1 });
    const edge = Object.assign(Object.create(FlowEdge.prototype), { angle: 0, skewX: 0, skewY: 0, scaleX: 1, scaleY: 1 });
    const canvas = { getObjects: () => [node, edge], viewportTransform: [3, 0, 0, 3, 400, -600] } as unknown as Canvas;
    vi.mocked(extractModel).mockReturnValue(fixture('sequence'));
    expect(canvasToWhiteboard(canvas, 'live').model.nodes[0]!.x).toBe(-42);
    node.scaleX = 2;
    expect(() => canvasToWhiteboard(canvas, 'live')).toThrow('transform');
  });
  it('rejects arbitrary Fabric objects', () => {
    const canvas = { getObjects: () => [{ type: 'image' }] } as unknown as Canvas;
    expect(() => canvasToWhiteboard(canvas, 'live')).toThrow('Unsupported Fabric');
  });
});
