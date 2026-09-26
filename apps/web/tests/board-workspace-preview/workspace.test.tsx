import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('next/dynamic', () => ({ default: () => ({ draft, onDraft }: { draft?: string; onDraft: (draft: string) => void }) => <button data-testid="mock-fabric" onClick={() => onDraft(draft === 'edited document' ? 'changed copy' : 'edited document')}>{draft || 'empty document'}</button> }));
import { BoardWorkspacePreview } from '@/components/board-workspace-preview/workspace';
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); });
it('requires a name, creates and renames a board, and cancels destructive deletion', () => {
 render(<BoardWorkspacePreview />);
 fireEvent.click(screen.getByTestId('workspace-create')); fireEvent.click(screen.getByTestId('workspace-confirm'));
 expect(screen.getByTestId('err-form')).toBeTruthy();
 fireEvent.change(screen.getByTestId('workspace-name'), { target: { value: '新想法' } }); fireEvent.click(screen.getByTestId('workspace-confirm'));
 expect(screen.getByTestId('workspace-editor')).toBeTruthy(); fireEvent.click(screen.getByTestId('workspace-back')); expect(screen.getByRole('button', { name: '打开 新想法' })).toBeTruthy();
 fireEvent.keyDown(screen.getByTestId('workspace-menu-one'), { key: 'Enter' }); fireEvent.click(screen.getByTestId('workspace-rename-one')); fireEvent.change(screen.getByTestId('workspace-name'), { target: { value: '更新后的名称' } }); fireEvent.click(screen.getByTestId('workspace-confirm'));
 fireEvent.keyDown(screen.getByTestId('workspace-menu-one'), { key: 'Enter' }); fireEvent.click(screen.getByTestId('workspace-delete-one')); fireEvent.click(screen.getByTestId('workspace-cancel'));
 expect(screen.getByRole('button', { name: '打开 更新后的名称' })).toBeTruthy();
 fireEvent.keyDown(screen.getByTestId('workspace-menu-one'), { key: 'Enter' }); fireEvent.click(screen.getByTestId('workspace-delete-one')); fireEvent.click(screen.getByTestId('workspace-confirm'));
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

it('combines tag filters with search and clears all filters', () => {
 render(<BoardWorkspacePreview />); fireEvent.click(screen.getByTestId('workspace-filter-team')); fireEvent.click(screen.getByTestId('workspace-filter-idea'));
 expect(screen.getByTestId('workspace-open-one')).toBeTruthy(); expect(screen.queryByTestId('workspace-open-two')).toBeNull();
 fireEvent.change(screen.getByTestId('workspace-search'), { target: { value: '没有匹配' } }); expect(screen.getByTestId('empty')).toBeTruthy();
 fireEvent.click(screen.getByTestId('workspace-clear-filters')); expect(screen.getByTestId('workspace-open-two')).toBeTruthy();
});
it('copies edited content to an independent board', async () => {
 render(<BoardWorkspacePreview />); fireEvent.click(screen.getByTestId('workspace-open-one')); fireEvent.click(screen.getByTestId('mock-fabric')); fireEvent.click(screen.getByTestId('workspace-back'));
 fireEvent.keyDown(screen.getByTestId('workspace-menu-one'), { key: 'Enter' }); fireEvent.click(screen.getByTestId('workspace-duplicate-one'));
 fireEvent.click(await screen.findByRole('button', { name: '打开 团队创意工作坊 副本' })); expect(screen.getByTestId('mock-fabric').textContent).toBe('edited document'); fireEvent.click(screen.getByTestId('mock-fabric'));
 fireEvent.click(screen.getByTestId('workspace-back')); fireEvent.click(screen.getByTestId('workspace-open-one')); expect(screen.getByTestId('mock-fabric').textContent).toBe('edited document');
});

it('renames tags without changing identity and deletes bindings everywhere', () => {
 render(<BoardWorkspacePreview />); fireEvent.click(screen.getByTestId('workspace-manage-tags')); fireEvent.click(screen.getByTestId('workspace-tag-rename-idea'));
 fireEvent.change(screen.getByTestId('workspace-tag-name'), { target: { value: '灵感' } }); fireEvent.click(screen.getByTestId('workspace-tag-save')); fireEvent.click(screen.getByTestId('workspace-tags-done'));
 expect(screen.getByTestId('workspace-filter-idea').textContent).toBe('灵感'); fireEvent.click(screen.getByTestId('workspace-filter-idea')); expect(screen.getByTestId('workspace-open-two')).toBeTruthy();
 fireEvent.click(screen.getByTestId('workspace-manage-tags')); fireEvent.click(screen.getByTestId('workspace-tag-delete-idea')); fireEvent.click(screen.getByTestId('workspace-tag-delete-confirm')); fireEvent.click(screen.getByTestId('workspace-tags-done'));
 expect(screen.queryByTestId('workspace-filter-idea')).toBeNull(); expect(screen.getByTestId('workspace-open-three')).toBeTruthy(); expect(screen.queryByText('灵感', { selector: 'span.rounded-full' })).toBeNull();
});

it('clears editing state when the tag being renamed is deleted', () => {
 render(<BoardWorkspacePreview />); fireEvent.click(screen.getByTestId('workspace-manage-tags')); fireEvent.click(screen.getByTestId('workspace-tag-rename-idea'));
 fireEvent.change(screen.getByTestId('workspace-tag-name'), { target: { value: '不应复活' } });
 fireEvent.click(screen.getByTestId('workspace-tag-delete-idea')); fireEvent.click(screen.getByTestId('workspace-tag-delete-confirm'));
 expect((screen.getByTestId('workspace-tag-name') as HTMLInputElement).value).toBe(''); expect(screen.getByTestId('workspace-tag-save').textContent).toBe('新建标签');
 fireEvent.click(screen.getByTestId('workspace-tag-save')); expect(screen.getByRole('alert')).toBeTruthy(); fireEvent.click(screen.getByTestId('workspace-tags-done'));
 expect(screen.queryByTestId('workspace-filter-idea')).toBeNull(); expect(screen.queryByText('不应复活')).toBeNull();
});

it('restores tag dialog focus to global or per-board trigger', async () => {
 render(<BoardWorkspacePreview />); fireEvent.click(screen.getByTestId('workspace-manage-tags')); fireEvent.click(screen.getByTestId('workspace-tags-done'));
 await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('workspace-manage-tags')));
 fireEvent.keyDown(screen.getByTestId('workspace-menu-one'), { key: 'Enter' }); fireEvent.click(screen.getByTestId('workspace-tags-one')); fireEvent.click(screen.getByTestId('workspace-tags-done'));
 await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('workspace-menu-one')));
});
