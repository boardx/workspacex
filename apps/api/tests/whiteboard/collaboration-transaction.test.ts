import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { DatabasePort, TenantSession } from '../../src/application/ports/database.port';
import type { WhiteboardUpdateValidator } from '../../src/application/whiteboard/collaboration-ports';
import { PgWhiteboardCollaborationStore } from '../../src/infrastructure/whiteboard/pg-collaboration-store';
import { toOrgId } from '../../src/domain/org-id';
import { WHITEBOARD_SYNC } from '@repo/contracts/whiteboard-sync';
const p = { orgId: toOrgId('transaction-whiteboard-test'), userId: 'owner' }, boardId = randomUUID();
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
      : sql.startsWith('SELECT epoch') ? [{ epoch: 1, seq: '0', snapshot: Buffer.from([0, 0]) }]
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
it.each(['snapshot', 'update'] as const)('rejects a validated %s above the transportable document budget before commit', async oversizedField => {
  const s = session(), tooLarge = new Uint8Array(WHITEBOARD_SYNC.documentBytes + 1);
  const oversized: WhiteboardUpdateValidator = {
    ...validator,
    commands: async () => ({ snapshot: oversizedField === 'snapshot' ? tooLarge : new Uint8Array([0, 0]), update: oversizedField === 'update' ? tooLarge : new Uint8Array([0, 0]) }),
  };
  const db: DatabasePort = { withTenant: async (_org, fn) => fn(s.value), withoutTenant: async () => { throw new Error('No tenant'); }, close: async () => {} };
  await expect(new PgWhiteboardCollaborationStore(db, oversized).writeCommands(p, boardId, input())).rejects.toThrow('VALIDATION_FAILED');
  expect(s.queries.some(sql => sql.startsWith('INSERT INTO whiteboard_updates'))).toBe(false);
  expect(s.queries.some(sql => sql.startsWith('UPDATE whiteboard_documents'))).toBe(false);
});
