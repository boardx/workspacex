/** Run with tsx. Contract-only --check makes no network requests. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { whiteboardOperationOperations as API, WhiteboardOperationActor } from '../../packages/contracts/src/whiteboard-operation';
import { operations as Boards } from '../../packages/contracts/src/whiteboard';
import type { WhiteboardCommand } from '../../packages/contracts/src/whiteboard-document';

const geometry = (x: number, y = 120) => ({ x, y, width: 180, height: 180, rotation: 0 });
const note = (id: string, x: number) => ({ id, schemaVersion: 1 as const, kind: 'sticky' as const, geometry: geometry(x), text: 'Idea', style: {}, parentId: null, orderKey: id });
const a = 'example-a', b = 'example-b', edge = 'example-edge';
export const steps: Array<{ name: string; commands: WhiteboardCommand[] }> = [
  { name: 'Create', commands: [{ type: 'create', object: note(a, 120) }, { type: 'create', object: note(b, 360) }] },
  { name: 'Update text', commands: [{ type: 'text', id: a, index: 0, deleteCount: 4, insert: 'Research' }] },
  { name: 'Move', commands: [{ type: 'geometry', id: a, geometry: geometry(240, 240) }] },
  // Arrange is one operation containing computed geometry commands, not an invented /arrange route.
  { name: 'Arrange row', commands: [{ type: 'geometry', id: a, geometry: geometry(120) }, { type: 'geometry', id: b, geometry: geometry(324) }] },
  { name: 'Connect', commands: [{ type: 'create', object: { ...note(edge, 120), kind: 'connector', text: '', connector: { from: a, to: b, semanticRelation: 'depends_on' } } }] },
  { name: 'Delete endpoint and attached connector', commands: [{ type: 'delete', id: a }] },
];
const provenance = { source: 'public-api' as const, model: null, skill: null, sourceArtifactId: null, sourceRevision: null, layoutHash: null, inputObjectIds: [] };
function envelope(boardId: string, actor: unknown, revision: { epoch: number; seq: number }, commands: WhiteboardCommand[]) {
  return API.execute.input.parse({ apiVersion: '2026-09-01', requestId: randomUUID(), boardId, actor, expectedRevision: revision, commands, provenance });
}
function check() {
  const actor = { kind: 'service', actorId: 'example-service', orgId: 'example-org', delegatedBy: 'example-owner', role: 'owner', scopes: ['board:read', 'board:write'] };
  for (const step of steps) envelope(randomUUID(), actor, { epoch: 1, seq: 0 }, step.commands);
  API.readObjects.input.parse({ actorId: actor.actorId });
  API.events.input.parse({ actorId: actor.actorId, afterEpoch: 1, afterSeq: 0, limit: 100 });
  API.undoOperation.input.parse({ expectedRevision: { epoch: 1, seq: 6 } });
  assert.equal(API.undoOperation.input.safeParse({ expectedRevision: { epoch: 1, seq: 6 }, inverse: [] }).success, false);
  assert.equal(API.execute.input.safeParse({ ...envelope(randomUUID(), actor, { epoch: 1, seq: 0 }, steps[0].commands), commands: [{ type: 'arrange' }] }).success, false);
  console.log('Contract check passed: six command batches, read/events/undo; no HTTP requests executed.');
}
async function run() {
  assert.equal(process.env.BOARD_EXAMPLE_MUTATE, '1', 'Set BOARD_EXAMPLE_MUTATE=1 to create a new demonstration board.');
  const base = new URL(process.env.WORKSPACEX_API_BASE ?? '');
  assert.ok(!base.username && !base.password && !base.search && !base.hash, 'Use a plain API base URL.');
  assert.ok(base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)), 'Use HTTPS except on loopback.');
  const token = process.env.WORKSPACEX_TOKEN; assert.ok(token, 'WORKSPACEX_TOKEN is required.');
  const actor = WhiteboardOperationActor.parse(JSON.parse(await readFile(process.env.BOARD_ACTOR_FILE ?? '', 'utf8')));
  assert.ok(actor.kind === 'service' && actor.scopes.includes('board:read') && actor.scopes.includes('board:write'), 'Use an enabled, delegated service actor with read/write scopes.');
  async function call(method: string, path: string, body?: unknown) {
    const response = await fetch(`${base.href.replace(/\/$/, '')}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    // Never log response bodies, tokens, or automatic retries of an uncertain mutation.
    assert.ok(response.ok, `HTTP ${response.status}; stop and reconcile the last request before retrying.`);
    return response.json();
  }
  const board = Boards.createBoard.out.parse(await call(Boards.createBoard.method, Boards.createBoard.path, Boards.createBoard.in.parse({ requestId: randomUUID(), name: 'Board API example' })));
  console.log(`Created demonstration board ${board.id}; it will remain available for inspection.`);
  const route = (path: string) => path.replace(':boardId', encodeURIComponent(board.id));
  const read = async () => API.readObjects.output.parse(await call(API.readObjects.method, `${route(API.readObjects.path)}?actorId=${encodeURIComponent(actor.actorId)}`));
  let last: ReturnType<typeof API.execute.output.parse> | undefined;
  let beforeDelete: Awaited<ReturnType<typeof read>> | undefined;
  for (const step of steps) {
    const before = await read();
    if (step.name.startsWith('Delete')) beforeDelete = before;
    const input = envelope(board.id, actor, before.revision, step.commands);
    // Keep this exact requestId + body if implementing durable retries. Do not mint a new ID on timeout.
    last = API.execute.output.parse(await call(API.execute.method, route(API.execute.path), input));
    const current = await read();
    assert.deepEqual(current.revision, last.revision, 'Concurrent edits detected; stop instead of overwriting.');
    const objectA = current.objects.find(object => object.id === a);
    if (step.name === 'Create') assert.deepEqual(current.objects.map(object => object.id).sort(), [a, b]);
    if (step.name === 'Update text') assert.equal(objectA?.text, 'Research');
    if (step.name === 'Move') assert.deepEqual(objectA?.geometry, geometry(240, 240));
    if (step.name === 'Arrange row') {
      assert.deepEqual(objectA?.geometry, geometry(120));
      assert.deepEqual(current.objects.find(object => object.id === b)?.geometry, geometry(324));
    }
    if (step.name === 'Connect') assert.equal(current.objects.find(object => object.id === edge)?.connector?.to, b);
    console.log(`${step.name}: acknowledged ${last.operationId}`);
  }
  assert.ok(last && beforeDelete);
  assert.deepEqual((await read()).objects.map(object => object.id), [b]);
  const undo = API.undoOperation.output.parse(await call(API.undoOperation.method, route(API.undoOperation.path).replace(':operationId', last.operationId), API.undoOperation.input.parse({ expectedRevision: last.revision })));
  assert.deepEqual((await read()).objects, beforeDelete.objects, 'Undo must restore original IDs and the connector.');
  // Undo of the Undo receipt is Redo, with the same fresh-head/owner/actor authorization checks.
  console.log(`Undo acknowledged ${undo.operationId}; original IDs restored.`);
  let afterEpoch = 1, afterSeq = 0;
  for (let page = 0; page < 100; page++) {
    const query = new URLSearchParams({ actorId: actor.actorId, afterEpoch: String(afterEpoch), afterSeq: String(afterSeq), limit: '100' });
    const events = API.events.output.parse(await call(API.events.method, `${route(API.events.path)}?${query}`));
    console.log(`Event page: ${events.events.length} events.`);
    if (!events.events.length) break;
    assert.ok(events.nextEpoch > afterEpoch || (events.nextEpoch === afterEpoch && events.nextSeq > afterSeq), 'Event cursor did not advance.');
    afterEpoch = events.nextEpoch; afterSeq = events.nextSeq;
    assert.ok(page < 99, 'Event limit reached; persist cursor and continue explicitly.');
  }
}
if (process.argv.includes('--check')) check();
else if (process.argv.includes('--run')) run().catch(() => { console.error('Example stopped. No automatic retry or cleanup was attempted; inspect the demonstration board and reconcile uncertain requests.'); process.exitCode = 1; });
else { console.log('Usage: node --import tsx examples/board-api/workflow.ts --check | --run'); }
