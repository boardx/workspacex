import { expect, it } from 'vitest';
import { createHash,randomUUID } from 'node:crypto';
import type { DatabasePort, TenantSession } from '../../src/application/ports/database.port';
import type { WhiteboardUpdateValidator } from '../../src/application/whiteboard/collaboration-ports';
import { PgWhiteboardCollaborationStore } from '../../src/infrastructure/whiteboard/pg-collaboration-store';
import { toOrgId } from '../../src/domain/org-id';
import { WHITEBOARD_SYNC } from '@repo/contracts/whiteboard-sync';
const p = { orgId: toOrgId('transaction-whiteboard-test'), userId: 'owner' }, boardId = randomUUID();
const initialKey=`whiteboards/tenants/${createHash('sha256').update(p.orgId).digest('hex').slice(0,32)}/boards/${boardId}/epochs/1/snapshots/0-initial.yjs`;
const objects=()=>{const blobs=new Map([[initialKey,new Uint8Array([0,0])]]);return{putOnce:async(key:string,value:Uint8Array)=>{blobs.set(key,new Uint8Array(value));},get:async(key:string)=>blobs.get(key)??null,head:async(key:string)=>blobs.has(key)?{sizeBytes:blobs.get(key)!.byteLength,mime:'application/vnd.yjs-update'}:null};};
const input = () => ({ epoch: 1, requestId: randomUUID(), commands: [{ type: 'delete' as const, id: 'note' }] });
const validator: WhiteboardUpdateValidator = {
  objects: async () => [], objectIds: async () => [], diff: async snapshot => snapshot,
  commands: async () => ({ snapshot: new Uint8Array([0, 0]), update: new Uint8Array([0, 0]) }),
  validate: async () => ({ snapshot: new Uint8Array([0, 0]), update: new Uint8Array([0, 0]) }),
};
function session(): { value: TenantSession; queries: string[] } {
  const queries: string[] = [];
  return { queries, value: { async query<R>(sql: string) {
    queries.push(sql);
    const rows = sql.startsWith('SELECT owner_id') ? [{ owner_id: p.userId, archived: false }]
      : sql.startsWith('SELECT epoch') ? [{ epoch: 1, seq: '0', snapshot: null, object_key:initialKey,content_hash:createHash('sha256').update(new Uint8Array([0,0])).digest('hex'),byte_size:'2' }]
      : sql.startsWith('SELECT count') ? [{ count: '0' }] : [];
    return { rows: rows as R[] };
  } } };
}
it('uses the supplied transaction and marks the result pending until outer commit', async () => {
  const s = session();
  const db: DatabasePort = { withTenant: async () => { throw new Error('Nested transaction is forbidden'); }, withoutTenant: async () => { throw new Error('No tenant'); }, close: async () => {} };
  const result = await new PgWhiteboardCollaborationStore(db, validator,120,objects()).writeCommandsInTransaction(s.value, p, boardId, input());
  expect(result).toMatchObject({ durability: 'pending', seq: 1 });
  expect(s.queries[0]).toContain('FOR UPDATE');
  expect(s.queries.some(sql => sql.startsWith('SELECT epoch,seq,snapshot') && sql.endsWith('FOR UPDATE'))).toBe(true);
  expect(s.queries.some(sql => sql.startsWith('INSERT INTO whiteboard_updates'))).toBe(true);
  expect(s.queries.some(sql => sql.startsWith('UPDATE whiteboard_documents'))).toBe(true);
});
it('public commands return ACK only after the outer transaction succeeds', async () => {
  const s = session(); let committed = false;
  const db: DatabasePort = { withTenant: async (_org, fn) => { const value = await fn(s.value); committed = true; return value; }, withoutTenant: async () => { throw new Error('No tenant'); }, close: async () => {} };
  const ack = await new PgWhiteboardCollaborationStore(db, validator,120,objects()).writeCommands(p, boardId, input());
  expect(committed).toBe(true); expect(ack).not.toHaveProperty('durability');
  db.withTenant = async (_org, fn) => { await fn(s.value); throw new Error('COMMIT failed'); };
  await expect(new PgWhiteboardCollaborationStore(db, validator,120,objects()).writeCommands(p, boardId, input())).rejects.toThrow('COMMIT failed');
});
it.each(['snapshot', 'update'] as const)('rejects a validated %s above its transport budget before commit', async oversizedField => {
  const s = session(), tooLarge = new Uint8Array((oversizedField === 'snapshot' ? WHITEBOARD_SYNC.documentBytes : WHITEBOARD_SYNC.persistedUpdateBytes) + 1);
  const oversized: WhiteboardUpdateValidator = {
    ...validator,
    commands: async () => ({ snapshot: oversizedField === 'snapshot' ? tooLarge : new Uint8Array([0, 0]), update: oversizedField === 'update' ? tooLarge : new Uint8Array([0, 0]) }),
  };
  const db: DatabasePort = { withTenant: async (_org, fn) => fn(s.value), withoutTenant: async () => { throw new Error('No tenant'); }, close: async () => {} };
  await expect(new PgWhiteboardCollaborationStore(db, oversized,120,objects()).writeCommands(p, boardId, input())).rejects.toThrow('VALIDATION_FAILED');
  expect(s.queries.some(sql => sql.startsWith('INSERT INTO whiteboard_updates'))).toBe(false);
  expect(s.queries.some(sql => sql.startsWith('UPDATE whiteboard_documents'))).toBe(false);
});
