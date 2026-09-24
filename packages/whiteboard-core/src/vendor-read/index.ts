import {
  EXTERNAL_BOARD_IMPORT,
  ExternalBoardSnapshot,
  type ExternalBoardSnapshot as ExternalBoardSnapshotValue,
} from '@repo/contracts/whiteboard-migration';

export type VendorProvider = 'miro' | 'mural';
export type VendorReadErrorCode =
  | 'INVALID_INPUT'
  | 'CREDENTIALS_UNAVAILABLE'
  | 'AUTH_FAILED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'NETWORK_ERROR'
  | 'UPSTREAM_ERROR'
  | 'INVALID_RESPONSE'
  | 'PAGINATION_LOOP'
  | 'PAGINATION_LIMIT_EXCEEDED'
  | 'OBJECT_LIMIT_EXCEEDED';

export type VendorReadResult =
  | { ok: true; snapshot: ExternalBoardSnapshotValue }
  | { ok: false; provider: VendorProvider; code: VendorReadErrorCode; status?: number; retryAfterMs?: number };

export type VendorReadDependencies = {
  fetch: typeof globalThis.fetch;
  /** Resolve a short-lived secret from the caller's credential boundary. The reader never persists it. */
  getAccessToken: () => Promise<string>;
  now?: () => Date;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
};

export type VendorReadOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  maxRetryDelayMs?: number;
  maxObjects?: number;
  maxPages?: number;
};

type ReadContext = {
  provider: VendorProvider;
  token: string;
  dependencies: VendorReadDependencies;
  options: Required<Omit<VendorReadOptions, 'signal'>> & Pick<VendorReadOptions, 'signal'>;
};

type RequestResult =
  | { ok: true; value: unknown }
  | Exclude<VendorReadResult, { ok: true }>;

const DEFAULT_OPTIONS: Required<Omit<VendorReadOptions, 'signal'>> = {
  timeoutMs: 10_000,
  maxRetries: 2,
  maxRetryDelayMs: 30_000,
  maxObjects: EXTERNAL_BOARD_IMPORT.maxObjects,
  maxPages: 200,
};

export async function readMiroBoardSnapshot(
  input: { boardId: string },
  dependencies: VendorReadDependencies,
  rawOptions: VendorReadOptions = {},
): Promise<VendorReadResult> {
  const context = await createContext('miro', dependencies, rawOptions);
  if (!context.ok) return context.result;
  if (!validId(input.boardId)) return failure('miro', 'INVALID_INPUT');

  const encodedId = encodeURIComponent(input.boardId);
  const metadata = await requestJson(context.value, `https://api.miro.com/v2/boards/${encodedId}`);
  if (!metadata.ok) return metadata;
  const board = record(metadata.value);
  if (!board || board.id !== input.boardId || !validName(board.name)) return failure('miro', 'INVALID_RESPONSE');

  const items: unknown[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < context.value.options.maxPages; page += 1) {
    const url = new URL(`https://api.miro.com/v2-experimental/boards/${encodedId}/items`);
    url.searchParams.set('limit', '50');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await requestJson(context.value, url.toString());
    if (!response.ok) return response;
    const body = record(response.value);
    if (!body || !Array.isArray(body.data)) return failure('miro', 'INVALID_RESPONSE');
    if (items.length + body.data.length > context.value.options.maxObjects) return failure('miro', 'OBJECT_LIMIT_EXCEEDED');
    items.push(...body.data);
    const next = optionalToken(body.cursor);
    if (next === null) return failure('miro', 'INVALID_RESPONSE');
    if (!next) return snapshotResult({
      format: 'miro.rest.board-snapshot', schemaVersion: 1, exportedAt: now(context.value).toISOString(),
      board: { id: input.boardId, name: board.name }, pages: [{ id: `${input.boardId}:items`, items }],
    }, 'miro');
    if (seen.has(next)) return failure('miro', 'PAGINATION_LOOP');
    seen.add(next);
    cursor = next;
  }
  return failure('miro', 'PAGINATION_LIMIT_EXCEEDED');
}

