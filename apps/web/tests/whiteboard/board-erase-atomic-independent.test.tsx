import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createWhiteboardDocument, executeCommands, readObjects, WhiteboardCommandOrigin, type WhiteboardObject } from '@repo/whiteboard-core';
import { CollaborativeEditor } from '@/components/whiteboard/collaborative-editor';
import { drawingEraserTargets } from '@/components/whiteboard/fabric/drawing-hit-test';
import type { BoardFabricObject } from '@/components/whiteboard/fabric/board-fabric-object';

const harness = vi.hoisted(() => ({ complete: null as null | ((value: unknown) => void), objects: [] as BoardFabricObject[] }));
vi.mock('@/components/whiteboard/board-comments', () => ({ listBoardMentionableMembers: async () => [], listBoardCommentThreads: async () => [] }));
vi.mock('@/components/whiteboard/fabric/board-fabric-surface', () => ({ BoardFabricSurface: ({ onDrawingComplete, objects }: any) => {
  harness.complete = onDrawingComplete;
  harness.objects = objects;
  return <div data-testid="board-fabric-surface" />;
} }));
globalThis.ResizeObserver = class { observe() {} disconnect() {} } as unknown as typeof ResizeObserver;
afterEach(() => { cleanup(); harness.complete = null; vi.restoreAllMocks(); });

function ink(id: string, y = 0): WhiteboardObject {
  return { id, schemaVersion: 1, kind: 'drawing', geometry: { x: 0, y, width: 100, height: 20, rotation: 0 }, text: '', style: {}, parentId: null, orderKey: id,
    extensionData: { contentObject: { version: 1, type: 'drawing', strokes: [{ id: `${id}-pen`, tool: 'pen', color: '#111111', width: 4, opacity: 1, points: [{ x: 0, y: 0, pressure: 1 }, { x: 100, y: 20, pressure: 1 }] }] } } };
}
function erase(points = [{ x: 50, y: -30, pressure: 1 }, { x: 50, y: 130, pressure: 1 }]) {
  act(() => harness.complete!({ tool: 'eraser', points, targetObjectIds: drawingEraserTargets(harness.objects, points, 24) }));
}
function mount(objects: WhiteboardObject[]) {
  const doc = createWhiteboardDocument();
  executeCommands(doc, objects.map(object => ({ type: 'create' as const, object })), 'fixture');
  render(<CollaborativeEditor boardId="erase-independent" clientId="erase-client" doc={doc} readOnly={false} title="Board" status="Connected" />);
  return doc;
}

it('erases all intersected drawings without selection as one transaction and restores both with one Undo/Redo', () => {
  const doc = mount([ink('a'), ink('b', 70)]);
  const before = readObjects(doc);
  const transactions: unknown[] = [];
  doc.on('afterTransaction', transaction => { if (transaction.origin instanceof WhiteboardCommandOrigin) transactions.push(transaction); });
  try {
    erase();
    const after = readObjects(doc);
    expect(after).not.toEqual(before);
    for (const object of after) expect((object.extensionData!.contentObject as any).strokes).toHaveLength(2);
    expect(transactions).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(readObjects(doc)).toEqual(before);
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(readObjects(doc)).toEqual(after);
  } finally { cleanup(); doc.destroy(); }
});

it('does not modify Sticky, Shape, Image, locked or hidden drawings and commits nothing for empty hits', () => {
  const normal = ink('normal');
  const protectedObjects: WhiteboardObject[] = [
    { ...ink('locked'), locked: true }, { ...ink('hidden'), hidden: true },
    ...(['sticky', 'rectangle', 'image'] as const).map(kind => ({ ...ink(kind), kind, extensionData: {} })),
  ];
  const doc = mount([normal, ...protectedObjects]);
  const before = readObjects(doc);
  const transactions: unknown[] = [];
  doc.on('afterTransaction', transaction => { if (transaction.origin instanceof WhiteboardCommandOrigin) transactions.push(transaction); });
  try {
    erase([{ x: 500, y: 500, pressure: 1 }, { x: 600, y: 600, pressure: 1 }]);
    expect(readObjects(doc)).toEqual(before);
    expect(transactions).toHaveLength(0);
    erase();
    expect(transactions).toHaveLength(1);
    for (const object of before.filter(object => object.id !== 'normal')) expect(readObjects(doc).find(item => item.id === object.id)).toEqual(object);
  } finally { cleanup(); doc.destroy(); }
});

it('maps eraser strokes into scaled and rotated drawing space', () => {
  const object = { ...ink('rotated'), geometry: { x: 100, y: 100, width: 200, height: 40, rotation: 90 } };
  const doc = mount([object]);
  const before = readObjects(doc);
  try {
    erase([{ x: 78, y: 200, pressure: 1 }, { x: 82, y: 200, pressure: 1 }]);
    const after = readObjects(doc)[0]!;
    expect((after.extensionData!.contentObject as any).strokes).toHaveLength(2);
    expect(after.geometry).toEqual(before[0]!.geometry);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(readObjects(doc)).toEqual(before);
  } finally { cleanup(); doc.destroy(); }
});
