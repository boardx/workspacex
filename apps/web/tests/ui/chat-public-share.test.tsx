import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatShareButton } from '@/components/chat/chat-share-button';
import { SharedChatMessages } from '@/components/chat/shared-chat-messages';
const api = vi.hoisted(() => ({ previewChatShare: vi.fn(), listChatShares: vi.fn(), createChatShare: vi.fn(), revokeChatShare: vi.fn() }));
vi.mock('@/lib/chat-share', async (original) => ({ ...await original<typeof import('@/lib/chat-share')>(), ...api }));
const snapshot = { title: '分享测试', messages: [{ authorKind: 'human' as const, text: 'hello', createdAt: '2026-10-13T00:00:00Z', attachments: [] }] };
const preview = { snapshot, revision: 'a'.repeat(64) };
const share = { id: 'share-1', createdAt: '2026-10-13T00:00:00Z', revokedAt: null };
beforeEach(() => {
  vi.clearAllMocks();
  api.previewChatShare.mockResolvedValue(preview);
  api.listChatShares.mockResolvedValue([]);
  api.createChatShare.mockResolvedValue({ share, token: 't'.repeat(43) });
  api.revokeChatShare.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function open() {
  fireEvent.click(screen.getByTestId('chat-share-open'));
  await screen.findByText('分享测试');
}
it('waits for preview, then publishes only on explicit confirmation', async () => {
  let resolve!: (value: typeof preview) => void;
  api.previewChatShare.mockReturnValue(new Promise(r => { resolve = r; }));
  render(<ChatShareButton threadId="one" bearer="account-one" />);
  fireEvent.click(screen.getByTestId('chat-share-open'));
  expect(screen.getByTestId('chat-share-create')).toBeDisabled();
  expect(api.createChatShare).not.toHaveBeenCalled();
  resolve(preview);
  await screen.findByText('分享测试');
  fireEvent.click(screen.getByTestId('chat-share-create'));
  await screen.findByTestId('chat-share-url');
  expect(api.createChatShare).toHaveBeenCalledWith('one', 'account-one', preview.revision, expect.any(AbortSignal));
});
it('reports clipboard failure and revokes the generated link', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
  render(<ChatShareButton threadId="one" bearer="account-one" />);
  await open();
  fireEvent.click(screen.getByTestId('chat-share-create'));
  await screen.findByTestId('chat-share-url');
  fireEvent.click(screen.getByTestId('chat-share-copy'));
  expect(await screen.findByRole('alert')).toHaveTextContent('无法自动复制');
  expect(screen.queryByText('已复制')).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId('chat-share-revoke'));
  await waitFor(() => expect(screen.queryByTestId('chat-share-url')).not.toBeInTheDocument());
  expect(api.revokeChatShare).toHaveBeenCalledWith('one', 'account-one', 'share-1', expect.any(AbortSignal));
});
it.each([{ threadId: 'two', bearer: 'account-one' }, { threadId: 'one', bearer: 'account-two' }])('isolates preview and links on context change: %j', async (next) => {
  const view = render(<ChatShareButton threadId="one" bearer="account-one" />);
  await open();
  fireEvent.click(screen.getByTestId('chat-share-create'));
  await screen.findByTestId('chat-share-url');
  api.previewChatShare.mockReturnValue(new Promise(() => {}));
  view.rerender(<ChatShareButton {...next} />);
  expect(screen.queryByTestId('chat-share-url')).not.toBeInTheDocument();
  expect(screen.queryByText('分享测试')).not.toBeInTheDocument();
  expect(screen.getByTestId('chat-share-create')).toBeDisabled();
});
it('reads anonymous snapshots without credentials or bearer headers', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ snapshot, createdAt: share.createdAt }) });
  vi.stubGlobal('fetch', fetchMock);
  const { readChatShare } = await import('@/lib/chat-share');
  await readChatShare('t'.repeat(43));
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/chat/shares/'), expect.objectContaining({ credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }));
  expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('headers');
});
it('does not execute raw HTML or javascript Markdown URLs', () => {
  const view = render(<SharedChatMessages snapshot={{ ...snapshot, messages: [{ authorKind: 'human', createdAt: '2026-10-13T00:00:00Z', attachments: [], text: '<script>window.pwned=true</script>\n<img src=x onerror="window.pwned=true">\n[evil](javascript:alert(1))' }] }} />);
  expect(view.container.querySelector('script')).toBeNull();
  expect(view.container.querySelector('[onerror]')).toBeNull();
  expect(view.container.querySelector('a[href^="javascript:"]')).toBeNull();
});

it.each(['before replacement', 'after replacement'])('does not apply late clipboard success %s', async (completion) => {
  let finishCopy!: () => void;
  const writeText = vi.fn(() => new Promise<void>(resolve => { finishCopy = resolve; }));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  api.createChatShare.mockResolvedValueOnce({ share, token: 't'.repeat(43) })
    .mockResolvedValueOnce({ share: { ...share, id: 'share-2' }, token: 'u'.repeat(43) });
  render(<ChatShareButton threadId="one" bearer="account-one" />);
  await open();
  fireEvent.click(screen.getByTestId('chat-share-create'));
  await screen.findByTestId('chat-share-url');
  fireEvent.click(screen.getByTestId('chat-share-copy'));
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('t'.repeat(43)));
  fireEvent.click(screen.getByTestId('chat-share-revoke'));
  await waitFor(() => expect(screen.queryByTestId('chat-share-url')).not.toBeInTheDocument());
  if (completion === 'before replacement') await act(async () => { finishCopy(); });
  fireEvent.click(screen.getByTestId('chat-share-create'));
  await screen.findByTestId('chat-share-url');
  if (completion === 'after replacement') await act(async () => { finishCopy(); });
  expect((screen.getByTestId('chat-share-url') as HTMLInputElement).value).toContain('u'.repeat(43));
  expect(screen.getByTestId('chat-share-copy')).toHaveTextContent('复制链接');
  expect(screen.queryByText('已复制')).not.toBeInTheDocument();
});
