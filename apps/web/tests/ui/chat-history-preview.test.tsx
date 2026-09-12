import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { Message } from '@ag-ui/core';
import { useChatHistoryPreview } from '@/lib/use-chat-history-preview';
const messages = [{ id: 'a', role: 'user' as const, content: 'only A', authorId: "user", agentRunId: null, clientMessageId: null, rateable: false }];
function agent() { const value = { messages: [] as Message[], setMessages: vi.fn((messages: Message[]) => { value.messages = messages; }) }; return value; }
describe('visited history preview', () => {
  it('restores only the visited target before paint and still permits revocation', () => {
    const a = agent(); const first = renderHook(() => useChatHistoryPreview('user-one', 'A', a, true, vi.fn()));
    first.result.current.remember(messages); first.unmount();
    const b = agent(); const other = renderHook(() => useChatHistoryPreview('user-one', 'B', b, true, vi.fn()));
    expect(b.setMessages).not.toHaveBeenCalled(); other.unmount();
    const back = agent(); const loading = vi.fn();
    const revisit = renderHook(() => useChatHistoryPreview('user-one', 'A', back, true, loading));
    expect(back.setMessages).toHaveBeenCalledWith([{ id: 'a', role: 'user', content: 'only A' }]);
    expect(loading).toHaveBeenCalledWith(false);
    back.messages.push({ id: 'new', role: 'user', content: 'new live message' });
    revisit.result.current.discard(); expect(back.setMessages).toHaveBeenLastCalledWith([{ id: 'new', role: 'user', content: 'new live message' }]);
  });
  it('does not resurrect history across logout or organization/session changes', () => {
    const first = renderHook(() => useChatHistoryPreview('old-session-org', 'A', agent(), true, vi.fn()));
    const late = first.result.current.remember; first.unmount();
    const second = renderHook(() => useChatHistoryPreview('new-session-org', 'A', agent(), true, vi.fn()));
    late(messages); second.unmount();
    const back = agent(); renderHook(() => useChatHistoryPreview('old-session-org', 'A', back, true, vi.fn()));
    expect(back.setMessages).not.toHaveBeenCalled();
  });
});
