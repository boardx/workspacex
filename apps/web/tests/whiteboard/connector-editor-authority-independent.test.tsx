import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument, executeCommands, readObjects, SpatialRelationshipCommandPort, type WhiteboardObject } from '@repo/whiteboard-core';
import { CollaborativeEditor } from '@/components/whiteboard/collaborative-editor';

const harness = vi.hoisted(() => ({ handles: null as any, projected: [] as any[] }));
vi.mock('@/components/whiteboard/board-comments', () => ({ listBoardMentionableMembers: async () => [], listBoardCommentThreads: async () => [] }));
vi.mock('@/components/whiteboard/fabric/board-fabric-surface', () => ({ BoardFabricSurface: ({ onSelectionChange, objects }: any) => { harness.projected = objects; return <div data-testid="board-fabric-surface"><button onClick={() => onSelectionChange(['edge'], 'canvas')}>select edge</button></div>; } }));
vi.mock('@/components/whiteboard/board-connector-handles', () => ({ BoardConnectorHandles: (props: any) => { harness.handles = props; return <div />; } }));
class ResizeObserverMock { observe() {} disconnect() {} }
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
afterEach(() => { cleanup(); harness.handles = null; harness.projected = []; vi.restoreAllMocks(); });

it.each(['label', 'width', 'target-locked', 'accepted'] as const)('actual editor spatial wiring guards a late %s transaction without a React rerender', change => {
  const doc = createWhiteboardDocument();
  const node = (id: string, x: number): WhiteboardObject => ({ id, schemaVersion: 1, kind: 'sticky', geometry: { x, y: 0, width: 100, height: 80, rotation: 0 }, text: '', style: {}, parentId: null, orderKey: id });
  executeCommands(doc, [{ type: 'create', object: node('a', 0) }, { type: 'create', object: node('b', 300) }, { type: 'create', object: { ...node('edge', 100), kind: 'connector', connector: { from: 'a', to: 'b', fromAnchor: 'right', toAnchor: 'left', type: 'curve', route: { kind: 'curve', startOffset: { x: 20, y: 30 }, endOffset: { x: -20, y: -30 } }, label: 'original' } } }], 'fixture');
  const dispatch = vi.spyOn(SpatialRelationshipCommandPort.prototype, 'dispatch');
  const target = document.createElement('button');
  target.setPointerCapture = vi.fn(); target.hasPointerCapture = () => false;
  const event = (x: number, y: number) => ({ currentTarget: target, pointerId: 1, button: 0, clientX: x, clientY: y, metaKey: false, ctrlKey: false, preventDefault() {}, stopPropagation() {} });
  try {
    render(<CollaborativeEditor boardId="authority-board" clientId="authority-client" doc={doc} readOnly={false} title="Board" status="Connected" />);
    fireEvent.click(screen.getByText('select edge'));
    act(() => harness.handles.onPointerDown('route', 'curve-start', event(120, 70)));
    act(() => harness.handles.onPointerMove(event(150, 110)));
    const release = harness.handles.onPointerUp;
    let latest: Uint8Array;
    // Keep both operations in one act: React cannot publish new props between them.
    act(() => {
      const edge = readObjects(doc).find(item => item.id === 'edge')!;
      if (change === 'target-locked') executeCommands(doc, [{ type: 'state', id: 'a', locked: true }], 'remote');
      if (change === 'label' || change === 'width') executeCommands(doc, [{ type: 'connector', id: 'edge', connector: { ...edge.connector!, ...(change === 'label' ? { label: 'remote' } : { strokeWidth: 9 }) } }], 'remote');
      latest = Y.encodeStateAsUpdate(doc);
      release(event(150, 110));
    });
    if (change === 'accepted') {
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch.mock.calls[0]![0].preconditions).toEqual(expect.arrayContaining([{ id: 'a', locked: false }, { id: 'b', locked: false }, expect.objectContaining({ id: 'edge', connector: expect.objectContaining({ label: 'original' }) })]));
      expect(readObjects(doc).find(item => item.id === 'edge')!.connector!.route).not.toEqual({ kind: 'curve', startOffset: { x: 20, y: 30 }, endOffset: { x: -20, y: -30 } });
    } else {
      expect(dispatch).not.toHaveBeenCalled();
      expect(Y.encodeStateAsUpdate(doc)).toEqual(latest!);
    }
  } finally { cleanup(); doc.destroy(); }
});

it.each(['from', 'to'] as const)('held %s detachment clears the old binding in Surface projection and cancels or commits atomically', side => {
  const doc = createWhiteboardDocument();
  const node = (id: string, x: number): WhiteboardObject => ({ id, schemaVersion: 1, kind: 'sticky', geometry: { x, y: 0, width: 100, height: 80, rotation: 0 }, text: '', style: {}, parentId: null, orderKey: id });
  executeCommands(doc, [{ type: 'create', object: node('a', 0) }, { type: 'create', object: node('b', 300) }, { type: 'create', object: { ...node('edge', 100), kind: 'connector', connector: { from: 'a', to: 'b', fromAnchor: 'right', toAnchor: 'left', type: 'curve', route: { kind: 'curve', startOffset: { x: 20, y: 30 }, endOffset: { x: -20, y: -30 } }, label: 'original' } } }], 'fixture');
  const dispatch = vi.spyOn(SpatialRelationshipCommandPort.prototype, 'dispatch');
  const target = document.createElement('button'); target.setPointerCapture = vi.fn(); target.hasPointerCapture = () => false;
  const event = (x: number, y: number) => ({ currentTarget: target, pointerId: 1, button: 0, clientX: x, clientY: y, metaKey: false, ctrlKey: false, preventDefault() {}, stopPropagation() {} });
  try {
    render(<CollaborativeEditor boardId="authority-board" clientId="authority-client" doc={doc} readOnly={false} title="Board" status="Connected" />);
    fireEvent.click(screen.getByText('select edge'));
    const before = Y.encodeStateAsUpdate(doc);
    const held = () => {
      act(() => harness.handles.onPointerDown(side, null, event(side === 'from' ? 100 : 300, 40)));
      expect(document.activeElement).toBe(screen.getByTestId('collaborative-editor'));
      act(() => harness.handles.onPointerMove(event(650, 250)));
      const projected = harness.projected.find(item => item.id === 'edge')!;
      expect(projected.connector).not.toHaveProperty(side);
      expect(projected.connector[`${side}Point`]).toEqual(harness.handles.path[side === 'from' ? 'start' : 'end']);
      expect(projected.connector[side === 'from' ? 'to' : 'from']).toBe(side === 'from' ? 'b' : 'a');
      expect(projected.connector[side === 'from' ? 'start' : 'end']).toEqual(harness.handles.path[side === 'from' ? 'start' : 'end']);
      expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
      expect(dispatch).not.toHaveBeenCalled();
    };
    held();
    act(() => harness.handles.onPointerCancel());
    expect(harness.projected.find(item => item.id === 'edge')!.connector[side]).toBe(side === 'from' ? 'a' : 'b');
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    held();
    act(() => harness.handles.onPointerUp(event(650, 250)));
    expect(dispatch).toHaveBeenCalledTimes(1);
    const canonical = readObjects(doc).find(item => item.id === 'edge')!;
    expect(canonical.connector).not.toHaveProperty(side);
    expect(canonical.connector).toHaveProperty(`${side}Point`);
  } finally { cleanup(); doc.destroy(); }
});
