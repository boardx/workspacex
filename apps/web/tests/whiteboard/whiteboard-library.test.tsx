import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WhiteboardLibrary } from '@/components/whiteboard/whiteboard-library';
import * as api from '@/lib/live-whiteboard';
import { ApiError } from '@/lib/api-client';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/live-whiteboard', () => ({
  listBoards: vi.fn(), listBoardTags: vi.fn(), createBoard: vi.fn(), getBoard: vi.fn(), updateBoard: vi.fn(), duplicateBoard: vi.fn(), deleteBoard: vi.fn(),
  createBoardTag: vi.fn(), renameBoardTag: vi.fn(), deleteBoardTag: vi.fn(), listBoardMembers: vi.fn(), putBoardMember: vi.fn(), removeBoardMember: vi.fn(),
}));

const tag: api.BoardTag = { id: '7f2973dc-c5d2-4757-903e-44e421aa3c28', name: '研究', revision: 1, createdBy: 'owner', createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z' };
const board: api.Board = { id: '57d83843-21e2-40ae-8c1c-571d0ad63c80', name: '团队白板', ownerId: 'owner', role: 'owner', archived: false, lifecycleRevision: 3, tagIds: [tag.id], tagsRevision: 2, createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z' };
const result = (items: api.Board[]) => ({ items, nextCursor: null });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listBoards).mockResolvedValue(result([])); vi.mocked(api.listBoardTags).mockResolvedValue([tag]);
  vi.mocked(api.updateBoard).mockImplementation(async (_id, input) => ({ ...board, ...input }));
});
afterEach(cleanup);
async function openMenu(item: api.Board = board) { fireEvent.pointerDown(await screen.findByTestId(`board-menu-${item.id}`), { button: 0 }); }

