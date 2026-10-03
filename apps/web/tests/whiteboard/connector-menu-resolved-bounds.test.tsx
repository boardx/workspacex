import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument, executeCommands, readObjects, type WhiteboardObject } from '@repo/whiteboard-core';
import { CollaborativeThinkingEditor } from '@/components/whiteboard/collaborative-thinking-editor';
import { connectorRelationshipFromObject, connectorResolvedPath } from '@/components/whiteboard/connector-gesture';
import { boardToolbarPosition } from '@/components/whiteboard/use-board-toolbar-position';
import type { BoardViewport } from '@/components/whiteboard/fabric/board-fabric-object';

let camera: BoardViewport;
vi.mock('@/components/whiteboard/board-comments', () => ({ listBoardMentionableMembers: async () => [], listBoardCommentThreads: async () => [] }));
vi.mock('@/components/whiteboard/fabric/board-fabric-surface', () => ({ BoardFabricSurface: ({ onSelectionChange, onViewportChange }: { onSelectionChange: (ids: string[], source: 'canvas') => void; onViewportChange: (viewport: BoardViewport) => void }) => <><button onClick={() => onSelectionChange(['edge'], 'canvas')}>select edge</button><button onClick={() => onViewportChange(camera)}>camera</button></> }));
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); camera = { zoom: 1, panX: 0, panY: 0, fitRequest: 0 }; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('anchors the mounted Connector menu to its resolved route, not zero canonical geometry, and follows camera and node changes', () => {
  const doc = createWhiteboardDocument();
  const node = (id: string, x: number): WhiteboardObject => ({ id, schemaVersion: 1, kind: 'sticky', geometry: { x, y: 420, width: 100, height: 80, rotation: 0 }, text: '', style: {}, parentId: null, orderKey: id });
  const edge: WhiteboardObject = { ...node('edge', 0), kind: 'connector', geometry: { x: 0, y: 0, width: 1, height: 1, rotation: 0 }, connector: { from: 'a', to: 'b', fromAnchor: 'right', toAnchor: 'left', type: 'straight', endStyle: 'arrow' } };
  executeCommands(doc, [{ type: 'create', object: node('a', 300) }, { type: 'create', object: node('b', 600) }, { type: 'create', object: edge }], 'fixture');
  try {
    render(<CollaborativeThinkingEditor boardId="menu-board" clientId="menu-client" doc={doc} readOnly={false} title="Board" status="已连接" />);
    const assertPlacement = () => {
      const path = connectorResolvedPath(connectorRelationshipFromObject(edge)!, readObjects(doc))!;
      const expected = boardToolbarPosition(path.bounds, camera, { width: 1024, height: 768 }, { width: 640, height: 54 });
      const menu = screen.getByTestId('board-context-toolbar');
      expect(menu.style.left).toBe(`${expected.left}px`);
      expect(menu.style.top).toBe(`${expected.top}px`);
      expect(Number(expected.top) + 54).toBeLessThan(path.bounds.y * camera.zoom + camera.panY);
    };
    const before = Y.encodeStateAsUpdate(doc);
    fireEvent.click(screen.getByText('select edge')); assertPlacement();
    camera = { zoom: 1.1, panX: -30, panY: -40, fitRequest: 0 };
    fireEvent.click(screen.getByText('camera')); assertPlacement();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    act(() => { executeCommands(doc, [{ type: 'geometry', id: 'b', geometry: { ...node('b', 650).geometry, y: 460 } }], 'remote'); });
    const afterRemote = Y.encodeStateAsUpdate(doc);
    fireEvent.click(screen.getByText('camera')); assertPlacement();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(afterRemote);
  } finally { cleanup(); doc.destroy(); }
});
