import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Request } from 'express';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterEach, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { createWhiteboardDocument } from '@repo/whiteboard-core';
import * as Y from 'yjs';
import { WHITEBOARD_SYNC, WhiteboardServerMessage } from '@repo/contracts/whiteboard-sync';
import { WhiteboardController } from '../../src/interface/controllers/whiteboard.controller';
import { traceMiddleware } from '../../src/interface/middleware/trace';
import { AllExceptionsFilter } from '../../src/interface/filters/all-exceptions.filter';
import { DUPLICATE_BOARD_SERVICE, WHITEBOARD_REPOSITORY, type WhiteboardRepository } from '../../src/application/whiteboard/ports';
import { WHITEBOARD_COLLABORATION_STORE, WHITEBOARD_COMMENT_STORE, WHITEBOARD_RECOVERY_SERVICE, type WhiteboardCollaborationStore } from '../../src/application/whiteboard/collaboration-ports';
import { attachWhiteboardGateway } from '../../src/interface/ws/whiteboard.gateway';
import { WorkerWhiteboardUpdateValidator } from '../../src/infrastructure/whiteboard/update-validator';
import { ConsoleLogger } from '../../src/infrastructure/logging/console-logger';
import { toOrgId } from '../../src/domain/org-id';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { try { for (const close of cleanup.reverse()) await close(); } finally { cleanup.length = 0; vi.restoreAllMocks(); } });
const principal = { userId: 'isolated-trace-user', orgId: toOrgId('isolated-trace-org') };
const pause = () => new Promise(resolve => setTimeout(resolve, 15));
async function failTwice() {
  await pause();
  const failures = await Promise.allSettled([0, 1].map(() => new WorkerWhiteboardUpdateValidator(0).diff(new Uint8Array([0, 0]))));
  const failed = failures[0]!;
  if (failed.status !== 'rejected') throw new Error('expected bounded validator rejection');
  throw failed.reason;
}

it('joins concurrent HTTP validator calls to the real middleware/filter trace despite controller exception wrapping', async () => {
  const logs = vi.spyOn(ConsoleLogger.prototype, 'error').mockImplementation(() => undefined);
  const app = await NestFactory.create<NestExpressApplication>({ module: class TraceFixture {}, controllers: [WhiteboardController], providers: [
    { provide: DUPLICATE_BOARD_SERVICE, useValue: {} }, { provide: WHITEBOARD_REPOSITORY, useValue: {} },
    { provide: WHITEBOARD_COLLABORATION_STORE, useValue: { writeCommands: failTwice } },
    { provide: WHITEBOARD_COMMENT_STORE, useValue: {} }, { provide: WHITEBOARD_RECOVERY_SERVICE, useValue: {} },
  ] }, { logger: false, abortOnError: false });
  cleanup.push(() => app.close());
  app.use(traceMiddleware);
  // Explicit identity fixture; exercises the real controller and error boundary, not login.
  app.use((req: Request & { principal?: typeof principal }, _res: unknown, next: () => void) => { req.principal = principal; next(); });
  app.useGlobalFilters(new AllExceptionsFilter(new ConsoleLogger(), { record: async () => undefined, list: async () => ({ items: [], hasMore: false }), getLifecycle: async () => null, updateLifecycle: async () => null }));
  await app.listen(0, '127.0.0.1');
  const requestIds = [randomUUID(), randomUUID()];
  const responses = await Promise.all(requestIds.map(requestId => fetch(`${originOf(app)}/whiteboards/${randomUUID()}/commands`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-trace-id': 'PRIVATE_CLIENT_TRACE' },
    body: JSON.stringify({ requestId, epoch: 1, commands: [{ type: 'delete', id: 'PRIVATE_OBJECT' }] }),
  })));
  const traces = new Set<string>();
  for (const response of responses) {
    expect(response.status).toBe(503);
    const traceId = response.headers.get('x-trace-id')!; traces.add(traceId);
    expect(await response.json()).toEqual({ error: 'dependency_unavailable', traceId });
    expect(traceId).toMatch(/^[0-9a-f-]{36}$/);
    const diagnostic = logs.mock.calls.filter(([name, fields]) => name === 'whiteboard_validator_unavailable' && fields.traceId === traceId);
    expect(diagnostic).toHaveLength(2);
    expect(new Set(diagnostic.map(([, fields]) => (fields.err as { validatorCallId: string }).validatorCallId)).size).toBe(2);
    expect(logs.mock.calls.some(([name, fields]) => name === 'http exception' && fields.traceId === traceId)).toBe(true);
  }
  expect(traces.size).toBe(2);
  expect(JSON.stringify(logs.mock.calls)).not.toMatch(/PRIVATE_CLIENT_TRACE|PRIVATE_OBJECT/);
});
function originOf(app: NestExpressApplication) { return `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`; }

