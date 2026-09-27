import type { Page } from '@playwright/test';

const types = new Set(['hello', 'update', 'restore-deletion', 'awareness', 'sync', 'ack', 'error', 'recovery', 'presence']);
/** Whitelist only transport metadata; never return payloads, credentials, URLs or error text. */
export function spatialFrameMetadata(payload: string | Buffer) {
  try {
    const value: unknown = JSON.parse(payload.toString());
    if (!value || typeof value !== 'object') return { type: 'invalid' };
    const frame = value as Record<string, unknown>;
    return {
      type: typeof frame.type === 'string' && types.has(frame.type) ? frame.type : 'unknown',
      ...(typeof frame.updateId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(frame.updateId) ? { updateId: frame.updateId } : {}),
      ...(typeof frame.seq === 'number' && Number.isSafeInteger(frame.seq) && frame.seq >= 0 ? { seq: frame.seq } : {}),
      ...(typeof frame.code === 'string' && /^[A-Z_]{1,64}$/.test(frame.code) ? { code: frame.code } : {}),
    };
  } catch { return { type: 'invalid' }; }
}

export function createSpatialWsMetadataRecorder() {
  const started = performance.now();
  const events: Array<Record<string, unknown>> = [];
  let dropped = 0, nextSocket = 0;
  const record = (entry: Record<string, unknown>) => {
    if (events.length >= 10_000) { dropped++; return; }
    events.push({ elapsedMs: performance.now() - started, ...entry });
  };
  return {
    observe(page: Page, client: 'original' | 'peer') {
      page.on('websocket', socket => {
        if (!/\/whiteboards\/[^/]+\/sync$/.test(new URL(socket.url()).pathname)) return;
        const socketId = ++nextSocket;
        record({ client, socketId, direction: 'open' });
        socket.on('framesent', frame => record({ client, socketId, direction: 'sent', ...spatialFrameMetadata(frame.payload) }));
        socket.on('framereceived', frame => record({ client, socketId, direction: 'received', ...spatialFrameMetadata(frame.payload) }));
        socket.on('close', () => record({ client, socketId, direction: 'close' }));
        socket.on('socketerror', () => record({ client, socketId, direction: 'socketerror' }));
      });
    },
    snapshot: () => ({ events, dropped }),
  };
}