export async function readMuralBoardSnapshot(
  input: { muralId: string },
  dependencies: VendorReadDependencies,
  rawOptions: VendorReadOptions = {},
): Promise<VendorReadResult> {
  const context = await createContext('mural', dependencies, rawOptions);
  if (!context.ok) return context.result;
  if (!validId(input.muralId)) return failure('mural', 'INVALID_INPUT');

  const encodedId = encodeURIComponent(input.muralId);
  const metadata = await requestJson(context.value, `https://app.mural.co/api/public/v1/murals/${encodedId}`);
  if (!metadata.ok) return metadata;
  const mural = record(metadata.value);
  const name = mural && (validName(mural.title) ? mural.title : validName(mural.name) ? mural.name : undefined);
  if (!mural || mural.id !== input.muralId || !name) return failure('mural', 'INVALID_RESPONSE');

  const widgets: unknown[] = [];
  const seen = new Set<string>();
  let nextToken: string | undefined;
  for (let page = 0; page < context.value.options.maxPages; page += 1) {
    const url = new URL(`https://app.mural.co/api/public/v1/murals/${encodedId}/widgets`);
    url.searchParams.set('limit', '100');
    if (nextToken) url.searchParams.set('next', nextToken);
    const response = await requestJson(context.value, url.toString());
    if (!response.ok) return response;
    const body = record(response.value);
    if (!body || !Array.isArray(body.value)) return failure('mural', 'INVALID_RESPONSE');
    if (widgets.length + body.value.length > context.value.options.maxObjects) return failure('mural', 'OBJECT_LIMIT_EXCEEDED');
    widgets.push(...body.value);
    const next = optionalToken(body.next);
    if (next === null) return failure('mural', 'INVALID_RESPONSE');
    if (!next) return snapshotResult({
      format: 'mural.public-api.mural-snapshot', schemaVersion: 1, exportedAt: now(context.value).toISOString(),
      drawingsIncluded: false, mural: { id: input.muralId, name }, pages: [{ id: `${input.muralId}:widgets`, widgets }],
    }, 'mural');
    if (seen.has(next)) return failure('mural', 'PAGINATION_LOOP');
    seen.add(next);
    nextToken = next;
  }
  return failure('mural', 'PAGINATION_LIMIT_EXCEEDED');
}

async function createContext(
  provider: VendorProvider,
  dependencies: VendorReadDependencies,
  rawOptions: VendorReadOptions,
): Promise<{ ok: true; value: ReadContext } | { ok: false; result: Exclude<VendorReadResult, { ok: true }> }> {
  if (rawOptions.signal?.aborted) return { ok: false, result: failure(provider, 'CANCELLED') };
  if (!validOptions(rawOptions)) return { ok: false, result: failure(provider, 'INVALID_INPUT') };
  let token: string;
  try { token = await dependencies.getAccessToken(); }
  catch { return { ok: false, result: failure(provider, 'CREDENTIALS_UNAVAILABLE') }; }
  if (!token.trim()) return { ok: false, result: failure(provider, 'CREDENTIALS_UNAVAILABLE') };
  return {
    ok: true,
    value: {
      provider,
      token,
      dependencies,
      options: {
        timeoutMs: rawOptions.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs,
        maxRetries: rawOptions.maxRetries ?? DEFAULT_OPTIONS.maxRetries,
        maxRetryDelayMs: rawOptions.maxRetryDelayMs ?? DEFAULT_OPTIONS.maxRetryDelayMs,
        maxObjects: rawOptions.maxObjects ?? DEFAULT_OPTIONS.maxObjects,
        maxPages: rawOptions.maxPages ?? DEFAULT_OPTIONS.maxPages,
        signal: rawOptions.signal,
      },
    },
  };
}

