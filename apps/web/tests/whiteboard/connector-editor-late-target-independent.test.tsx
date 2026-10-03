import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument, executeCommands, SpatialRelationshipCommandPort, type WhiteboardObject } from '@repo/whiteboard-core';
import { CollaborativeEditor } from '@/components/whiteboard/collaborative-editor';
const harness = vi.hoisted(() => ({ handles: null as any }));
vi.mock('@/components/whiteboard/board-comments', () => ({ listBoardMentionableMembers: async () => [], listBoardCommentThreads: async () => [] }));
vi.mock('@/components/whiteboard/fabric/board-fabric-surface', () => ({ BoardFabricSurface: ({ onSelectionChange }: any) => <div data-testid="board-fabric-surface"><button onClick={() => onSelectionChange(['edge'], 'canvas')}>select edge</button></div> }));
vi.mock('@/components/whiteboard/board-connector-handles', () => ({ BoardConnectorHandles: (props: any) => { harness.handles = props; return <div />; } }));
globalThis.ResizeObserver = class { observe() {} disconnect() {} } as unknown as typeof ResizeObserver;
afterEach(() => { cleanup(); harness.handles = null; vi.restoreAllMocks(); });

it.each(['edge-locked', 'old-target-locked', 'old-target-deleted', 'new-target-locked', 'new-target-hidden', 'new-target-deleted', 'revoked', 'left-candidate', 'bypassed-candidate'] as const)('preserves late target authority for %s through the actual editor port', scenario => {
  const doc = createWhiteboardDocument();
  const node = (id: string, x: number): WhiteboardObject => ({ id, schemaVersion: 1, kind: 'sticky', geometry: { x, y: 0, width: 100, height: 80, rotation: 0 }, text: '', style: {}, parentId: null, orderKey: id });
  executeCommands(doc, [{ type: 'create', object: node('a', 0) }, { type: 'create', object: node('b', 300) }, { type: 'create', object: node('c', 500) }, { type: 'create', object: { ...node('edge', 100), kind: 'connector', connector: { from: 'a', to: 'b', fromAnchor: 'right', toAnchor: 'left', type: 'straight', label: 'original' } } }], 'fixture');
  const dispatch = vi.spyOn(SpatialRelationshipCommandPort.prototype, 'dispatch');
  const target = document.createElement('button'); target.setPointerCapture = vi.fn(); target.hasPointerCapture = () => false;
  const event = (x: number, y: number) => ({ currentTarget: target, pointerId: 1, button: 0, clientX: x, clientY: y, metaKey: false, ctrlKey: false, preventDefault() {}, stopPropagation() {} });
  const props = { boardId: 'authority-board', clientId: 'authority-client', doc, readOnly: false, title: 'Board', status: 'Connected' };
  try {
    const view = render(<CollaborativeEditor {...props} />);
    fireEvent.click(screen.getByText('select edge'));
    act(() => harness.handles.onPointerDown('to', null, event(300, 40)));
    act(() => harness.handles.onPointerMove(event(500, 40)));
    expect(harness.handles.relationship.to).toBe('c');
    const finalEvent = scenario === 'left-candidate' ? event(700, 200) : scenario === 'bypassed-candidate' ? { ...event(500, 40), ctrlKey: true } : event(500, 40);
    if (scenario === 'left-candidate' || scenario === 'bypassed-candidate') {
      act(() => harness.handles.onPointerMove(finalEvent));
      expect(harness.handles.relationship.to).toBeUndefined();
    }
    const release = harness.handles.onPointerUp;
    if (scenario === 'revoked') view.rerender(<CollaborativeEditor {...props} readOnly />);
    let latest: Uint8Array;
    act(() => {
      if (scenario === 'edge-locked') executeCommands(doc, [{ type: 'state', id: 'edge', locked: true }], 'remote');
      if (scenario === 'old-target-locked') executeCommands(doc, [{ type: 'state', id: 'b', locked: true }], 'remote');
      if (scenario === 'old-target-deleted') executeCommands(doc, [{ type: 'delete', id: 'b' }], 'remote');
      if (scenario === 'new-target-locked') executeCommands(doc, [{ type: 'state', id: 'c', locked: true }], 'remote');
      if (scenario === 'new-target-hidden') executeCommands(doc, [{ type: 'state', id: 'c', hidden: true }], 'remote');
      if (scenario === 'new-target-deleted') executeCommands(doc, [{ type: 'delete', id: 'c' }], 'remote');
      if (scenario === 'left-candidate' || scenario === 'bypassed-candidate') executeCommands(doc, [{ type: 'state', id: 'c', locked: true }], 'remote');
      latest = Y.encodeStateAsUpdate(doc);
      release(finalEvent);
    });
    if (scenario === 'left-candidate' || scenario === 'bypassed-candidate') {
      expect(dispatch).toHaveBeenCalledOnce();
      expect(dispatch.mock.calls[0]![0].command).toMatchObject({ type: 'update-connector', relationship: { toPoint: { x: finalEvent.clientX, y: finalEvent.clientY } } });
      expect(Y.encodeStateAsUpdate(doc)).not.toEqual(latest!);
    } else {
      expect(dispatch).not.toHaveBeenCalled();
      expect(Y.encodeStateAsUpdate(doc)).toEqual(latest!);
    }
    expect(harness.handles.active).toBe(false);
    if (scenario === 'new-target-locked' || scenario === 'new-target-hidden' || scenario === 'new-target-deleted') {
      expect(harness.handles.snapCandidate).toBeNull();
      expect(harness.handles.relationship.to).toBe('b');
      expect(harness.handles.path.end).toEqual({ x: 300, y: 40 });
    }
  } finally { cleanup(); doc.destroy(); }
});
