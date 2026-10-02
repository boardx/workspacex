import {useState} from 'react';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {BoardBottomDock, type BoardCreationTool} from '@/components/whiteboard/board-bottom-dock';
import {createWhiteboardDocument, readObjects} from '@repo/whiteboard-core';
import {CollaborativeEditor} from '@/components/whiteboard/collaborative-editor';

vi.mock('@/components/whiteboard/fabric/board-fabric-surface', () => ({
  BoardFabricSurface: ({onCanvasClick}: {onCanvasClick?: (point: {x: number; y: number}) => void}) =>
    <div data-testid="board-fabric-surface"><canvas/><button data-testid="pointer-test-canvas" onClick={() => onCanvasClick?.({x: 100, y: 120})}>canvas</button></div>,
}));

const quickCreate = vi.fn();
beforeEach(() => {vi.stubGlobal('ResizeObserver', class {observe() {} disconnect() {}});});
afterEach(() => {cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals();});
function Controlled({readOnly = false}: {readOnly?: boolean}) {
  const [creationTool, setCreationTool] = useState<BoardCreationTool>(null);
  return <BoardBottomDock activeTool="select" creationTool={creationTool} readOnly={readOnly}
    onToolChange={vi.fn()} onCreationToolChange={setCreationTool} onQuickCreate={quickCreate}
    onBulkSticky={vi.fn()} onImageRequest={vi.fn()}/>;
}
// Synthetic component lifecycle evidence only; trusted browser input is a separate gate.
function pointer(target: Element, type: string, id = 7, buttons = 1) {
  const event = new MouseEvent(type, {bubbles: true, buttons});
  Object.defineProperties(event, {pointerId: {value: id}, pointerType: {value: 'touch'}});
  fireEvent(target, event);
}

for (const kind of ['sticky', 'text', 'shape'] as const) {
  for (const cancelled of ['pointercancel', 'lostpointercapture']) {
    it(`${cancelled} while held disarms ${kind} without quick creation`, () => {
      render(<Controlled/>);
      const source = screen.getByTestId(`board-add-${kind}`);
      fireEvent.click(source);
      pointer(source, 'pointerdown');
      pointer(source, cancelled);
      expect(source).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByTestId('board-tool-select')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByTestId('board-tool-picker')).toBeNull();
      expect(quickCreate).not.toHaveBeenCalled();
    });
  }
}

it('normal touch up and implicit capture release preserve click and picker', () => {
  render(<Controlled/>);
  const source = screen.getByTestId('board-add-sticky');
  fireEvent.click(source);
  pointer(source, 'pointerdown');
  pointer(source, 'pointerup', 7, 0);
  pointer(source, 'lostpointercapture', 7, 0);
  fireEvent.click(source);
  expect(source).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('board-tool-picker')).toBeVisible();
  expect(quickCreate).not.toHaveBeenCalled();
});

it('a picker drag source cancels but a different pointer cannot clear its mode', () => {
  render(<Controlled/>);
  fireEvent.click(screen.getByTestId('board-add-sticky'));
  const source = screen.getByTestId('board-sticky-circle');
  pointer(source, 'pointerdown');
  pointer(source, 'pointercancel', 8);
  expect(screen.getByTestId('board-add-sticky')).toHaveAttribute('aria-pressed', 'true');
  pointer(source, 'pointercancel');
  expect(screen.getByTestId('board-add-sticky')).toHaveAttribute('aria-pressed', 'false');
});

it('unrelated pointer cancellation and readonly changes cannot clear an armed tool', () => {
  const view = render(<Controlled/>);
  const source = screen.getByTestId('board-add-sticky');
  fireEvent.click(source);
  pointer(document.body, 'pointerdown');
  pointer(source, 'pointercancel');
  expect(source).toHaveAttribute('aria-pressed', 'true');
  pointer(source, 'pointerdown');
  view.rerender(<Controlled readOnly/>);
  pointer(source, 'pointercancel');
  expect(source).toHaveAttribute('aria-pressed', 'true');
  expect(quickCreate).not.toHaveBeenCalled();
});

it('zero-button capture loss does not treat normal release as cancellation', () => {
  render(<Controlled/>);
  const source = screen.getByTestId('board-add-sticky');
  fireEvent.click(source);
  pointer(source, 'pointerdown');
  pointer(source, 'lostpointercapture', 7, 0);
  expect(source).toHaveAttribute('aria-pressed', 'true');
  pointer(source, 'pointerup', 7, 0);
  pointer(source, 'pointercancel');
  expect(source).toHaveAttribute('aria-pressed', 'true');
});

it('color and ordinary picker controls do not become creation pointer sources', () => {
  render(<Controlled/>);
  fireEvent.click(screen.getByTestId('board-add-sticky'));
  const color = screen.getByTestId('board-sticky-default-pink');
  pointer(color, 'pointerdown');
  pointer(color, 'pointercancel');
  expect(screen.getByTestId('board-add-sticky')).toHaveAttribute('aria-pressed', 'true');
  expect(quickCreate).not.toHaveBeenCalled();
});

it('native HTML drag takeover does not mistake pointercancel for an abandoned tool gesture', () => {
  render(<Controlled/>);
  fireEvent.click(screen.getByTestId('board-add-sticky'));
  const source = screen.getByTestId('board-sticky-circle');
  pointer(source, 'pointerdown');
  const payload = new Map<string, string>();
  fireEvent.dragStart(source, {dataTransfer: {
    get types() {return [...payload.keys()];},
    setData: (type: string, value: string) => payload.set(type, value),
  }});
  expect(payload.has('application/x-workspacex-board-tool')).toBe(true);
  pointer(source, 'pointercancel', 7, 0);
  expect(screen.getByTestId('board-add-sticky')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('board-tool-picker')).toBeVisible();
  expect(source.isConnected).toBe(true);
  expect(quickCreate).not.toHaveBeenCalled();
});

for (const cancelled of ['pointercancel', 'lostpointercapture']) {
  it(`${cancelled} leaves actual document and unarmed canvas click unchanged`, () => {
    const doc = createWhiteboardDocument(), updates = vi.fn();
    doc.on('update', updates);
    render(<CollaborativeEditor boardId="pointer-test" clientId="pointer-client" doc={doc} readOnly={false} title="Pointer test" status="已连接"/>);
    try {
      const source = screen.getByTestId('board-add-sticky');
      fireEvent.click(source);
      pointer(source, 'pointerdown'); pointer(source, cancelled);
      fireEvent.click(screen.getByTestId('pointer-test-canvas'));
      expect(readObjects(doc)).toHaveLength(0);
      expect(updates).not.toHaveBeenCalled();
      fireEvent.click(source);
      fireEvent.click(screen.getByTestId('pointer-test-canvas'));
      expect(readObjects(doc)).toHaveLength(1);
      expect(updates).toHaveBeenCalledOnce();
    } finally {doc.destroy();}
  });
}