async function requestJson(context: ReadContext, url: string): Promise<RequestResult> {
  for (let attempt = 0; attempt <= context.options.maxRetries; attempt += 1) {
    if (context.options.signal?.aborted) return failure(context.provider, 'CANCELLED');
    const controller = new AbortController();
    let timedOut = false;
    const cancel = (): void => controller.abort();
    context.options.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, context.options.timeoutMs);
    let response: Response;
    try {
      response = await context.dependencies.fetch(url, {
        method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${context.token}` }, signal: controller.signal,
      });
    } catch {
      if (context.options.signal?.aborted) return failure(context.provider, 'CANCELLED');
      if (timedOut) return failure(context.provider, 'TIMEOUT');
      return failure(context.provider, 'NETWORK_ERROR');
    } finally {
      clearTimeout(timer);
      context.options.signal?.removeEventListener('abort', cancel);
    }

    if (response.status === 429) {
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), now(context));
      if (attempt >= context.options.maxRetries) return { ...failure(context.provider, 'RATE_LIMITED', 429), retryAfterMs };
      const delay = Math.min(retryAfterMs ?? 1_000 * (2 ** attempt), context.options.maxRetryDelayMs);
      const slept = await sleep(context, delay);
      if (!slept) return failure(context.provider, 'CANCELLED');
      continue;
    }
    if (!response.ok) return classifyStatus(context.provider, response.status);
    try { return { ok: true, value: await response.json() as unknown }; }
    catch { return failure(context.provider, 'INVALID_RESPONSE'); }
  }
  return failure(context.provider, 'RATE_LIMITED');
}

async function sleep(context: ReadContext, delayMs: number): Promise<boolean> {
  if (context.options.signal?.aborted) return false;
  const signal = context.options.signal;
  const sleeper = context.dependencies.sleep ?? abortableDelay;
  let cancel: (() => void) | undefined;
  const cancelled = signal && new Promise<void>(resolve => {
    cancel = (): void => resolve();
    signal.addEventListener('abort', cancel, { once: true });
  });
  try { await (cancelled ? Promise.race([sleeper(delayMs, signal), cancelled]) : sleeper(delayMs, signal)); }
  catch { return false; }
  finally { if (cancel) signal?.removeEventListener('abort', cancel); }
  return !context.options.signal?.aborted;
}

function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
    timer = setTimeout(finish, delayMs);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

function snapshotResult(snapshot: unknown, provider: VendorProvider): VendorReadResult {
  const parsed = ExternalBoardSnapshot.safeParse(snapshot);
  return parsed.success ? { ok: true, snapshot: parsed.data } : failure(provider, 'INVALID_RESPONSE');
}

function classifyStatus(provider: VendorProvider, status: number): Exclude<VendorReadResult, { ok: true }> {
  if (status === 401) return failure(provider, 'AUTH_FAILED', status);
  if (status === 403) return failure(provider, 'FORBIDDEN', status);
  if (status === 404) return failure(provider, 'NOT_FOUND', status);
  return failure(provider, 'UPSTREAM_ERROR', status);
}

function failure(provider: VendorProvider, code: VendorReadErrorCode, status?: number): Exclude<VendorReadResult, { ok: true }> {
  return status === undefined ? { ok: false, provider, code } : { ok: false, provider, code, status };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function optionalToken(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  return typeof value === 'string' && value.length <= 4_096 ? value : null;
}

function validId(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= 256; }
function validName(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= 200; }
function validOptions(options: VendorReadOptions): boolean {
  const values = [options.timeoutMs, options.maxRetries, options.maxRetryDelayMs, options.maxObjects, options.maxPages];
  if (values.some(value => value !== undefined && (!Number.isInteger(value) || value < 0))) return false;
  return (options.timeoutMs ?? 1) > 0 && (options.maxRetryDelayMs ?? 1) > 0 && (options.maxPages ?? 1) > 0
    && (options.maxObjects ?? 0) <= EXTERNAL_BOARD_IMPORT.maxObjects && (options.maxRetries ?? 0) <= 10;
}

function now(context: ReadContext): Date { return context.dependencies.now?.() ?? new Date(); }
function parseRetryAfter(value: string | null, current: Date): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - current.getTime()) : undefined;
}
