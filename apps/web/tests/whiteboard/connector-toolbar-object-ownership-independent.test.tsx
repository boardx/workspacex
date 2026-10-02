import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument, executeCommands, readObjects, SpatialRelationshipCommandPort, type WhiteboardObject } from '@repo/whiteboard-core';
import { CollaborativeEditor } from '@/components/whiteboard/collaborative-editor';

vi.mock('@/components/whiteboard/board-comments', () => ({ listBoardMentionableMembers: async () => [], listBoardCommentThreads: async () => [] }));
vi.mock('@/components/whiteboard/fabric/board-fabric-surface', () => ({ BoardFabricSurface: ({ onSelectionChange }: { onSelectionChange: (ids: string[], source: 'canvas') => void }) => <div data-testid="board-fabric-surface">{['edge-a', 'edge-b'].map(id => <button key={id} onClick={() => onSelectionChange([id], 'canvas')}>{id}</button>)}</div> }));
globalThis.ResizeObserver = class { observe() {} disconnect() {} } as unknown as typeof ResizeObserver;
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('keeps an unsaved label draft owned by the selected edge rather than carrying it to another edge with the same label', () => {
  const doc = createWhiteboardDocument();
  const node = (id: string, x: number): WhiteboardObject => ({ id, schemaVersion: 1, kind: 'sticky', geometry: { x, y: 0, width: 100, height: 80, rotation: 0 }, text: '', style: {}, parentId: null, orderKey: id });
  const edge = (id: string): WhiteboardObject => ({ ...node(id, 100), kind: 'connector', connector: { from: 'a', to: 'b', fromAnchor: 'right', toAnchor: 'left', type: 'straight', label: 'same label' } });
  executeCommands(doc, [{ type: 'create', object: node('a', 0) }, { type: 'create', object: node('b', 300) }, { type: 'create', object: edge('edge-a') }, { type: 'create', object: edge('edge-b') }], 'fixture');
  const dispatch = vi.spyOn(SpatialRelationshipCommandPort.prototype, 'dispatch');
  const before = Y.encodeStateAsUpdate(doc);
  try {
    render(<CollaborativeEditor boardId="ownership-board" clientId="ownership-client" doc={doc} readOnly={false} title="Board" status="Connected" />);
    fireEvent.click(screen.getByText('edge-a'));
    fireEvent.click(screen.getByTestId('board-connector-label-open'));
    fireEvent.change(screen.getByTestId('board-connector-label'), { target: { value: 'A private draft\n中文' } });
    fireEvent.click(screen.getByText('edge-b'));
    fireEvent.click(screen.getByTestId('board-connector-label-open'));
    expect(screen.getByTestId('board-connector-label')).toHaveValue('same label');
    expect(screen.getByTestId('board-connector-label-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('board-connector-label-save'));
    expect(dispatch).not.toHaveBeenCalled();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(readObjects(doc).filter(object => object.kind === 'connector').map(object => object.connector!.label)).toEqual(['same label', 'same label']);
  } finally { cleanup(); doc.destroy(); }
});