describe('Board library', () => {
  it('requests untagged boards from the server and clears that filter when selecting a tag', async () => {
    render(<WhiteboardLibrary />); await screen.findByTestId('empty');
    fireEvent.click(screen.getByRole('button', {name:'无标签'}));
    await waitFor(() => expect(api.listBoards).toHaveBeenLastCalledWith(expect.objectContaining({untagged:'true',tagIds:[]}),expect.any(AbortSignal)));
    expect(screen.getByRole('button', {name:'无标签'})).toHaveAttribute('aria-pressed','true');
    fireEvent.click(screen.getByTestId(`board-filter-tag-${tag.id}`));
    await waitFor(() => expect(api.listBoards).toHaveBeenLastCalledWith(expect.objectContaining({untagged:'false',tagIds:[tag.id]}),expect.any(AbortSignal)));
    fireEvent.click(screen.getByRole('button', {name:'全部标签'}));
    await waitFor(() => expect(api.listBoards).toHaveBeenLastCalledWith(expect.objectContaining({untagged:'false',tagIds:[]}),expect.any(AbortSignal)));
  });
  it('creates once with a durable request id and enters the full-screen editor', async () => {
    vi.mocked(api.createBoard).mockRejectedValueOnce(new Error('private')).mockResolvedValueOnce(board);
    render(<WhiteboardLibrary />); await screen.findByTestId('empty');
    fireEvent.click(screen.getByTestId('board-create')); fireEvent.change(screen.getByTestId('board-create-name'), { target: { value: '团队白板' } }); fireEvent.click(screen.getByTestId('board-create-confirm')); await screen.findByTestId('board-create-error');
    expect(screen.getByTestId('board-create-name')).toBeDisabled(); expect(screen.getByTestId('board-create-name')).toHaveValue('团队白板'); expect(screen.getByTestId('board-create-confirm')).toHaveTextContent('重试创建并打开');
    fireEvent.click(screen.getByTestId('board-create-confirm')); await waitFor(() => expect(push).toHaveBeenCalledWith(`/studio/board/${board.id}`));
    expect(api.createBoard).toHaveBeenCalledTimes(2); expect(vi.mocked(api.createBoard).mock.calls[0]![0]).toEqual(vi.mocked(api.createBoard).mock.calls[1]![0]);
  });
  it('opens default title and returns focus after Escape without creating', async () => {
    render(<WhiteboardLibrary />); await screen.findByTestId('empty');
    expect(screen.queryByTestId('board-create-name')).not.toBeInTheDocument();
    const trigger = screen.getByTestId('board-create'); trigger.focus(); fireEvent.click(trigger);
    const input = screen.getByTestId('board-create-name') as HTMLInputElement;
    expect(input.value).toBe('未命名白板'); expect(input.selectionStart).toBe(0); expect(input.selectionEnd).toBe(input.value.length);
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('board-create-dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus()); expect(api.createBoard).not.toHaveBeenCalled();
  });
  it.each(['retry', 'already-saved', 'conflict'])('preserves the created board when tag binding needs %s', async mode => {
    const empty = { ...board, tagIds: [], tagsRevision: 0 };
    vi.mocked(api.createBoard).mockResolvedValue(empty);
    vi.mocked(api.getBoard).mockResolvedValue(mode === 'already-saved' ? board : mode === 'conflict' ? { ...empty, tagsRevision: 2 } : empty);
    vi.mocked(api.updateBoard).mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(board);
    render(<WhiteboardLibrary />); await screen.findByTestId('empty'); fireEvent.click(screen.getByTestId('board-create'));
    fireEvent.click(screen.getByRole('checkbox', { name: '研究' })); fireEvent.click(screen.getByTestId('board-create-confirm'));
    await screen.findByTestId('board-create-error'); expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '返回列表，保留白板' }));
    await screen.findByText('白板已创建并保留，标签尚未保存。再次打开新建窗口可继续。');
    fireEvent.click(screen.getByTestId('board-create')); expect(screen.getByTestId('board-create-confirm')).toHaveFocus(); fireEvent.click(screen.getByTestId('board-create-confirm'));
    if (mode === 'conflict') { await screen.findByText('白板标签已由其他协作者更新。请返回列表查看，当前操作不会覆盖他们的修改。'); expect(push).not.toHaveBeenCalled(); }
    else await waitFor(() => expect(push).toHaveBeenCalled());
    expect(api.createBoard).toHaveBeenCalledTimes(1); expect(api.updateBoard).toHaveBeenCalledTimes(mode === 'retry' ? 2 : 1);
  });
  it('adds a new tag using a stable retry identity', async () => {
    const added = { ...tag, id: '59a39eb5-0d5a-4590-9870-c212e162ae11', name: '产品' };
    vi.mocked(api.createBoardTag).mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(added);
    vi.mocked(api.createBoard).mockResolvedValue({ ...board, tagIds: [], tagsRevision: 0 });
    render(<WhiteboardLibrary />); await screen.findByTestId('empty'); fireEvent.click(screen.getByTestId('board-create'));
    fireEvent.change(screen.getByRole('textbox', { name: '搜索或添加标签' }), { target: { value: '产品' } });
    fireEvent.click(screen.getByRole('button', { name: '添加标签“产品”' })); await screen.findByTestId('board-create-error');
    expect(screen.getByTestId('board-create-confirm')).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: '重试添加标签' }));
    await screen.findByRole('checkbox', { name: '产品' }); expect(vi.mocked(api.createBoardTag).mock.calls[0]).toEqual(vi.mocked(api.createBoardTag).mock.calls[1]);
    fireEvent.click(screen.getByTestId('board-create-confirm')); await waitFor(() => expect(push).toHaveBeenCalled());
    expect(api.updateBoard).toHaveBeenCalledWith(board.id, { tagIds: [added.id], expectedTagsRevision: 0 });
  });
  it('never silently discards an unfinished tag name and allows abandoning an uncertain tag', async () => {
    vi.mocked(api.createBoardTag).mockRejectedValue(new Error('lost'));
    vi.mocked(api.createBoard).mockResolvedValue({ ...board, tagIds: [] });
    render(<WhiteboardLibrary />); await screen.findByTestId('empty'); fireEvent.click(screen.getByTestId('board-create'));
    fireEvent.change(screen.getByRole('textbox', { name: '搜索或添加标签' }), { target: { value: '产品' } });
    fireEvent.click(screen.getByTestId('board-create-confirm')); await screen.findByText('标签输入尚未完成。请先选择或添加标签，或清空搜索后创建白板。');
    expect(api.createBoard).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: '添加标签“产品”' }));
    await screen.findByRole('button', { name: '不关联此标签，继续' });
    await waitFor(() => expect(screen.getByRole('button', { name: '不关联此标签，继续' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '不关联此标签，继续' })); fireEvent.click(screen.getByTestId('board-create-confirm'));
    await waitFor(() => expect(push).toHaveBeenCalled()); expect(api.updateBoard).not.toHaveBeenCalled();
  });
  it('debounces server search and sends stable tag ids as an AND filter', async () => {
    render(<WhiteboardLibrary />); await screen.findByTestId('empty'); fireEvent.change(screen.getByTestId('board-search'), { target: { value: '  journey  ' } }); fireEvent.click(screen.getByTestId(`board-filter-tag-${tag.id}`));
    await waitFor(() => expect(api.listBoards).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'journey', tagIds: [tag.id], archived: 'active' }), expect.anything()), { timeout: 1200 });
  });
  it('ignores a superseded list response that resolves after the current query', async () => {
    const old = deferred<ReturnType<typeof result>>(), current = { ...board, name: '当前结果' }, stale = { ...board, name: '过期结果' };
    vi.mocked(api.listBoards).mockImplementationOnce(() => old.promise).mockResolvedValueOnce(result([current]));
    render(<WhiteboardLibrary />); fireEvent.change(screen.getByTestId('board-search'), { target: { value: 'current' } });
    expect(await screen.findByText('当前结果', {}, { timeout: 1200 })).toBeInTheDocument(); old.resolve(result([stale]));
    await waitFor(() => expect(screen.queryByText('过期结果')).not.toBeInTheDocument()); expect(screen.getByText('当前结果')).toBeInTheDocument();
  });
  it('offers a discoverable retry after initial list failure', async () => {
    vi.mocked(api.listBoards).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(result([])); render(<WhiteboardLibrary />);
    await screen.findByTestId('board-list-error'); fireEvent.click(screen.getByTestId('board-list-retry')); expect(await screen.findByTestId('empty')).toBeInTheDocument();
  });
  it('keeps boards visible when the independent tag catalog request fails', async () => {
    vi.mocked(api.listBoards).mockResolvedValue(result([board])); vi.mocked(api.listBoardTags).mockRejectedValueOnce(new Error('tag service'));
    render(<WhiteboardLibrary />); expect(await screen.findByTestId(`board-card-${board.id}`)).toBeInTheDocument(); expect(await screen.findByTestId('board-tags-error')).toBeInTheDocument();
  });
  it('deduplicates cursor pages by board id and keeps the newest projection', async () => {
    const second = { ...board, id: '18b458a2-1065-44d2-ae74-02fdab5afbd2', name: '第二块' }, updated = { ...board, name: '更新后的名称' };
    vi.mocked(api.listBoards).mockResolvedValueOnce({ items: [board], nextCursor: 'cursor-2' }).mockResolvedValueOnce({ items: [updated, second], nextCursor: null });
    render(<WhiteboardLibrary />); fireEvent.click(await screen.findByTestId('board-load-more'));
    expect(await screen.findByText('第二块')).toBeInTheDocument(); expect(screen.getAllByTestId(`board-card-${board.id}`)).toHaveLength(1); expect(screen.getByText('更新后的名称')).toBeInTheDocument();
  });
  it('exposes pressed state for grid and list view controls', async () => {
    render(<WhiteboardLibrary />); await screen.findByTestId('empty'); const grid = screen.getByRole('button', { name: '网格视图' }), list = screen.getByRole('button', { name: '列表视图' });
    expect(grid).toHaveAttribute('aria-pressed', 'true'); expect(list).toHaveAttribute('aria-pressed', 'false'); fireEvent.click(list); expect(list).toHaveAttribute('aria-pressed', 'true');
  });
  it('opens editor from the card while the three-dot menu stays action-only', async () => {
    vi.mocked(api.listBoards).mockResolvedValue(result([board])); render(<WhiteboardLibrary />);
    expect(await screen.findByTestId(`board-open-${board.id}`)).toHaveAttribute('href', `/studio/board/${board.id}`);
    expect(screen.getByTestId(`board-thumbnail-empty-${board.id}`)).toHaveTextContent('预览尚未生成'); expect(screen.getByTestId(`board-thumbnail-empty-${board.id}`)).not.toHaveClass('bg-gradient-to-br');
    await openMenu(); fireEvent.click(await screen.findByTestId(`board-action-rename-${board.id}`)); expect(await screen.findByTestId('board-rename-dialog')).toBeInTheDocument(); expect(push).not.toHaveBeenCalled();
  });
  it('updates board tags with the current CAS revision', async () => {
    vi.mocked(api.listBoards).mockResolvedValue(result([board])); render(<WhiteboardLibrary />); await openMenu(); fireEvent.click(await screen.findByTestId(`board-action-tags-${board.id}`));
    fireEvent.click(await screen.findByRole('checkbox')); fireEvent.click(screen.getByTestId('board-tags-save'));
    await waitFor(() => expect(api.updateBoard).toHaveBeenCalledWith(board.id, { tagIds: [], expectedTagsRevision: 2 }));
  });
  it('reuses exact request ids and payloads for uncertain tag create, rename and delete retries', async () => {
    const renamed = { ...tag, name: '洞察', revision: 2 };
    vi.mocked(api.createBoardTag).mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce({ ...tag, id: '59a39eb5-0d5a-4590-9870-c212e162ae11', name: '产品' });
    vi.mocked(api.renameBoardTag).mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(renamed);
    vi.mocked(api.deleteBoardTag).mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce({ requestId: '4a2f9d8f-9f18-41b2-921a-a64905c757ca', tagId: tag.id, deleted: true });
    render(<WhiteboardLibrary />); await screen.findByTestId('empty'); fireEvent.click(screen.getByTestId('board-tag-catalog'));
    fireEvent.change(screen.getByTestId('board-tag-name'), { target: { value: '产品' } }); fireEvent.click(screen.getByTestId('board-tag-create'));
    await screen.findByTestId('dep-failed'); expect(screen.getByTestId('board-tag-name')).toBeDisabled(); fireEvent.click(screen.getByTestId('board-tag-create'));
    await waitFor(() => expect(api.createBoardTag).toHaveBeenCalledTimes(2)); expect(vi.mocked(api.createBoardTag).mock.calls[0]![0]).toEqual(vi.mocked(api.createBoardTag).mock.calls[1]![0]);
    const researchName = screen.getByLabelText('研究 标签名称'); fireEvent.change(researchName, { target: { value: '洞察' } }); fireEvent.click(researchName.closest('li')!.querySelector('button')!);
    await screen.findByTestId('dep-failed'); expect(researchName).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: '重试“洞察”' }));
    await waitFor(() => expect(api.renameBoardTag).toHaveBeenCalledTimes(2)); expect(vi.mocked(api.renameBoardTag).mock.calls[0]![1]).toEqual(vi.mocked(api.renameBoardTag).mock.calls[1]![1]);
    const insightRow = (await screen.findByLabelText('洞察 标签名称')).closest('li')!; fireEvent.click(insightRow.querySelectorAll('button')[1]!); fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await screen.findByTestId('dep-failed'); fireEvent.click(screen.getByRole('button', { name: '重试删除' }));
    await waitFor(() => expect(api.deleteBoardTag).toHaveBeenCalledTimes(2)); expect(vi.mocked(api.deleteBoardTag).mock.calls[0]![1]).toEqual(vi.mocked(api.deleteBoardTag).mock.calls[1]![1]);
  });
  it('freezes and reuses the exact duplicate request after an uncertain response', async () => {
    vi.mocked(api.listBoards).mockResolvedValue(result([board]));
    vi.mocked(api.duplicateBoard).mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce({ board: { ...board, id: '18b458a2-1065-44d2-ae74-02fdab5afbd2' }, receipt: { requestId: '4a2f9d8f-9f18-41b2-921a-a64905c757ca', sourceBoardId: board.id, sourceEpoch: 1, sourceSeq: 3, objectCount: 2, connectorCount: 1, assetCount: 0 } });
    render(<WhiteboardLibrary />); await openMenu(); fireEvent.click(await screen.findByTestId(`board-action-duplicate-${board.id}`));
    fireEvent.change(screen.getByTestId('board-dialog-name'), { target: { value: '冻结的副本名' } }); fireEvent.click(screen.getByTestId('board-dialog-confirm')); await screen.findByTestId('dep-failed');
    const frozen = screen.getByTestId('board-dialog-name'); expect(frozen).toBeDisabled(); expect(frozen).toHaveValue('冻结的副本名'); fireEvent.change(frozen, { target: { value: '丢失响应后篡改' } }); expect(frozen).toHaveValue('冻结的副本名');
    expect(screen.getByTestId('board-dialog-confirm')).toHaveTextContent('重试创建“冻结的副本名”'); fireEvent.click(screen.getByTestId('board-dialog-confirm'));
    await waitFor(() => expect(api.duplicateBoard).toHaveBeenCalledTimes(2)); expect(vi.mocked(api.duplicateBoard).mock.calls[0]![1]).toEqual(vi.mocked(api.duplicateBoard).mock.calls[1]![1]);
  });
  it('binds archive to the visible lifecycle revision', async () => {
    vi.mocked(api.listBoards).mockResolvedValue(result([board])); vi.mocked(api.updateBoard).mockResolvedValue({ ...board, archived: true, lifecycleRevision: 4 });
    render(<WhiteboardLibrary />); await openMenu(); fireEvent.click(await screen.findByTestId(`board-action-archive-${board.id}`));
    await waitFor(() => expect(api.updateBoard).toHaveBeenCalledWith(board.id, { archived: true, expectedLifecycleRevision: 3 }));
  });
  it('surfaces an archive revision conflict, refreshes and disables the stale action', async () => {
    const latest = { ...board, archived: true, lifecycleRevision: 4 };
    vi.mocked(api.listBoards).mockResolvedValueOnce(result([board])).mockResolvedValueOnce(result([latest])); vi.mocked(api.updateBoard).mockRejectedValue(new ApiError(409, 'REVISION_CONFLICT', {}));
    render(<WhiteboardLibrary />); await openMenu(); fireEvent.click(await screen.findByTestId(`board-action-archive-${board.id}`));
    expect(await screen.findByText(/状态已被其他协作者更新/)).toBeInTheDocument(); await waitFor(() => expect(api.listBoards).toHaveBeenCalledTimes(2)); expect(api.updateBoard).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId(`board-card-${board.id}`)).toHaveTextContent('已归档'));
  });
  it('deletes only archived boards with explicit confirmation', async () => {
    const archived = { ...board, archived: true }; vi.mocked(api.listBoards).mockResolvedValue(result([archived])); vi.mocked(api.deleteBoard).mockResolvedValue({ requestId: '4a2f9d8f-9f18-41b2-921a-a64905c757ca', boardId: board.id, deleted: true });
    render(<WhiteboardLibrary />); fireEvent.click(await screen.findByTestId('board-filter-archived')); await openMenu(archived); fireEvent.click(await screen.findByTestId(`board-action-delete-${board.id}`)); fireEvent.click(await screen.findByTestId('board-dialog-confirm'));
    await waitFor(() => expect(api.deleteBoard).toHaveBeenCalledWith(board.id, expect.objectContaining({ confirmation: 'PERMANENTLY_DELETE', expectedLifecycleRevision: 3 })));
  });
  it('closes stale permanent delete on revision conflict and refreshes before another action', async () => {
    const archived = { ...board, archived: true }, latest = { ...archived, lifecycleRevision: 4 };
    vi.mocked(api.listBoards).mockResolvedValueOnce(result([archived])).mockResolvedValueOnce(result([latest])); vi.mocked(api.deleteBoard).mockRejectedValue(new ApiError(409, 'REVISION_CONFLICT', {}));
    render(<WhiteboardLibrary />); await openMenu(archived); fireEvent.click(await screen.findByTestId(`board-action-delete-${board.id}`)); fireEvent.click(screen.getByTestId('board-dialog-confirm'));
    expect(await screen.findByText(/状态已被其他协作者更新/)).toBeInTheDocument(); expect(screen.queryByTestId('board-delete-dialog')).not.toBeInTheDocument(); await waitFor(() => expect(api.listBoards).toHaveBeenCalledTimes(2)); expect(api.deleteBoard).toHaveBeenCalledTimes(1);
  });
  it('removes the prior cursor for a new filter and keeps load-more unavailable on failure', async () => {
    vi.mocked(api.listBoards).mockResolvedValueOnce({ items: [board], nextCursor: 'old-cursor' }).mockRejectedValueOnce(new Error('filter failed'));
    render(<WhiteboardLibrary />); await screen.findByTestId('board-load-more'); fireEvent.change(screen.getByTestId('board-search'), { target: { value: 'new filter' } });
    await waitFor(() => expect(api.listBoards).toHaveBeenCalledTimes(2), { timeout: 1200 }); expect(screen.queryByTestId('board-load-more')).not.toBeInTheDocument();
    await screen.findByTestId('board-list-error'); expect(screen.queryByTestId('board-load-more')).not.toBeInTheDocument();
  });
  it('hides mutating actions from viewers and redacts dependency detail', async () => {
    const viewer = { ...board, role: 'viewer' as const }; vi.mocked(api.listBoards).mockResolvedValueOnce(result([viewer])); render(<WhiteboardLibrary />); await openMenu(viewer);
    expect(screen.queryByTestId(`board-action-rename-${board.id}`)).not.toBeInTheDocument(); expect(screen.queryByTestId(`board-action-tags-${board.id}`)).not.toBeInTheDocument();
    cleanup(); vi.mocked(api.listBoards).mockRejectedValue(new ApiError(403, 'private', {})); render(<WhiteboardLibrary />); expect(await screen.findByTestId('board-list-error')).not.toHaveTextContent('private');
  });
  it('does not expose board tag management to editors', async () => {
    const editor = { ...board, role: 'editor' as const }; vi.mocked(api.listBoards).mockResolvedValue(result([editor])); render(<WhiteboardLibrary />); await openMenu(editor);
    expect(screen.queryByTestId(`board-action-tags-${board.id}`)).not.toBeInTheDocument(); expect(screen.getByTestId(`board-action-duplicate-${board.id}`)).toBeInTheDocument();
  });
  it('returns focus to the originating menu trigger when a dialog closes', async () => {
    vi.mocked(api.listBoards).mockResolvedValue(result([board])); render(<WhiteboardLibrary />); await openMenu(); fireEvent.click(await screen.findByTestId(`board-action-rename-${board.id}`));
    fireEvent.click(await screen.findByRole('button', { name: '取消' })); await waitFor(() => expect(screen.getByTestId(`board-menu-${board.id}`)).toHaveFocus());
  });
});
