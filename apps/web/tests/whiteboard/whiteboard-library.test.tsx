import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WhiteboardLibrary } from '@/components/whiteboard/whiteboard-library';
import * as api from '@/lib/live-whiteboard';
import { ApiError } from '@/lib/api-client';
vi.mock('@/lib/live-whiteboard', () => ({ listBoards: vi.fn(), createBoard: vi.fn(), getBoard: vi.fn(), updateBoard: vi.fn(), listBoardMembers: vi.fn(), putBoardMember: vi.fn(), removeBoardMember: vi.fn() }));
const board: api.Board = { id: '57d83843-21e2-40ae-8c1c-571d0ad63c80', name: '团队白板', ownerId: 'owner', role: 'owner', archived: false, createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z' };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.listBoards).mockResolvedValue([]); vi.mocked(api.listBoardMembers).mockResolvedValue([]); });
afterEach(cleanup);
describe('Whiteboard resource library', () => {
  it('preserves request ID across uncertain create failure, then shows real returned resource', async () => {
    vi.mocked(api.createBoard).mockRejectedValueOnce(new Error('private server detail')).mockResolvedValueOnce(board);
    render(<WhiteboardLibrary />); await screen.findByTestId('empty');
    fireEvent.change(screen.getByTestId('board-create-name'), { target: { value: '团队白板' } });
    fireEvent.click(screen.getByTestId('board-create')); await screen.findByTestId('dep-failed');
    expect(screen.queryByText('private server detail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('board-create')); await screen.findByTestId('board-detail');
    expect(api.createBoard).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.createBoard).mock.calls[0]![0]).toEqual(vi.mocked(api.createBoard).mock.calls[1]![0]);
    expect(screen.getByTestId('board-detail')).toHaveTextContent(board.id);
    expect(screen.getByTestId('board-detail')).toHaveTextContent('尚未提供画布编辑');
  });
  it.each(['viewer', 'editor'] as const)('%s has no resource management controls', async role => {
    vi.mocked(api.listBoards).mockResolvedValue([{ ...board, role }]); vi.mocked(api.getBoard).mockResolvedValue({ ...board, role });
    render(<WhiteboardLibrary />); fireEvent.click(await screen.findByTestId(`board-open-${board.id}`));
    await screen.findByTestId('board-detail');
    expect(screen.queryByTestId('board-rename')).not.toBeInTheDocument(); expect(screen.queryByTestId('board-member-save')).not.toBeInTheDocument();
    expect(api.listBoardMembers).not.toHaveBeenCalled();
  });
  it('owner can rename, archive/restore and grant/revoke member access', async () => {
    vi.mocked(api.listBoards).mockResolvedValue([board]); vi.mocked(api.getBoard).mockResolvedValue(board);
    vi.mocked(api.updateBoard).mockImplementation(async (_id, input) => ({ ...board, ...input }));
    vi.mocked(api.putBoardMember).mockResolvedValue({ ok: true }); vi.mocked(api.removeBoardMember).mockResolvedValue({ ok: true });
    render(<WhiteboardLibrary />); fireEvent.click(await screen.findByTestId(`board-open-${board.id}`)); await screen.findByTestId('board-detail');
    await waitFor(() => expect(screen.getByTestId('board-rename')).toBeEnabled());
    fireEvent.change(screen.getByTestId('board-rename-name'), { target: { value: '新名称' } }); fireEvent.click(screen.getByTestId('board-rename')); await screen.findByTestId('saved');
    expect(api.updateBoard).toHaveBeenCalledWith(board.id, { name: '新名称' });
    fireEvent.click(screen.getByTestId('board-archive')); await waitFor(() => expect(screen.getByTestId('board-archive')).toHaveTextContent('恢复白板'));
    fireEvent.click(screen.getByTestId('board-archive')); await waitFor(() => expect(screen.getByTestId('board-archive')).toHaveTextContent('归档白板'));
    vi.mocked(api.listBoardMembers).mockResolvedValue([{ userId: 'member-1', role: 'editor' }]);
    fireEvent.change(screen.getByTestId('board-member-user'), { target: { value: 'member-1' } }); fireEvent.change(screen.getByTestId('board-member-role'), { target: { value: 'editor' } }); fireEvent.click(screen.getByTestId('board-member-save'));
    const remove = await screen.findByTestId('board-member-remove-member-1');
    expect(api.putBoardMember).toHaveBeenCalledWith(board.id, { userId: 'member-1', role: 'editor' });
    vi.mocked(api.listBoardMembers).mockResolvedValue([]); fireEvent.click(remove);
    await waitFor(() => expect(screen.queryByTestId('board-member-remove-member-1')).not.toBeInTheDocument());
    expect(api.removeBoardMember).toHaveBeenCalledWith(board.id, 'member-1');
  });
  it('renders real access failure and validates empty names without calling create', async () => {
    vi.mocked(api.listBoards).mockRejectedValueOnce(new ApiError(403, 'secret', {}));
    render(<WhiteboardLibrary />); await screen.findByTestId('denied');
    fireEvent.click(screen.getByTestId('board-create')); await screen.findByTestId('err-board-form'); expect(api.createBoard).not.toHaveBeenCalled();
  });
});
