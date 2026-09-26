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
const board: api.Board = { id: '57d83843-21e2-40ae-8c1c-571d0ad63c80', name: '团队白板', ownerId: 'owner', role: 'owner', archived: false, tagIds: [tag.id], tagsRevision: 2, createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z' };
const result = (items: api.Board[]) => ({ items, nextCursor: null });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listBoards).mockResolvedValue(result([])); vi.mocked(api.listBoardTags).mockResolvedValue([tag]);
  vi.mocked(api.updateBoard).mockImplementation(async (_id, input) => ({ ...board, ...input }));
});
afterEach(cleanup);
async function openMenu(item: api.Board = board) { fireEvent.pointerDown(await screen.findByTestId(`board-menu-${item.id}`), { button: 0 }); }

describe('Board library', () => {
  it('creates once with a durable request id and enters the full-screen editor', async () => {
    vi.mocked(api.createBoard).mockRejectedValueOnce(new Error('private')).mockResolvedValueOnce(board);
    render(<WhiteboardLibrary />); await screen.findByTestId('empty');
    fireEvent.change(screen.getByTestId('board-create-name'), { target: { value: '团队白板' } }); fireEvent.click(screen.getByTestId('board-create')); await screen.findByTestId('dep-failed');
    fireEvent.click(screen.getByTestId('board-create')); await waitFor(() => expect(push).toHaveBeenCalledWith(`/studio/board/${board.id}`));
    expect(api.createBoard).toHaveBeenCalledTimes(2); expect(vi.mocked(api.createBoard).mock.calls[0]![0]).toEqual(vi.mocked(api.createBoard).mock.calls[1]![0]);
  });
  it('debounces server search and sends stable tag ids as an AND filter', async () => {
    render(<WhiteboardLibrary />); await screen.findByTestId('empty'); fireEvent.change(screen.getByTestId('board-search'), { target: { value: '  journey  ' } }); fireEvent.click(screen.getByTestId(`board-filter-tag-${tag.id}`));
    await waitFor(() => expect(api.listBoards).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'journey', tagIds: [tag.id], archived: 'active' })), { timeout: 1200 });
  });
  it('opens editor from the card while the three-dot menu stays action-only', async () => {
    vi.mocked(api.listBoards).mockResolvedValue(result([board])); render(<WhiteboardLibrary />);
    expect(await screen.findByTestId(`board-open-${board.id}`)).toHaveAttribute('href', `/studio/board/${board.id}`);
    await openMenu(); fireEvent.click(await screen.findByTestId(`board-action-rename-${board.id}`)); expect(await screen.findByTestId('board-rename-dialog')).toBeInTheDocument(); expect(push).not.toHaveBeenCalled();
  });
  it('updates board tags with the current CAS revision', async () => {
    vi.mocked(api.listBoards).mockResolvedValue(result([board])); render(<WhiteboardLibrary />); await openMenu(); fireEvent.click(await screen.findByTestId(`board-action-tags-${board.id}`));
    fireEvent.click(await screen.findByRole('checkbox')); fireEvent.click(screen.getByTestId('board-tags-save'));
    await waitFor(() => expect(api.updateBoard).toHaveBeenCalledWith(board.id, { tagIds: [], expectedTagsRevision: 2 }));
  });
  it('creates, renames and confirms deletion of catalog tags with revision guards', async () => {
    const renamed = { ...tag, name: '洞察', revision: 2 };
    vi.mocked(api.createBoardTag).mockResolvedValue({ ...tag, id: '59a39eb5-0d5a-4590-9870-c212e162ae11', name: '产品' });
    vi.mocked(api.renameBoardTag).mockResolvedValue(renamed); vi.mocked(api.deleteBoardTag).mockResolvedValue({ requestId: '4a2f9d8f-9f18-41b2-921a-a64905c757ca', tagId: tag.id, deleted: true });
    render(<WhiteboardLibrary />); await screen.findByTestId('empty'); fireEvent.click(screen.getByTestId('board-tag-catalog'));
    fireEvent.change(screen.getByTestId('board-tag-name'), { target: { value: '产品' } }); fireEvent.click(screen.getByTestId('board-tag-create'));
    await waitFor(() => expect(api.createBoardTag).toHaveBeenCalledWith(expect.objectContaining({ name: '产品' })));
    const researchName = screen.getByLabelText('研究 标签名称'); fireEvent.change(researchName, { target: { value: '洞察' } }); fireEvent.click(researchName.closest('li')!.querySelector('button')!);
    await waitFor(() => expect(api.renameBoardTag).toHaveBeenCalledWith(tag.id, expect.objectContaining({ name: '洞察', expectedRevision: 1 })));
    const insightRow = (await screen.findByLabelText('洞察 标签名称')).closest('li')!; fireEvent.click(insightRow.querySelectorAll('button')[1]!); fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(api.deleteBoardTag).toHaveBeenCalledWith(tag.id, expect.objectContaining({ expectedRevision: 2 })));
  });
  it('duplicates with a durable retry id', async () => {
    vi.mocked(api.listBoards).mockResolvedValue(result([board]));
    vi.mocked(api.duplicateBoard).mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce({ board: { ...board, id: '18b458a2-1065-44d2-ae74-02fdab5afbd2' }, receipt: { requestId: '4a2f9d8f-9f18-41b2-921a-a64905c757ca', sourceBoardId: board.id, sourceEpoch: 1, sourceSeq: 3, objectCount: 2, connectorCount: 1, assetCount: 0 } });
    render(<WhiteboardLibrary />); await openMenu(); fireEvent.click(await screen.findByTestId(`board-action-duplicate-${board.id}`)); fireEvent.click(await screen.findByTestId('board-dialog-confirm')); await screen.findByTestId('dep-failed'); fireEvent.click(screen.getByTestId('board-dialog-confirm'));
    await waitFor(() => expect(api.duplicateBoard).toHaveBeenCalledTimes(2)); expect(vi.mocked(api.duplicateBoard).mock.calls[0]![1].requestId).toBe(vi.mocked(api.duplicateBoard).mock.calls[1]![1].requestId);
  });
  it('deletes only archived boards with explicit confirmation', async () => {
    const archived = { ...board, archived: true }; vi.mocked(api.listBoards).mockResolvedValue(result([archived])); vi.mocked(api.deleteBoard).mockResolvedValue({ requestId: '4a2f9d8f-9f18-41b2-921a-a64905c757ca', boardId: board.id, deleted: true });
    render(<WhiteboardLibrary />); fireEvent.click(await screen.findByTestId('board-filter-archived')); await openMenu(archived); fireEvent.click(await screen.findByTestId(`board-action-delete-${board.id}`)); fireEvent.click(await screen.findByTestId('board-dialog-confirm'));
    await waitFor(() => expect(api.deleteBoard).toHaveBeenCalledWith(board.id, expect.objectContaining({ confirmation: 'PERMANENTLY_DELETE' })));
  });
  it('hides mutating actions from viewers and redacts dependency detail', async () => {
    const viewer = { ...board, role: 'viewer' as const }; vi.mocked(api.listBoards).mockResolvedValueOnce(result([viewer])); render(<WhiteboardLibrary />); await openMenu(viewer);
    expect(screen.queryByTestId(`board-action-rename-${board.id}`)).not.toBeInTheDocument(); cleanup(); vi.mocked(api.listBoards).mockRejectedValue(new ApiError(403, 'private', {})); render(<WhiteboardLibrary />); expect(await screen.findByTestId('denied')).not.toHaveTextContent('private');
  });
  it('returns focus to the originating menu trigger when a dialog closes', async () => {
    vi.mocked(api.listBoards).mockResolvedValue(result([board])); render(<WhiteboardLibrary />); await openMenu(); fireEvent.click(await screen.findByTestId(`board-action-rename-${board.id}`));
    fireEvent.click(await screen.findByRole('button', { name: '取消' })); await waitFor(() => expect(screen.getByTestId(`board-menu-${board.id}`)).toHaveFocus());
  });
});
