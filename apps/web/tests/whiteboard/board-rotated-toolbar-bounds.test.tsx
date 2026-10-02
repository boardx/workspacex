import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { canonicalSceneBounds, createWhiteboardDocument, executeCommands, readObjects, type WhiteboardObject } from '@repo/whiteboard-core';
import { CollaborativeEditor } from '@/components/whiteboard/collaborative-editor';
import { useBoardToolbarPosition } from '@/components/whiteboard/use-board-toolbar-position';
import type { BoardFabricSurfaceProps } from '@/components/whiteboard/fabric/board-fabric-surface';

const harness = vi.hoisted(() => ({ props: null as BoardFabricSurfaceProps | null }));
vi.mock('@/components/whiteboard/board-comments', () => ({ listBoardMentionableMembers: async () => [], listBoardCommentThreads: async () => [] }));
vi.mock('@/components/whiteboard/fabric/board-fabric-surface', () => ({ BoardFabricSurface: (props: BoardFabricSurfaceProps) => { harness.props = props; return <div />; } }));
vi.mock('@/components/whiteboard/use-board-toolbar-position', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/whiteboard/use-board-toolbar-position')>();
  return { ...actual, useBoardToolbarPosition: vi.fn(actual.useBoardToolbarPosition) };
});
globalThis.ResizeObserver = class { observe() {} disconnect() {} } as unknown as typeof ResizeObserver;
afterEach(() => { cleanup(); harness.props = null; vi.clearAllMocks(); });

function entity(id: string, rotation: number): WhiteboardObject {
  return { id, schemaVersion: 1, kind: 'rectangle', geometry: { x: id === 'a' ? 400 : 650, y: 350, width: 120, height: 80, rotation }, text: id, style: {}, parentId: null, orderKey: id };
}
function union(objects: WhiteboardObject[]) {
  const bounds = objects.map(object => canonicalSceneBounds(object.geometry));
  const x = Math.min(...bounds.map(bound => bound.left)), y = Math.min(...bounds.map(bound => bound.top));
  return { x, y, width: Math.max(...bounds.map(bound => bound.right)) - x, height: Math.max(...bounds.map(bound => bound.bottom)) - y };
}

it.each([30, 90])('uses rotated entity bounds for single and mixed-child menus during %s-degree held preview', rotation => {
  const doc = createWhiteboardDocument();
  const objects = [entity('a', 0), entity('b', -30)];
  executeCommands(doc, objects.map(object => ({ type: 'create' as const, object })), 'seed');
  render(<CollaborativeEditor boardId="rotated-menu" clientId="menu-client" doc={doc} readOnly={false} title="Board" status="Connected" />);
  const canonical = readObjects(doc);
  try {
    act(() => harness.props!.onSelectionChange(['a'], 'canvas'));
    const preview = { ...objects[0]!, geometry: { ...objects[0]!.geometry, rotation } };
    act(() => harness.props!.onTransformPreview?.([{ id: 'a', geometry: preview.geometry }]));
    const calls = vi.mocked(useBoardToolbarPosition).mock.calls.slice(-2);
    expect(calls[0]![0]).toEqual(union([preview]));
    expect(calls[1]![0]).toEqual(union([preview]));
    act(() => harness.props!.onSelectionChange(['a', 'b'], 'canvas'));
    expect(vi.mocked(useBoardToolbarPosition).mock.calls.at(-2)![0]).toEqual(union([preview, objects[1]!]));
    expect(readObjects(doc)).toEqual(canonical);
    act(() => harness.props!.onTransformPreview?.([]));
    expect(vi.mocked(useBoardToolbarPosition).mock.calls.at(-2)![0]).toEqual(union(objects));
  } finally { cleanup(); doc.destroy(); }
});
