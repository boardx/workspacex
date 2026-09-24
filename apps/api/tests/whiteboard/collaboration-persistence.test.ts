import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument, executeCommands, readObjects, type WhiteboardCommand } from '@repo/whiteboard-core';
import { PgDatabase } from '../../src/infrastructure/db/pg-database';
import { appConfig } from '../../src/infrastructure/db/pg-config';
import { PgWhiteboardRepository } from '../../src/infrastructure/whiteboard/pg-whiteboard-repository';
import { PgWhiteboardCollaborationStore } from '../../src/infrastructure/whiteboard/pg-collaboration-store';
import { WorkerWhiteboardUpdateValidator } from '../../src/infrastructure/whiteboard/update-validator';
import { FsBoardBlobStore } from '../../src/infrastructure/whiteboard/fs-board-blob-store';
import { AesGcmBoardBlobCodec } from '../../src/infrastructure/whiteboard/aes-gcm-board-blob-codec';
import { BOARD_ENCRYPTED_BLOB_CONTENT_TYPE, type BoardBlobStore } from '../../src/application/whiteboard/blob-ports';
import { decodeBoardContentManifest } from '../../src/domain/whiteboard/content-manifest';
import { toOrgId } from '../../src/domain/org-id';
import type { Principal } from '../../src/domain/principal';
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from '../support/db';
const orgId = toOrgId('wb-collaboration-3945-a'), otherOrg = toOrgId('wb-collaboration-3945-b');
const actor = (userId: string, org = orgId): Principal => ({ userId, orgId: org });
const owner = actor('wb-collab-owner'), editor = actor('wb-collab-editor'), viewer = actor('wb-collab-viewer'), outsider = actor(owner.userId, otherOrg);
let db: PgDatabase, repo: PgWhiteboardRepository, store: PgWhiteboardCollaborationStore, blobs: FsBoardBlobStore, blobRoot: string;
const codec = new AesGcmBoardBlobCodec({ resolve: async () => new Uint8Array(32).fill(17) });
const collaboration = (database: PgDatabase, blobStore: BoardBlobStore = blobs, rate = 120) => new PgWhiteboardCollaborationStore(database, new WorkerWhiteboardUpdateValidator(), rate, blobStore, codec, 1);
const command = (id: string): WhiteboardCommand => ({ type: 'create', object: { id, schemaVersion: 1, kind: 'sticky', text: '团队', style: {}, parentId: null, orderKey: '', geometry: { x: 0, y: 0, width: 100, height: 100, rotation: 0 } } });
const createBoard = () => repo.create(owner, { requestId: randomUUID(), name: '实时白板' });
beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); await resetOrgs(orgId, otherOrg);
  await seedOrg({ orgId, projectId: 'wb-collab-project-a' }); await seedOrg({ orgId: otherOrg, projectId: 'wb-collab-project-b' });
  for (const p of [owner, editor, viewer, outsider]) await addOrgMember(p.orgId, p.userId, 'consultant', null);
  blobRoot = await mkdtemp(join(tmpdir(), 'wsx-board-runtime-')); blobs = new FsBoardBlobStore(blobRoot);
  db = new PgDatabase(appConfig()); repo = new PgWhiteboardRepository(db); store = collaboration(db);
});
afterAll(async () => { await db?.close(); await resetOrgs(orgId, otherOrg); await rm(blobRoot, { recursive: true, force: true }); });
describe('whiteboard collaboration durable transactions', () => {
  it('commits one sequence for concurrent retries and recovers on a fresh DB connection', async () => {
    const board = await createBoard(), input = { epoch: 1, requestId: randomUUID(), commands: [command('a')] };
    const [a, b] = await Promise.all([store.writeCommands(owner, board.id, input), store.writeCommands(owner, board.id, input)]);
    expect(a.seq).toBe(1); expect(b.seq).toBe(1); expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    const fresh = new PgDatabase(appConfig());
    try {
      const loaded = await collaboration(fresh).load(owner, board.id), doc = createWhiteboardDocument();
      Y.applyUpdate(doc, loaded.update); expect(readObjects(doc).map(o => o.id)).toEqual(['a']); expect(loaded.seq).toBe(1); doc.destroy();
      const persisted = await fresh.withTenant(orgId, session => session.query<{ snapshot: Buffer | null; update: Buffer | null; storage_kind: string; head_seq: string }>(`SELECT d.snapshot,u.update,h.storage_kind,h.head_seq::text FROM whiteboard_documents d JOIN whiteboard_updates u ON u.org_id=d.org_id AND u.board_id=d.board_id JOIN whiteboard_content_heads h ON h.org_id=d.org_id AND h.board_id=d.board_id WHERE d.org_id=$1 AND d.board_id=$2`, [orgId, board.id]));
      expect(persisted.rows[0]).toMatchObject({ snapshot: null, update: null, storage_kind: 'blob_primary', head_seq: '1' });
      const pointers = await fresh.withTenant(orgId, session => session.query<{ manifest_key: string; manifest_digest: string; manifest_plain_digest: string; manifest_size_bytes: string; tenant_key_version: number }>(`SELECT manifest_key,manifest_digest,manifest_plain_digest,manifest_size_bytes::text,tenant_key_version FROM whiteboard_content_heads WHERE org_id=$1 AND board_id=$2`, [orgId, board.id]));
      const pointer = pointers.rows[0]!;
      const encrypted = await blobs.getVerified({ tenantId: orgId, key: pointer.manifest_key, expectedCipherDigest: pointer.manifest_digest, expectedSizeBytes: Number(pointer.manifest_size_bytes), expectedContentType: BOARD_ENCRYPTED_BLOB_CONTENT_TYPE });
      expect(() => JSON.parse(Buffer.from(encrypted).toString('utf8'))).toThrow();
      expect(pointer.manifest_digest).not.toBe(pointer.manifest_plain_digest);
      const plaintext = await codec.decrypt({ ciphertext: encrypted, cipherDigest: pointer.manifest_digest, plainDigest: pointer.manifest_plain_digest, expectedPlainDigest: pointer.manifest_plain_digest, sizeBytes: encrypted.byteLength, contentType: BOARD_ENCRYPTED_BLOB_CONTENT_TYPE, tenantId: orgId, tenantKeyVersion: pointer.tenant_key_version });
      expect(decodeBoardContentManifest(plaintext)).toMatchObject({ boardId: board.id, epoch: 1, headSeq: 1, tenantKeyVersion: 1 });
      await fresh.withTenant(orgId, session => session.query(`UPDATE whiteboard_content_heads SET manifest_plain_digest=$3 WHERE org_id=$1 AND board_id=$2`, [orgId, board.id, 'c'.repeat(64)]));
      await expect(collaboration(fresh).load(owner, board.id)).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
      await fresh.withTenant(orgId, session => session.query(`UPDATE whiteboard_content_heads SET manifest_plain_digest=$3,protocol_version=2 WHERE org_id=$1 AND board_id=$2`, [orgId, board.id, pointer.manifest_plain_digest]));
      await expect(collaboration(fresh).load(owner, board.id)).rejects.toThrow('Unsupported Board content head version');
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
    const recovered = createWhiteboardDocument(); Y.applyUpdate(recovered, (await store.load(owner, board.id)).update);
    expect(final.seq).toBe(3); expect(readObjects(a)[0]?.text).toContain('甲'); expect(readObjects(a)[0]?.text).toContain('乙');
    expect(Buffer.from(Y.encodeStateVector(a))).toEqual(Buffer.from(Y.encodeStateVector(recovered)));
    a.destroy(); b.destroy(); recovered.destroy();
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
    const board = await createBoard(), limited = collaboration(db, blobs, 1);
    await expect(store.append(owner, board.id, { epoch: 1, updateId: randomUUID(), update: new Uint8Array([255]) })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await store.load(owner, board.id)).seq).toBe(0);
    const input = { epoch: 1, requestId: randomUUID(), commands: [command('a')] };
    await limited.writeCommands(owner, board.id, input);
    expect((await limited.writeCommands(owner, board.id, input)).replayed).toBe(true);
    await expect(limited.writeCommands(owner, board.id, { ...input, requestId: randomUUID(), commands: [command('b')] })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect((await store.load(owner, board.id)).seq).toBe(1);
  });
  it('keeps a legacy Board lossless until blob-first promotion commits', async () => {
    const board = await createBoard();
    await db.withTenant(orgId, async session => {
      await session.query(`INSERT INTO whiteboard_documents(org_id,board_id) VALUES($1,$2)`, [orgId, board.id]);
      await session.query(`INSERT INTO whiteboard_content_heads(org_id,board_id,epoch,head_seq,checkpoint_seq) VALUES($1,$2,1,0,0)`, [orgId, board.id]);
    });
    await store.load(owner, board.id);
    const legacy = await db.withTenant(orgId, session => session.query<{ snapshot: Buffer | null; storage_kind: string }>(`SELECT d.snapshot,h.storage_kind FROM whiteboard_documents d JOIN whiteboard_content_heads h ON h.org_id=d.org_id AND h.board_id=d.board_id WHERE d.org_id=$1 AND d.board_id=$2`, [orgId, board.id]));
    expect(legacy.rows[0]?.storage_kind).toBe('legacy_pg'); expect(legacy.rows[0]?.snapshot).not.toBeNull();
    await store.writeCommands(owner, board.id, { epoch: 1, requestId: randomUUID(), commands: [command('promoted')] });
    const loaded = await store.load(owner, board.id), doc = createWhiteboardDocument(); Y.applyUpdate(doc, loaded.update);
    expect(readObjects(doc).map(object => object.id)).toEqual(['promoted']); doc.destroy();
  });
  it('initializes a newly opened Board directly as blob-primary', async () => {
    const board = await createBoard(); expect((await store.load(owner, board.id)).seq).toBe(0);
    const row = await db.withTenant(orgId, session => session.query<{ snapshot: Buffer | null; storage_kind: string }>(`SELECT d.snapshot,h.storage_kind FROM whiteboard_documents d JOIN whiteboard_content_heads h ON h.org_id=d.org_id AND h.board_id=d.board_id WHERE d.org_id=$1 AND d.board_id=$2`, [orgId, board.id]));
    expect(row.rows[0]).toEqual({ snapshot: null, storage_kind: 'blob_primary' });
  });
  it('does not advance PostgreSQL when blob publication or read-back integrity fails', async () => {
    for (const mode of ['put', 'readback'] as const) {
      const board = await createBoard(); let calls = 0;
      const fault: BoardBlobStore = {
        head: input => blobs.head(input),
        putImmutable: async input => { calls++; if (mode === 'put' && calls === 1) throw new Error('injected blob failure'); return blobs.putImmutable(input); },
        getVerified: async input => { const bytes = await blobs.getVerified(input); if (mode === 'readback' && calls > 0) return new Uint8Array(bytes.map((byte, index) => index === 0 ? byte ^ 1 : byte)); return bytes; },
      };
      await expect(collaboration(db, fault).writeCommands(owner, board.id, { epoch: 1, requestId: randomUUID(), commands: [command(mode)] })).rejects.toThrow();
      expect((await store.load(owner, board.id)).seq).toBe(0);
    }
  });
  it('fails closed when the authoritative head epoch or sequence diverges from document metadata', async () => {
    for (const field of ['epoch', 'head_seq'] as const) {
      const board = await createBoard();
      expect((await store.load(owner, board.id)).seq).toBe(0);
      await db.withTenant(orgId, session => session.query(`UPDATE whiteboard_content_heads SET ${field}=${field}+1 WHERE org_id=$1 AND board_id=$2`, [orgId, board.id]));

      await expect(store.load(owner, board.id)).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
      const offline = createWhiteboardDocument();
      executeCommands(offline, [command(`tampered-${field}`)], {});
      const update = Y.encodeStateAsUpdate(offline); offline.destroy();
      await expect(store.append(owner, board.id, { epoch: 1, updateId: randomUUID(), update })).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });

      const state = await db.withTenant(orgId, session => session.query<{ seq: string; updates: string }>(`SELECT d.seq::text,(SELECT count(*)::text FROM whiteboard_updates u WHERE u.org_id=d.org_id AND u.board_id=d.board_id) AS updates FROM whiteboard_documents d WHERE d.org_id=$1 AND d.board_id=$2`, [orgId, board.id]));
      expect(state.rows[0]).toEqual({ seq: '0', updates: '0' });
    }
  });
});
