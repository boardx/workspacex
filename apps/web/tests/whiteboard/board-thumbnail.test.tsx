import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { BoardThumbnail, BoardThumbnailQueue } from '@/components/whiteboard/board-thumbnail';
import { apiRequest, getStoredSessionToken } from '@/lib/api-client';
import { readReadonlyBoardSnapshot } from '@/lib/whiteboard-readonly-snapshot';
import { renderCanonicalBoardImage } from '@/components/whiteboard/board-canonical-image';
import { createWhiteboardDocument, createStickyBatchEnvelope, BoardCommandPort, readObjects } from '@repo/whiteboard-core';
vi.mock('@/lib/api-client', () => ({ apiRequest: vi.fn(), getStoredSessionToken: vi.fn() }));
vi.mock('@/components/whiteboard/board-canonical-image', () => ({ renderCanonicalBoardImage: vi.fn() }));
vi.mock('@/lib/whiteboard-readonly-snapshot', () => ({ readReadonlyBoardSnapshot: vi.fn() }));
const id = '57d83843-21e2-40ae-8c1c-571d0ad63c80';
function snapshot(seq = 1) {
  const doc = createWhiteboardDocument();
  new BoardCommandPort(doc).dispatch(createStickyBatchEnvelope({ boardId: id, clientId: 'test', gestureId: 'op', items: [{id:'sticky-1',text:'Thumbnail content',geometry:{x:30,y:40,width:200,height:160,rotation:0}}], color: {custom:'#FFF0A0'} }));
  const objects = readObjects(doc); doc.destroy();
  return { boardId: id, revision: { epoch: 1, seq }, role: 'viewer' as const, archived: false, objects };
}
function protocol(value = snapshot()) {
  vi.mocked(apiRequest).mockResolvedValue(value.revision);
  vi.mocked(readReadonlyBoardSnapshot).mockResolvedValue(value);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getStoredSessionToken).mockReturnValue('private-token');
  protocol();
  vi.mocked(renderCanonicalBoardImage).mockResolvedValue({ blob: new Blob(['pixels']), width: 640, height: 360, bounds: { x: 0, y: 0, width: 100, height: 100 } });
  vi.stubGlobal('IntersectionObserver', undefined);
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:thumbnail'), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('authorized canonical Board thumbnails', () => {
  it('renders snapshot content and revokes its private object URL on unmount', async () => {
    const queue = new BoardThumbnailQueue('org/user', 'user');
    const view = render(<BoardThumbnail boardId={id} name="团队" revisionHint="1" queue={queue} />);
    expect(await screen.findByRole('img', { name: '团队的白板预览' })).toHaveAttribute('src', 'blob:thumbnail');
    expect(apiRequest).toHaveBeenCalledWith(`/v1/whiteboards/${id}/head`, expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }));
    expect(renderCanonicalBoardImage).toHaveBeenCalledWith(expect.objectContaining({ boardId: id, objects: snapshot().objects, maxWidth: 640, maxHeight: 360, padding: 24 }));
    view.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumbnail');
  });
  it('reauthorizes before cached pixels and rerenders when canonical revision changes', async () => {
    const queue = new BoardThumbnailQueue('org/user', 'user'), signal = new AbortController().signal;
    await queue.load(id, signal); await queue.load(id, signal);
    expect(apiRequest).toHaveBeenCalledTimes(2); expect(renderCanonicalBoardImage).toHaveBeenCalledTimes(1);
    protocol(snapshot(2)); await queue.load(id, signal);
    expect(renderCanonicalBoardImage).toHaveBeenCalledTimes(2);
    vi.mocked(apiRequest).mockRejectedValue(new Error('denied'));
    await expect(queue.load(id, signal)).rejects.toThrow('denied');
  });
  it('never reuses another user scope, renders empty honestly, and hides denied pixels', async () => {
    const signal = new AbortController().signal;
    await new BoardThumbnailQueue('org/user', 'user').load(id, signal);
    await new BoardThumbnailQueue('org/other', 'other').load(id, signal);
    expect(renderCanonicalBoardImage).toHaveBeenCalledTimes(2);
    protocol({ ...snapshot(), objects: [] });
    const view = render(<BoardThumbnail boardId={id} name="团队" revisionHint="1" queue={new BoardThumbnailQueue('org/user', 'user')} />);
    expect(await screen.findByText('空白白板')).toBeInTheDocument();
    vi.mocked(apiRequest).mockRejectedValue(new Error('secret permission detail'));
    view.rerender(<BoardThumbnail boardId={id} name="团队" revisionHint="2" queue={new BoardThumbnailQueue('org/user', 'user')} />);
    expect(await screen.findByText('预览暂时无法加载')).toBeInTheDocument(); expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
  it('does not request invisible cards and limits concurrent snapshot reads to two', async () => {
    let notify!: IntersectionObserverCallback;
    vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { notify = callback; } observe() {} disconnect() {} });
    render(<BoardThumbnail boardId={id} name="团队" revisionHint="1" queue={new BoardThumbnailQueue('org/user', 'user')} />);
    expect(apiRequest).not.toHaveBeenCalled();
    cleanup();
    const pending: Array<(value: unknown) => void> = [];
    const realProtocol = vi.mocked(apiRequest).getMockImplementation()!;
    vi.mocked(apiRequest).mockImplementation((path, opts) => path.endsWith('/head') ? new Promise(resolve => pending.push(resolve)) : realProtocol(path, opts));
    const queue = new BoardThumbnailQueue('org/user', 'user'), signal = new AbortController().signal;
    const loads = [queue.load(id, signal), queue.load(id, signal), queue.load(id, signal)];
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
    pending[0]!(snapshot().revision); await waitFor(() => expect(pending).toHaveLength(3));
    pending[1]!(snapshot().revision); pending[2]!(snapshot().revision); await Promise.all(loads); expect(notify).toBeDefined();
  });
});
