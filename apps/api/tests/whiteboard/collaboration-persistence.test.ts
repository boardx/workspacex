import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument, executeCommands, readObjects, type WhiteboardCommand } from '@repo/whiteboard-core';
import { PgDatabase } from '../../src/infrastructure/db/pg-database';
import { appConfig } from '../../src/infrastructure/db/pg-config';
import { PgWhiteboardRepository } from '../../src/infrastructure/whiteboard/pg-whiteboard-repository';
import { PgWhiteboardCollaborationStore } from '../../src/infrastructure/whiteboard/pg-collaboration-store';
import { WorkerWhiteboardUpdateValidator } from '../../src/infrastructure/whiteboard/update-validator';
import { toOrgId } from '../../src/domain/org-id';
import type { Principal } from '../../src/domain/principal';
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from '../support/db';
const orgId = toOrgId('wb-collaboration-3945-a'), otherOrg = toOrgId('wb-collaboration-3945-b');
const actor = (userId: string, org = orgId): Principal => ({ userId, orgId: org });
const owner = actor('wb-collab-owner'), editor = actor('wb-collab-editor'), viewer = actor('wb-collab-viewer'), outsider = actor(owner.userId, otherOrg);
let db: PgDatabase, repo: PgWhiteboardRepository, store: PgWhiteboardCollaborationStore;
const command = (id: string): WhiteboardCommand => ({ type: 'create', object: { id, schemaVersion: 1, kind: 'sticky', text: '团队', style: {}, parentId: null, orderKey: '', geometry: { x: 0, y: 0, width: 100, height: 100, rotation: 0 } } });
const createBoard = () => repo.create(owner, { requestId: randomUUID(), name: '实时白板' });
beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); await resetOrgs(orgId, otherOrg);
  await seedOrg({ orgId, projectId: 'wb-collab-project-a' }); await seedOrg({ orgId: otherOrg, projectId: 'wb-collab-project-b' });
  for (const p of [owner, editor, viewer, outsider]) await addOrgMember(p.orgId, p.userId, 'consultant', null);
  db = new PgDatabase(appConfig()); repo = new PgWhiteboardRepository(db); store = new PgWhiteboardCollaborationStore(db);
});
afterAll(async () => { await db?.close(); await resetOrgs(orgId, otherOrg); });
describe('whiteboard collaboration durable transactions', () => {
  it('commits one sequence for concurrent retries and recovers on a fresh DB connection', async () => {
    const board = await createBoard(), input = { epoch: 1, requestId: randomUUID(), commands: [command('a')] };
    const [a, b] = await Promise.all([store.writeCommands(owner, board.id, input), store.writeCommands(owner, board.id, input)]);
    expect(a.seq).toBe(1); expect(b.seq).toBe(1); expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    const fresh = new PgDatabase(appConfig());
    try {
      const loaded = await new PgWhiteboardCollaborationStore(fresh).load(owner, board.id), doc = createWhiteboardDocument();
      Y.applyUpdate(doc, loaded.update); expect(readObjects(doc).map(o => o.id)).toEqual(['a']); expect(loaded.seq).toBe(1); doc.destroy();
    } finally { await fresh.close(); }
    await expect(store.writeCommands(owner, board.id, { ...input, commands: [command('b')] })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
  it('merges offline concurrent updates and state-vector reads', async () => {
    const board = await createBoard(); await store.writeCommands(owner, board.id, { epoch: 1, requestId: randomUUID(), commands: [command('n')] });
    const loaded = await store.load(owner, board.id), a = createWhiteboardDocument(), b = createWhiteboardDocument();
    Y.applyUpdate(a, loaded.update); Y.applyUpdate(b, loaded.update); const vector = Y.encodeStateVector(a);
    executeCommands(a, [{ type: 'text', id: 'n', index: 2, deleteCount: 0, insert: '甲' }], {});
    executeCommands(b, [{ type: 'text', id: 'n', index: 2, deleteCount: 0, insert: '乙' }], {});
    await Promise.all([a, b].map(doc => store.append(owner, board.id, { epoch: 1, updateId: randomUUID(), update: Y.encodeStateAsUpdate(doc, vector) })));
    const final = await store.load(owner, board.id, Y.encodeStateVector(a)); Y.applyUpdate(a, final.update);
    expect(final.seq).toBe(3); expect(readObjects(a)[0]?.text).toContain('甲'); expect(readObjects(a)[0]?.text).toContain('乙'); a.destroy(); b.destroy();
  });
  it('denies wrong tenant, viewer writes, stale epoch, revoked members and archives', async () => {
    const board = await createBoard();
    await repo.putMember(owner, board.id, { userId: editor.userId, role: 'editor' }); await repo.putMember(owner, board.id, { userId: viewer.userId, role: 'viewer' });
    const input = { epoch: 1, requestId: randomUUID(), commands: [command('n')] };
    await expect(store.load(outsider, board.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(store.writeCommands(viewer, board.id, input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(store.writeCommands(owner, board.id, { ...input, epoch: 2 })).rejects.toMatchObject({ code: 'STALE_EPOCH' });
    await store.writeCommands(editor, board.id, input); await repo.removeMember(owner, board.id, editor.userId);
    await expect(store.load(editor, board.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(store.writeCommands(editor, board.id, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await repo.update(owner, board.id, { archived: true });
    await expect(store.writeCommands(owner, board.id, input)).rejects.toMatchObject({ code: 'ARCHIVED' });
    expect((await store.load(viewer, board.id)).archived).toBe(true);
  });
  it('rechecks membership after waiting for a revocation transaction lock', async () => {
    const board = await createBoard(); await repo.putMember(owner, board.id, { userId: editor.userId, role: 'editor' });
    let locked!: () => void, release!: () => void;
    const acquired = new Promise<void>(resolve => { locked = resolve; });
    const proceed = new Promise<void>(resolve => { release = resolve; });
    const revocation = db.withTenant(orgId, async session => {
      await session.query('SELECT id FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE', [orgId, board.id]);
      locked(); await proceed;
      await session.query('DELETE FROM whiteboard_members WHERE org_id=$1 AND board_id=$2 AND user_id=$3', [orgId, board.id, editor.userId]);
    });
    await acquired;
    const pending = store.writeCommands(editor, board.id, { epoch: 1, requestId: randomUUID(), commands: [command('blocked')] });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'NOT_FOUND' });
    release(); await revocation; await assertion;
    expect((await store.load(owner, board.id)).seq).toBe(0);
  });
  it('rejected updates leave no sequence and rate limits allow idempotent replay', async () => {
    const board = await createBoard(), limited = new PgWhiteboardCollaborationStore(db, new WorkerWhiteboardUpdateValidator(), 1);
    await expect(store.append(owner, board.id, { epoch: 1, updateId: randomUUID(), update: new Uint8Array([255]) })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await store.load(owner, board.id)).seq).toBe(0);
    const input = { epoch: 1, requestId: randomUUID(), commands: [command('a')] };
    await limited.writeCommands(owner, board.id, input);
    expect((await limited.writeCommands(owner, board.id, input)).replayed).toBe(true);
    await expect(limited.writeCommands(owner, board.id, { ...input, requestId: randomUUID(), commands: [command('b')] })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect((await store.load(owner, board.id)).seq).toBe(1);
  });
});
