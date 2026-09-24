import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { DatabasePort, TenantSession } from '../../src/application/ports/database.port';
import type { WhiteboardUpdateValidator } from '../../src/application/whiteboard/collaboration-ports';
import { PgWhiteboardCollaborationStore } from '../../src/infrastructure/whiteboard/pg-collaboration-store';
import type { BoardBlobCodec, BoardBlobStore, EncodedBoardBlob } from '../../src/application/whiteboard/blob-ports';
import { sha256 } from '../../src/domain/whiteboard/blob-identity';
import { toOrgId } from '../../src/domain/org-id';
const p = { orgId: toOrgId('transaction-whiteboard-test'), userId: 'owner' }, boardId = randomUUID();
const input = () => ({ epoch: 1, requestId: randomUUID(), commands: [{ type: 'delete' as const, id: 'note' }] });
const validator: WhiteboardUpdateValidator = {
  objects: async () => [], historyObjects:async()=>[],rebuild:async()=>new Uint8Array([0,0]), objectIds: async () => [], diff: async snapshot => snapshot,
  commands: async () => ({ snapshot: new Uint8Array([0, 0]), update: new Uint8Array([0, 0]) }),
  validate: async () => ({ snapshot: new Uint8Array([0, 0]), update: new Uint8Array([0, 0]) }),
};
function session(head: { epoch: number; seq: string } = { epoch: 1, seq: '0' }): { value: TenantSession; queries: string[] } {
  const queries: string[] = [];
  return { queries, value: { async query<R>(sql: string) {
    queries.push(sql);
    const rows = sql.startsWith('SELECT owner_id') ? [{ owner_id: p.userId, archived: false }]
      : sql.startsWith('SELECT d.epoch') ? [{ epoch: 1, seq: '0', snapshot: Buffer.from([0, 0]), head_epoch: head.epoch, head_seq: head.seq, storage_kind: 'legacy_pg', manifest_key: null, manifest_digest: null, manifest_size_bytes: null, tenant_key_version: null, fencing_token: '0' }]
      : sql.startsWith('SELECT count') ? [{ count: '0' }] : [];
    return { rows: rows as R[] };
  } } };
}
it('uses the supplied transaction and marks the result pending until outer commit', async () => {
  const s = session();
  const db: DatabasePort = { withTenant: async () => { throw new Error('Nested transaction is forbidden'); }, withoutTenant: async () => { throw new Error('No tenant'); }, close: async () => {} };
  const result = await new PgWhiteboardCollaborationStore(db, validator).writeCommandsInTransaction(s.value, p, boardId, input());
  expect(result).toMatchObject({ durability: 'pending', seq: 1 });
  expect(s.queries[0]).toContain('FOR UPDATE');
  expect(s.queries.some(sql => sql.startsWith('INSERT INTO whiteboard_updates'))).toBe(true);
  expect(s.queries.some(sql => sql.startsWith('UPDATE whiteboard_documents'))).toBe(true);
});
it('public commands return ACK only after the outer transaction succeeds', async () => {
  const s = session(); let committed = false;
  const db: DatabasePort = { withTenant: async (_org, fn) => { const value = await fn(s.value); committed = true; return value; }, withoutTenant: async () => { throw new Error('No tenant'); }, close: async () => {} };
  const ack = await new PgWhiteboardCollaborationStore(db, validator).writeCommands(p, boardId, input());
  expect(committed).toBe(true); expect(ack).not.toHaveProperty('durability');
  db.withTenant = async (_org, fn) => { await fn(s.value); throw new Error('COMMIT failed'); };
  await expect(new PgWhiteboardCollaborationStore(db, validator).writeCommands(p, boardId, input())).rejects.toThrow('COMMIT failed');
});
it('rejects divergent authoritative head metadata before load or append can write', async () => {
  for (const head of [{ epoch: 2, seq: '0' }, { epoch: 1, seq: '1' }]) {
    const s = session(head);
    const db: DatabasePort = { withTenant: async (_org, fn) => fn(s.value), withoutTenant: async () => { throw new Error('No tenant'); }, close: async () => {} };
    const store = new PgWhiteboardCollaborationStore(db, validator);
    await expect(store.load(p, boardId)).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
    await expect(store.append(p, boardId, { epoch: 1, updateId: randomUUID(), update: new Uint8Array([1]) })).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
    expect(s.queries.some(sql => sql.startsWith('INSERT INTO whiteboard_updates'))).toBe(false);
    expect(s.queries.some(sql => sql.startsWith('UPDATE whiteboard_documents'))).toBe(false);
  }
});

const memoryBlobs = (): BoardBlobStore => {
  const values = new Map<string, Uint8Array>();
  return {
    async putImmutable(value) { values.set(value.key, new Uint8Array(value.ciphertext)); return 'created'; },
    async getVerified(value) { const bytes = values.get(value.key); if (!bytes) throw new Error('missing'); return new Uint8Array(bytes); },
    async head(value) { const bytes = values.get(value.key); return bytes ? { cipherDigest: sha256(bytes), sizeBytes: bytes.byteLength } : null; },
    async deleteIfMatch(value){return values.delete(value.key)?'deleted':'not-found';},
  };
};
const identityCodec: BoardBlobCodec = {
  async encrypt({ plaintext, tenantKeyVersion }): Promise<EncodedBoardBlob> { const ciphertext = new Uint8Array(plaintext), digest = sha256(ciphertext); return { ciphertext, plainDigest: digest, cipherDigest: digest, sizeBytes: ciphertext.byteLength, tenantKeyVersion }; },
  async decrypt({ ciphertext }) { return new Uint8Array(ciphertext); },
};

it('rolls back the receipt and sequence when head CAS or outer commit fails after blob publication', async () => {
  for (const failure of ['cas', 'commit'] as const) {
    let committedSeq = 0;
    const staged = session();
    const original = staged.value.query.bind(staged.value);
    staged.value.query = async <R>(sql: string, params?: readonly unknown[]) => {
      if (sql.startsWith('UPDATE whiteboard_content_heads SET')) return { rows: (failure === 'cas' ? [] : [{ fencing_token: '1' }]) as R[] };
      return original<R>(sql, params);
    };
    const db: DatabasePort = {
      withTenant: async (_org, fn) => {
        const result = await fn(staged.value);
        if (failure === 'commit') throw new Error('injected commit failure');
        committedSeq = result && typeof result === 'object' && 'seq' in result ? Number(result.seq) : committedSeq;
        return result;
      },
      withoutTenant: async () => { throw new Error('No tenant'); }, close: async () => {},
    };
    const store = new PgWhiteboardCollaborationStore(db, validator, 120, memoryBlobs(), identityCodec, 1);
    await expect(store.writeCommands(p, boardId, input())).rejects.toThrow(failure === 'cas' ? 'CAS_CONFLICT' : 'commit failure');
    expect(committedSeq).toBe(0);
    expect(staged.queries.some(sql => sql.startsWith('INSERT INTO whiteboard_updates'))).toBe(true);
  }
});
