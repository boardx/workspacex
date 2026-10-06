import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BoardSelectionLayoutPanel, type BoardSelectionLayoutPanelProps } from "@/components/whiteboard/board-selection-layout-panel";
afterEach(cleanup);
const props = (): BoardSelectionLayoutPanelProps => ({ disabled: false, selectedCount: 4, gap: 24, columns: 3, onGapChange: vi.fn(), onColumnsChange: vi.fn(), onArrange: vi.fn(), onPreview: vi.fn() });
const tab = (name: string) => { fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false }); };
it('groups alignment, distribution and size commands and preserves canonical command callbacks', () => {
  const p = props(); render(<BoardSelectionLayoutPanel {...p} />);
  for (const kind of ['align-left','align-center','align-right','align-top','align-middle','align-bottom','distribute-horizontal','distribute-vertical','equal-width','equal-height','equal-size']) {
    const button = screen.getByTestId(`board-layout-${kind}`); expect(button).toHaveAttribute('aria-label'); fireEvent.click(button); expect(p.onArrange).toHaveBeenLastCalledWith(kind);
  }
  expect(screen.queryByTestId('board-layout-row')).toBeNull(); tab('排列');
  for (const kind of ['grid','row','column','tidy-up']) { fireEvent.click(screen.getByTestId(`board-layout-${kind}`)); expect(p.onArrange).toHaveBeenLastCalledWith(kind); }
});
it('offers all smart previews without applying canonical mutations', () => {
  const p = props(); render(<BoardSelectionLayoutPanel {...p} />); tab('智能布局');
  for (const kind of ['grid','cards','cluster','journey','mind-map','flow','timeline']) { fireEvent.click(screen.getByTestId(`board-smart-${kind}`)); expect(p.onPreview).toHaveBeenLastCalledWith(kind); }
  fireEvent.click(screen.getByTestId('board-layout-smart-preview')); expect(p.onPreview).toHaveBeenLastCalledWith('grid'); expect(p.onArrange).not.toHaveBeenCalled();
});
it('retains distribution minimum and clamps layout parameters', () => {
  const p = props(); render(<BoardSelectionLayoutPanel {...p} selectedCount={2} />);
  expect(screen.getByTestId('board-layout-distribute-horizontal')).toBeDisabled(); expect(screen.getByTestId('board-layout-align-left')).toBeEnabled();
  fireEvent.change(screen.getByTestId('board-layout-gap'), { target: { value: '-12' } }); expect(p.onGapChange).toHaveBeenLastCalledWith(0);
  fireEvent.change(screen.getByTestId('board-layout-columns'), { target: { value: '99' } }); expect(p.onColumnsChange).toHaveBeenLastCalledWith(20);
});
it('prevents all command paths when selection is read only, locked or invalid', () => {
  const p = props(); render(<BoardSelectionLayoutPanel {...p} disabled />);
  expect(screen.getByTestId('board-layout-align-left')).toBeDisabled(); tab('排列'); expect(screen.getByTestId('board-layout-grid')).toBeDisabled(); tab('智能布局'); expect(screen.getByTestId('board-smart-flow')).toBeDisabled(); expect(screen.getByTestId('board-layout-gap')).toBeDisabled();
});