it.each([false, true])('joins queued WebSocket failures without changing frames when the enclosing log sink throws=%s', async sinkThrows => {
  const logs = vi.spyOn(ConsoleLogger.prototype, 'error').mockImplementation(name => {
    if (sinkThrows && name === 'whiteboard_operation_failed') throw new Error('PRIVATE_LOG_SINK');
  });
  const doc = createWhiteboardDocument(); cleanup.push(async () => doc.destroy());
  const state = { epoch: 1, seq: 0, role: 'owner', archived: false };
  const store = { head: async () => state, load: async () => { await pause(); return { ...state, update: Y.encodeStateAsUpdate(doc) }; }, append: failTwice } as unknown as WhiteboardCollaborationStore;
  const boardId = randomUUID();
  const boards = { get: async () => ({ id: boardId, role: 'owner', archived: false }) } as unknown as WhiteboardRepository;
  const server = createServer();
  cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  attachWhiteboardGateway(server, { store, boards, principals: { resolve: async () => principal }, logger: new ConsoleLogger() });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const sockets = [0, 1].map(() => new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/whiteboards/${boardId}/sync`, [WHITEBOARD_SYNC.protocol, `${WHITEBOARD_SYNC.bearerSubprotocolPrefix}isolated-token`]));
  cleanup.push(async () => { for (const ws of sockets) ws.terminate(); });
  const messages: Array<Array<ReturnType<typeof WhiteboardServerMessage.parse>>> = sockets.map(() => []);
  await Promise.all(sockets.map((ws, index) => new Promise<void>((resolve, reject) => {
    ws.on('message', bytes => messages[index]!.push(WhiteboardServerMessage.parse(JSON.parse(bytes.toString()))));
    ws.once('open', resolve); ws.once('error', reject);
  })));
  for (const ws of sockets) {
    ws.send(JSON.stringify({ type: 'hello', stateVector: Buffer.from(Y.encodeStateVector(doc)).toString('base64') }));
    ws.send(JSON.stringify({ type: 'update', epoch: 1, updateId: randomUUID(), gestureId: randomUUID(), update: Buffer.from([0, 0]).toString('base64') }));
  }
  await expect.poll(() => messages.map(items => items.some(item => item.type === 'error'))).toEqual([true, true]);
  const enclosing = logs.mock.calls.filter(([name]) => name === 'whiteboard_operation_failed');
  expect(enclosing).toHaveLength(2);
  expect(new Set(enclosing.map(([, fields]) => fields.traceId)).size).toBe(2);
  for (const [, fields] of enclosing) {
    const diagnostic = logs.mock.calls.filter(([name, detail]) => name === 'whiteboard_validator_unavailable' && detail.traceId === fields.traceId);
    expect(diagnostic).toHaveLength(2);
    expect(new Set(diagnostic.map(([, detail]) => (detail.err as { validatorCallId: string }).validatorCallId)).size).toBe(2);
  }
  for (const items of messages) {
    expect(items[0]?.type).toBe('sync');
    expect(items.find(item => item.type === 'error')).toEqual({ type: 'error', code: 'VALIDATOR_UNAVAILABLE', recoverable: true });
  }
  expect(JSON.stringify(logs.mock.calls)).not.toMatch(/isolated-token|isolated-trace-user|isolated-trace-org|PRIVATE_LOG_SINK/);
});

it('uses unique call IDs as fallback traces outside HTTP/WS without retaining a previous operation', async () => {
  const logs = vi.spyOn(ConsoleLogger.prototype, 'error').mockImplementation(() => undefined);
  const results = await Promise.allSettled([0, 1].map(() => new WorkerWhiteboardUpdateValidator(0).diff(new Uint8Array([0, 0]))));
  expect(results.map(result => result.status)).toEqual(['rejected', 'rejected']);
  expect(logs).toHaveBeenCalledTimes(2);
  for (const [, fields] of logs.mock.calls) {
    expect(fields.traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect((fields.err as { validatorCallId: string }).validatorCallId).toBe(fields.traceId);
  }
  expect(new Set(logs.mock.calls.map(([, fields]) => fields.traceId)).size).toBe(2);
});
