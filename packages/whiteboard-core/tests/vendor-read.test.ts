import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { convertExternalBoardSnapshot } from '../src/external-import';
import { readMiroBoardSnapshot, readMuralBoardSnapshot, type VendorReadDependencies } from '../src/vendor-read';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const json = (body: unknown, init?: ResponseInit): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
const token = 'secret-access-token';
const packageBoardId = '00000000-0000-4000-8000-000000000042';
const dependencies = (fetch: typeof globalThis.fetch, overrides: Partial<VendorReadDependencies> = {}): VendorReadDependencies => ({
  fetch,
  getAccessToken: async () => token,
  now: () => new Date('2026-09-24T06:00:00.000Z'),
  sleep: async () => undefined,
  ...overrides,
});

describe('vendor board readers', () => {
  it('follows Miro cursors and returns the existing convertible snapshot', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ id: 'board-1', name: 'Miro roadmap' }))
      .mockResolvedValueOnce(json(fixture('miro-items-page-1.json')))
      .mockResolvedValueOnce(json(fixture('miro-items-page-2.json')));

    const result = await readMiroBoardSnapshot({ boardId: 'board-1' }, dependencies(fetch));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.format).toBe('miro.rest.board-snapshot');
    if (result.snapshot.format !== 'miro.rest.board-snapshot') return;
    expect(result.snapshot.pages[0]?.items).toHaveLength(2);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.miro.com/v2/boards/board-1',
      'https://api.miro.com/v2-experimental/boards/board-1/items?limit=50',
      'https://api.miro.com/v2-experimental/boards/board-1/items?limit=50&cursor=cursor-2',
    ]);
    expect(fetch.mock.calls.every(([, init]) => new Headers(init?.headers).get('authorization') === `Bearer ${token}`)).toBe(true);
    expect(convertExternalBoardSnapshot(result.snapshot, { packageBoardId })).toMatchObject({ ok: true, preview: { provider: 'miro', importedObjectCount: 2 } });
  });

  it('follows Mural next tokens and returns the existing convertible snapshot', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ id: 'mural-1', title: 'Mural discovery' }))
      .mockResolvedValueOnce(json(fixture('mural-widgets-page-1.json')))
      .mockResolvedValueOnce(json(fixture('mural-widgets-page-2.json')));

    const result = await readMuralBoardSnapshot({ muralId: 'mural-1' }, dependencies(fetch));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.format).toBe('mural.public-api.mural-snapshot');
    if (result.snapshot.format !== 'mural.public-api.mural-snapshot') return;
    expect(result.snapshot.pages[0]?.widgets).toHaveLength(2);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      'https://app.mural.co/api/public/v1/murals/mural-1',
      'https://app.mural.co/api/public/v1/murals/mural-1/widgets?limit=100',
      'https://app.mural.co/api/public/v1/murals/mural-1/widgets?limit=100&next=next-2',
    ]);
    expect(result.snapshot.drawingsIncluded).toBe(false);
    expect(convertExternalBoardSnapshot(result.snapshot, { packageBoardId })).toMatchObject({ ok: true, preview: { provider: 'mural', importedObjectCount: 2 } });
  });

  it('honors Retry-After with bounded 429 retries', async () => {
    const sleeps: number[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(json({ id: 'board-1', name: 'Miro roadmap' }))
      .mockResolvedValueOnce(json({ data: [] }));
    const result = await readMiroBoardSnapshot({ boardId: 'board-1' }, dependencies(fetch, { sleep: async delay => { sleeps.push(delay); } }));
    expect(result.ok).toBe(true);
    expect(sleeps).toEqual([2_000]);

    const alwaysLimited = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '120' } }));
    const limited = await readMiroBoardSnapshot({ boardId: 'board-1' }, dependencies(alwaysLimited), { maxRetries: 1 });
    expect(limited).toMatchObject({ ok: false, code: 'RATE_LIMITED', provider: 'miro' });
    expect(alwaysLimited).toHaveBeenCalledTimes(2);
  });

  it('classifies cancellation and timeouts without issuing unbounded work', async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const cancelledResult = await readMuralBoardSnapshot({ muralId: 'mural-1' }, dependencies(fetch), { signal: cancelled.signal });
    expect(cancelledResult).toMatchObject({ ok: false, code: 'CANCELLED', provider: 'mural' });
    expect(fetch).not.toHaveBeenCalled();

    const pending = vi.fn<typeof globalThis.fetch>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const timeoutResult = await readMiroBoardSnapshot({ boardId: 'board-1' }, dependencies(pending), { timeoutMs: 5 });
    expect(timeoutResult).toMatchObject({ ok: false, code: 'TIMEOUT', provider: 'miro' });

    const duringBackoff = new AbortController();
    const limited = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('', { status: 429 }));
    const reading = readMuralBoardSnapshot(
      { muralId: 'mural-1' },
      dependencies(limited, { sleep: async () => new Promise<void>(() => undefined) }),
      { signal: duringBackoff.signal },
    );
    duringBackoff.abort();
    await expect(reading).resolves.toMatchObject({ ok: false, code: 'CANCELLED', provider: 'mural' });
  });

  it('rejects pagination loops and object overflow with stable codes', async () => {
    const loopFetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ id: 'mural-1', title: 'Mural' }))
      .mockImplementation(async () => json({ value: [], next: 'same-token' }));
    const loop = await readMuralBoardSnapshot({ muralId: 'mural-1' }, dependencies(loopFetch));
    expect(loop).toMatchObject({ ok: false, code: 'PAGINATION_LOOP', provider: 'mural' });

    const overflowFetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ id: 'board-1', name: 'Miro' }))
      .mockResolvedValueOnce(json(fixture('miro-items-page-1.json')));
    const overflow = await readMiroBoardSnapshot({ boardId: 'board-1' }, dependencies(overflowFetch), { maxObjects: 0 });
    expect(overflow).toMatchObject({ ok: false, code: 'OBJECT_LIMIT_EXCEEDED', provider: 'miro' });

    let page = 0;
    const unboundedFetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ id: 'board-1', name: 'Miro' }))
      .mockImplementation(async () => json({ data: [], cursor: `cursor-${page += 1}` }));
    const bounded = await readMiroBoardSnapshot({ boardId: 'board-1' }, dependencies(unboundedFetch), { maxPages: 2 });
    expect(bounded).toMatchObject({ ok: false, code: 'PAGINATION_LIMIT_EXCEEDED', provider: 'miro' });
    expect(unboundedFetch).toHaveBeenCalledTimes(3);
  });

  it('never exposes an injected access token through errors', async () => {
    const failed = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error(`connection failed for ${token}`));
    const network = await readMiroBoardSnapshot({ boardId: 'board-1' }, dependencies(failed));
    expect(network).toMatchObject({ ok: false, code: 'NETWORK_ERROR', provider: 'miro' });
    expect(JSON.stringify(network)).not.toContain(token);

    const unauthorized = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(token, { status: 401 }));
    const auth = await readMuralBoardSnapshot({ muralId: 'mural-1' }, dependencies(unauthorized));
    expect(auth).toMatchObject({ ok: false, code: 'AUTH_FAILED', provider: 'mural' });
    expect(JSON.stringify(auth)).not.toContain(token);

    const getAccessToken = vi.fn(async () => token);
    const invalid = await readMiroBoardSnapshot({ boardId: '' }, { ...dependencies(failed), getAccessToken });
    expect(invalid).toMatchObject({ ok: false, code: 'INVALID_INPUT', provider: 'miro' });
    expect(getAccessToken).not.toHaveBeenCalled();
  });
});
