import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@/lib/api-client';
import { listBoards } from '@/lib/live-whiteboard';

vi.mock('@/lib/api-client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>();
  return { ...actual, apiRequest: vi.fn() };
});

describe('live whiteboard library client', () => {
  beforeEach(() => vi.resetAllMocks());
  it('serializes AND tag filters as repeated stable UUID query parameters', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ items: [], nextCursor: null });
    const first = '7f2973dc-c5d2-4757-903e-44e421aa3c28', second = '59a39eb5-0d5a-4590-9870-c212e162ae11';
    await listBoards({ query: 'journey', tagIds: [first, second], archived: 'active', limit: 30 });
    const path = vi.mocked(apiRequest).mock.calls[0]![0];
    expect(path).toContain('query=journey'); expect(path).toContain(`tagIds=${first}`); expect(path).toContain(`tagIds=${second}`);
    expect(path.match(/tagIds=/g)).toHaveLength(2);
  });
});
