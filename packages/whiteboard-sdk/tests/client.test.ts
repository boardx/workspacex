import { expect, it, vi } from 'vitest';
import { WhiteboardApiError, WhiteboardAuthenticationError, WhiteboardClient } from '../src';
const id = 'a880ec65-d1eb-4284-bb49-1887660fca01', requestId = '739a25e8-5ea6-4b28-bd47-cf660feee836';
it('uses contract paths, session credentials and preserves a caller-owned retry requestId', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ boardId: id, epoch: 1, seq: 1, requestId, replayed: false, durable: true }));
  const client = new WhiteboardClient('https://example.test/api/', fetcher);
  const input = { epoch: 1, requestId, commands: [{ type: 'delete' as const, id: 'note' }] };
  await client.commands(id, input); await client.commands(id, input);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0]?.[0]).toBe(`https://example.test/api/whiteboards/${id}/commands`);
  const options = fetcher.mock.calls[0]?.[1];
  expect(options).toMatchObject({ credentials: 'omit', method: 'POST' });
  expect(JSON.parse(String(options?.body))).toEqual(input);
});
it('validates response and rejects malformed requests before fetch', async () => {
  const fetcher: typeof fetch = vi.fn(async () => Response.json({ boardId: id, epoch: 1, seq: 0, role: 'viewer', archived: false, objects: [] }));
  const client = new WhiteboardClient('https://example.test', fetcher);
  expect((await client.document(id)).role).toBe('viewer');
  await expect(client.document('not-a-uuid')).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
  const malformed = new WhiteboardClient('https://example.test', async () => Response.json({ token: 'must-not-pass' }));
  await expect(malformed.document(id)).rejects.toThrow();
});
it('does not copy error response secrets into errors or embed credentials in URLs', async () => {
  const client = new WhiteboardClient('https://example.test', async () => new Response('secret upstream detail', { status: 403 }));
  await expect(client.document(id)).rejects.toEqual(new WhiteboardApiError(403));
  expect(() => new WhiteboardClient('https://name:secret@example.test')).toThrow();
});

it('uses a freshly resolved bearer token for each read and write, including rotation', async () => {
  let token = 'session-first';
  const getToken = vi.fn(async () => token);
  const fetcher = vi.fn<typeof fetch>(async (url) => String(url).endsWith('/document')
    ? Response.json({ boardId: id, epoch: 1, seq: 0, role: 'owner', archived: false, objects: [] })
    : Response.json({ boardId: id, epoch: 1, seq: 1, requestId, replayed: false, durable: true }));
  const client = new WhiteboardClient('https://example.test', { fetch: fetcher, getToken });
  await client.document(id); token = 'session-rotated';
  await client.commands(id, { epoch: 1, requestId, commands: [{ type: 'delete', id: 'note' }] });
  expect(getToken).toHaveBeenCalledTimes(2);
  expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer session-first');
  expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('authorization')).toBe('Bearer session-rotated');
  expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('content-type')).toBe('application/json');
  expect(JSON.stringify(client)).not.toContain('session-rotated');
});
it('fails closed on an expired, malformed or unavailable session without exposing provider errors', async () => {
  const fetcher = vi.fn<typeof fetch>();
  for (const getToken of [() => null, () => 'unsafe\r\nInjected: value', () => { throw new Error('secret-provider-detail'); }]) {
    const client = new WhiteboardClient('https://example.test', { fetch: fetcher, getToken });
    await expect(client.document(id)).rejects.toEqual(new WhiteboardAuthenticationError());
  }
  expect(fetcher).not.toHaveBeenCalled();
});
