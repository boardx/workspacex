import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BoardBottomDock, type BoardCreationTool } from '@/components/whiteboard/board-bottom-dock';

afterEach(cleanup);

it.each(['sticky', 'text', 'shape'] as const)('clears armed %s creation after an outside drag end without creating', (kind) => {
  const quickCreate = vi.fn();
  function ControlledDock() {
    const [creationTool, setCreationTool] = useState<BoardCreationTool>(null);
    return <BoardBottomDock activeTool="select" creationTool={creationTool} readOnly={false}
      onToolChange={vi.fn()} onCreationToolChange={setCreationTool} onQuickCreate={quickCreate}
      onBulkSticky={vi.fn()} onImageRequest={vi.fn()} />;
  }
  render(<ControlledDock />);
  const button = screen.getByTestId(`board-add-${kind}`);
  fireEvent.click(button);
  expect(button.getAttribute('aria-pressed')).toBe('true');
  fireEvent.dragStart(button, { dataTransfer: { setData: vi.fn(), types: ['application/x-workspacex-board-tool'], effectAllowed: 'none' } });
  fireEvent.dragEnd(button, { dataTransfer: { dropEffect: 'none' } });
  expect(button.getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByTestId('board-tool-select').getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByTestId('board-tool-picker')).toBeNull();
  expect(quickCreate).not.toHaveBeenCalled();
});

it.each(['board-sticky-circle', 'board-text-heading', 'board-shape-circle'])('clears a cancelled picker drag from %s', (testId) => {
  const change = vi.fn();
  const kind = testId.includes('sticky') ? 'sticky' : testId.includes('text') ? 'text' : 'shape';
  const creationTool: BoardCreationTool = kind === 'sticky' ? { kind, variant: 'square' }
    : kind === 'text' ? { kind, preset: 'body' } : { kind, variant: 'rectangle' };
  render(<BoardBottomDock activeTool="select" creationTool={creationTool} readOnly={false}
    onToolChange={vi.fn()} onCreationToolChange={change} onQuickCreate={vi.fn()}
    onBulkSticky={vi.fn()} onImageRequest={vi.fn()} />);
  fireEvent.click(screen.getByTestId(`board-add-${kind}`));
  change.mockClear();
  const source = screen.getByTestId(testId);
  fireEvent.dragStart(source, { dataTransfer: { setData: vi.fn(), types: ['application/x-workspacex-board-tool'] } });
  fireEvent.dragEnd(source, { dataTransfer: { dropEffect: 'none' } });
  expect(change).toHaveBeenCalledTimes(1);
  expect(change).toHaveBeenCalledWith(null);
  expect(screen.queryByTestId('board-tool-picker')).toBeNull();
});

it('ignores unrelated extension drags and drag end without a tool drag start', () => {
  const change = vi.fn();
  render(<BoardBottomDock activeTool="select" creationTool={{ kind: 'content', contentType: 'tile' }} readOnly={false}
    extension={<button draggable data-testid="extension-file">File</button>}
    onToolChange={vi.fn()} onCreationToolChange={change} onQuickCreate={vi.fn()}
    onBulkSticky={vi.fn()} onImageRequest={vi.fn()} />);
  fireEvent.click(screen.getByTestId('board-add-more'));
  change.mockClear();
  const source = screen.getByTestId('extension-file');
  fireEvent.dragEnd(source);
  fireEvent.dragStart(source, { dataTransfer: { types: ['text/plain'] } });
  fireEvent.dragEnd(source);
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByTestId('board-tool-picker')).toBeTruthy();
});
