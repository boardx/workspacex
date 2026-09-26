import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('next/dynamic', () => ({ default: () => ({ draft, onDraft }: { draft?: string; onDraft: (draft: string) => void }) => <button data-testid="mock-fabric" onClick={() => onDraft('edited document')}>{draft || 'empty document'}</button> }));
import { BoardWorkspacePreview } from '@/components/board-workspace-preview/workspace';
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); });
it('requires a name, creates and renames a board, and cancels destructive deletion', () => {
 render(<BoardWorkspacePreview />);
 fireEvent.click(screen.getByTestId('workspace-create')); fireEvent.click(screen.getByTestId('workspace-confirm'));
 expect(screen.getByTestId('err-form')).toBeTruthy();
 fireEvent.change(screen.getByTestId('workspace-name'), { target: { value: '新想法' } }); fireEvent.click(screen.getByTestId('workspace-confirm'));
 expect(screen.getByTestId('workspace-editor')).toBeTruthy(); fireEvent.click(screen.getByTestId('workspace-back')); expect(screen.getByRole('button', { name: '打开 新想法' })).toBeTruthy();
 fireEvent.click(screen.getByTestId('workspace-rename-one')); fireEvent.change(screen.getByTestId('workspace-name'), { target: { value: '更新后的名称' } }); fireEvent.click(screen.getByTestId('workspace-confirm'));
 fireEvent.click(screen.getByTestId('workspace-delete-one')); fireEvent.click(screen.getByTestId('workspace-cancel'));
 expect(screen.getByRole('button', { name: '打开 更新后的名称' })).toBeTruthy();
 fireEvent.click(screen.getByTestId('workspace-delete-one')); fireEvent.click(screen.getByTestId('workspace-confirm'));
 expect(screen.queryByRole('button', { name: '打开 更新后的名称' })).toBeNull();
});
it('opens fullscreen editor and exposes core tool settings', () => {
 render(<BoardWorkspacePreview />); fireEvent.click(screen.getByTestId('workspace-open-one'));
 expect(screen.getByTestId('workspace-editor')).toBeTruthy(); fireEvent.click(screen.getByTestId('workspace-tool-shape'));
 expect(screen.getByTestId('workspace-shape-circle')).toBeTruthy(); fireEvent.click(screen.getByTestId('workspace-tool-draw'));
 expect(screen.getByTestId('workspace-width-8')).toBeTruthy(); fireEvent.click(screen.getByTestId('workspace-back')); expect(screen.getByTestId('workspace-board-grid')).toBeTruthy();
});
it('disables every mutating tool in readonly mode', () => {
 window.history.replaceState({}, '', '/?state=readonly'); render(<BoardWorkspacePreview />);
 for (const tool of ['sticky', 'shape', 'draw', 'connector']) expect(screen.getByTestId(`workspace-tool-${tool}`).hasAttribute('disabled')).toBe(true);
});

it('retains drafts separately for each board across list navigation', () => {
 render(<BoardWorkspacePreview />); fireEvent.click(screen.getByTestId('workspace-open-one')); fireEvent.click(screen.getByTestId('mock-fabric')); fireEvent.click(screen.getByTestId('workspace-back'));
 fireEvent.click(screen.getByTestId('workspace-open-two')); expect(screen.getByTestId('mock-fabric').textContent).toBe('empty document'); fireEvent.click(screen.getByTestId('workspace-back'));
 fireEvent.click(screen.getByTestId('workspace-open-one')); expect(screen.getByTestId('mock-fabric').textContent).toBe('edited document');
});
