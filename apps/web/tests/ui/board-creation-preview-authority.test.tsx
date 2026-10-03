import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { STICKY_COLOR_PRESETS, validateTextAttributes } from '@repo/whiteboard-core';
import { BoardBottomDock, type BoardCreationTool } from '@/components/whiteboard/board-bottom-dock';

const quickCreate = vi.fn();
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function ControlledDock() {
  const [creationTool, setCreationTool] = useState<BoardCreationTool>(null);
  const [color, setColor] = useState<string>(STICKY_COLOR_PRESETS.blue);
  return <BoardBottomDock activeTool="select" creationTool={creationTool} readOnly={false}
    onToolChange={vi.fn()} onCreationToolChange={setCreationTool} onQuickCreate={quickCreate}
    onBulkSticky={vi.fn()} onImageRequest={vi.fn()} stickyColor={color} onStickyColorChange={setColor} />;
}

it('previews each canonical text preset size and weight without creating', () => {
  render(<ControlledDock />);
  fireEvent.click(screen.getByTestId('board-add-text'));
  for (const preset of ['title', 'heading', 'subheading', 'body', 'caption'] as const) {
    const canonical = validateTextAttributes({ preset });
    const preview = screen.getByTestId(`board-text-${preset}`).querySelector('span');
    expect(preview).toHaveStyle({ fontSize: `${Math.max(12, Math.round(canonical.fontSize * 0.75))}px`, fontWeight: canonical.bold ? '700' : '400' });
  }
  expect(quickCreate).not.toHaveBeenCalled();
});

it('uses matching paper silhouettes and the chosen source color in picker and Dock', () => {
  render(<ControlledDock />);
  fireEvent.click(screen.getByTestId('board-add-sticky'));
  for (const [name, color] of Object.entries(STICKY_COLOR_PRESETS)) {
    fireEvent.click(screen.getByTestId(`board-sticky-default-${name}`));
    for (const variant of ['square', 'rectangle', 'circle'] as const) {
      fireEvent.click(screen.getByTestId(`board-sticky-${variant}`));
      const expected = { backgroundColor: color, width: variant === 'rectangle' ? '30px' : '24px', height: variant === 'rectangle' ? '19px' : '24px', borderRadius: variant === 'circle' ? '50%' : '2px' };
      expect(screen.getByTestId(`board-sticky-${variant}`).querySelector('span[aria-hidden="true"]')).toHaveStyle(expected);
      expect(screen.getByTestId('board-add-sticky').querySelector('span[aria-hidden="true"]')).toHaveStyle(expected);
    }
  }
  expect(quickCreate).not.toHaveBeenCalled();
});

it('immediately renders the active Sticky variant and retains it after switching tools', () => {
  render(<ControlledDock />);
  fireEvent.click(screen.getByTestId('board-add-sticky'));
  fireEvent.click(screen.getByTestId('board-sticky-circle'));
  expect(screen.getByTestId('board-add-sticky').querySelector('span[aria-hidden="true"]')).toHaveStyle({ backgroundColor: '#C6DDFF', borderRadius: '50%' });
  fireEvent.click(screen.getByTestId('board-sticky-rectangle'));
  const preview = screen.getByTestId('board-add-sticky').querySelector('span[aria-hidden="true"]');
  expect(preview).toHaveStyle({ width: '30px', height: '19px' });
  expect(preview).not.toHaveClass('h-6', 'w-6');
  fireEvent.click(screen.getByTestId('board-tool-select'));
  expect(screen.getByTestId('board-add-sticky').querySelector('span[aria-hidden="true"]')).toHaveStyle({ width: '30px', height: '19px' });
});

it('immediately previews the active Shape and retains Shape and Text choices', () => {
  render(<ControlledDock />);
  fireEvent.click(screen.getByTestId('board-add-shape'));
  fireEvent.click(screen.getByTestId('board-shape-circle'));
  expect(screen.getByTestId('board-add-shape').querySelector('circle')).toBeTruthy();
  fireEvent.click(screen.getByTestId('board-tool-select'));
  fireEvent.click(screen.getByTestId('board-add-shape'));
  expect(screen.getByTestId('board-shape-circle')).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByTestId('board-add-text'));
  fireEvent.click(screen.getByTestId('board-text-heading'));
  fireEvent.click(screen.getByTestId('board-tool-select'));
  fireEvent.click(screen.getByTestId('board-add-text'));
  expect(screen.getByTestId('board-text-heading')).toHaveAttribute('aria-pressed', 'true');
});

it('preserves the selected Sticky color and variant in picker and Dock drag payloads', () => {
  render(<ControlledDock />);
  fireEvent.click(screen.getByTestId('board-add-sticky'));
  fireEvent.click(screen.getByTestId('board-sticky-default-pink'));
  fireEvent.click(screen.getByTestId('board-sticky-rectangle'));
  for (const testId of ['board-sticky-rectangle', 'board-add-sticky']) {
    const setData = vi.fn();
    fireEvent.dragStart(screen.getByTestId(testId), { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledOnce();
    const [mime, payload] = setData.mock.calls[0]!;
    expect(mime).toBe('application/x-workspacex-board-tool');
    expect(JSON.parse(payload)).toEqual({ kind: 'sticky', variant: 'rectangle', color: STICKY_COLOR_PRESETS.pink });
  }
  expect(quickCreate).not.toHaveBeenCalled();
});
