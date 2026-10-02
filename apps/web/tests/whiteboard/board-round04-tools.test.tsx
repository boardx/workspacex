import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createWhiteboardDocument, readObjects, WhiteboardCommandOrigin } from '@repo/whiteboard-core';
import { CollaborativeEditor } from '@/components/whiteboard/collaborative-editor';
import type { BoardFabricSurfaceProps } from '@/components/whiteboard/fabric/board-fabric-surface';

const harness = vi.hoisted(() => ({ props: null as BoardFabricSurfaceProps | null }));
vi.mock('@/components/whiteboard/board-comments', () => ({ listBoardMentionableMembers: async () => [], listBoardCommentThreads: async () => [] }));
vi.mock('@/components/whiteboard/fabric/board-fabric-surface', () => ({ BoardFabricSurface: (props: BoardFabricSurfaceProps) => { harness.props = props; return <div />; } }));
globalThis.ResizeObserver = class { observe() {} disconnect() {} } as unknown as typeof ResizeObserver;
afterEach(() => { cleanup(); harness.props = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mount() {
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor boardId="round04" clientId="tools-client" doc={doc} readOnly={false} title="Board" status="Connected" />);
  return doc;
}
it.each(['sticky', 'text', 'shape'])('arms %s without creating, creates once and clears the tool', kind => {
  const doc = mount();
  try {
    fireEvent.click(screen.getByTestId(`board-add-${kind}`));
    expect(readObjects(doc)).toHaveLength(0);
    act(() => harness.props!.onCanvasClick?.({ x: 400, y: 350 }));
    expect(readObjects(doc)).toHaveLength(1);
    expect(screen.getByTestId('board-tool-select')).toHaveAttribute('aria-pressed', 'true');
    act(() => harness.props!.onCanvasClick?.({ x: 500, y: 400 }));
    expect(readObjects(doc)).toHaveLength(1);
  } finally { cleanup(); doc.destroy(); }
});
it('keeps Frame data but removes its creation entry and shortcut', () => {
  const doc = mount();
  try {
    expect(screen.queryByTestId('board-add-frame')).toBeNull();
    fireEvent.keyDown(window, { key: 'f' });
    act(() => harness.props!.onCanvasClick?.({ x: 400, y: 350 }));
    expect(readObjects(doc)).toHaveLength(0);
  } finally { cleanup(); doc.destroy(); }
});
it('previews real colors, shapes and typography with submenu cues', () => {
  const doc = mount();
  try {
    for (const kind of ['sticky', 'text', 'shape', 'draw', 'more']) expect(screen.getByTestId(`board-add-${kind}-submenu`)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('board-add-sticky'));
    fireEvent.click(screen.getByTestId('board-sticky-default-blue'));
    fireEvent.click(screen.getByTestId('board-sticky-circle'));
    expect(screen.getByTestId('board-add-sticky').querySelector('[data-sticky-variant="circle"]')).toBeInTheDocument();
    expect(screen.getByTestId('board-sticky-square').querySelector('[data-sticky-variant="square"]')).toHaveStyle({ backgroundColor: '#C6DDFF' });
    fireEvent.click(screen.getByTestId('board-add-text'));
    expect(parseFloat(screen.getByTestId('board-text-title').style.fontSize)).toBeGreaterThan(parseFloat(screen.getByTestId('board-text-body').style.fontSize));
    fireEvent.click(screen.getByTestId('board-add-shape'));
    expect(screen.getByTestId('board-shape-circle').querySelector('svg circle')).toBeInTheDocument();
    expect(readObjects(doc)).toHaveLength(0);
  } finally { cleanup(); doc.destroy(); }
});

it('native tool drags encode one tool and the drop creates once at its scene point', () => {
  const doc = mount();
  const origins: WhiteboardCommandOrigin[] = [];
  doc.on('afterTransaction', transaction => { if (transaction.origin instanceof WhiteboardCommandOrigin) origins.push(transaction.origin); });
  try {
    const data = new Map<string, string>();
    const transfer = { setData: (type: string, value: string) => data.set(type, value), effectAllowed: '' };
    fireEvent.dragStart(screen.getByTestId('board-add-shape'), { dataTransfer: transfer });
    expect(JSON.parse(data.get('application/x-workspacex-board-tool')!)).toEqual({ kind: 'shape', variant: 'rounded-rectangle' });
    expect(readObjects(doc)).toHaveLength(0);
    act(() => harness.props!.onToolDrop?.({ x: 600, y: 420 }, data.get('application/x-workspacex-board-tool')!));
    expect(readObjects(doc)).toHaveLength(1);
    expect(readObjects(doc)[0]!.geometry).toMatchObject({ x: 490, y: 345, width: 220, height: 150 });
    expect(origins).toHaveLength(1);
    expect(screen.getByTestId('board-tool-select')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.dragStart(screen.getByTestId('board-add-text'), { dataTransfer: transfer });
    expect(readObjects(doc)).toHaveLength(1);
    fireEvent.dragEnd(screen.getByTestId('board-add-text'), { dataTransfer: transfer });
    expect(readObjects(doc)).toHaveLength(1);
    expect(origins).toHaveLength(1);
  } finally { cleanup(); doc.destroy(); }
});

it.each([{ viewport: 1440, dockLeft: 420, triggerLeft: 650, width: 420, left: 50 }, { viewport: 390, dockLeft: 16, triggerLeft: 150, width: 358, left: 0 }])('anchors the picker above its trigger within a $viewport px viewport', ({ viewport, dockLeft, triggerLeft, width, left }) => {
  vi.stubGlobal('innerWidth', viewport);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const x = this.dataset.testid === 'board-creation-dock' ? dockLeft : triggerLeft;
    return { left: x, top: 800, width: 60, height: 60, x, y: 800, right: x + 60, bottom: 860, toJSON() {} };
  });
  const doc = mount();
  try {
    fireEvent.click(screen.getByTestId('board-add-shape'));
    expect(screen.getByTestId('board-tool-picker')).toHaveStyle({ left: `${left}px`, width: `${width}px`, bottom: '100%', marginBottom: '16px' });
    expect(readObjects(doc)).toHaveLength(0);
    fireEvent.keyDown(window, { key: 'Escape' });
    act(() => harness.props!.onCanvasClick?.({ x: 400, y: 350 }));
    expect(readObjects(doc)).toHaveLength(0);
  } finally { cleanup(); doc.destroy(); }
});
