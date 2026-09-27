import { expect, it, vi } from 'vitest';
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
  commands: async () => ({ objectIds: [], snapshot: new Uint8Array([0, 0]), update: new Uint8Array([0, 0]) }),
  validate: async () => ({ objectIds: [], snapshot: new Uint8Array([0, 0]), update: new Uint8Array([0, 0]) }),
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
  expect(s.queries.some(sql => sql.startsWith('SELECT epoch,seq,snapshot') && sql.endsWith('FOR UPDATE'))).toBe(true);
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
it.each(['snapshot', 'update'] as const)('rejects a validated %s above its transport budget before commit', async oversizedField => {
  const s = session(), tooLarge = new Uint8Array((oversizedField === 'snapshot' ? WHITEBOARD_SYNC.documentBytes : WHITEBOARD_SYNC.persistedUpdateBytes) + 1);
  const oversized: WhiteboardUpdateValidator = {
    ...validator,
    commands: async () => ({ objectIds: [], snapshot: oversizedField === 'snapshot' ? tooLarge : new Uint8Array([0, 0]), update: oversizedField === 'update' ? tooLarge : new Uint8Array([0, 0]) }),
  };
  const db: DatabasePort = { withTenant: async (_org, fn) => fn(s.value), withoutTenant: async () => { throw new Error('No tenant'); }, close: async () => {} };
  await expect(new PgWhiteboardCollaborationStore(db, oversized).writeCommands(p, boardId, input())).rejects.toThrow('VALIDATION_FAILED');
  expect(s.queries.some(sql => sql.startsWith('INSERT INTO whiteboard_updates'))).toBe(false);
  expect(s.queries.some(sql => sql.startsWith('UPDATE whiteboard_documents'))).toBe(false);
});

it('uses the same validated object IDs for comment archival without a second worker decode', async () => {
  const s = session(), objectIds = vi.fn(async () => { throw new Error('SECOND_WORKER_FORBIDDEN'); });
  const accepted = { snapshot: new Uint8Array([0, 0]), update: new Uint8Array([0, 0]), objectIds: ['retained-note'] };
  const commands = vi.fn(async () => accepted);
  const onePass = { ...validator, commands, objectIds };
  let archivalIds: unknown;
  const transaction: TenantSession = { query: async <R>(sql: string, params?: readonly unknown[]) => {
    if (sql.includes('FROM whiteboard_comment_threads')) archivalIds = params?.[2];
    return s.value.query<R>(sql, params);
  } };
  const db: DatabasePort = { withTenant: async (_org, fn) => fn(transaction), withoutTenant: async () => { throw new Error('No tenant'); }, close: async () => {} };
  await new PgWhiteboardCollaborationStore(db, onePass).writeCommands(p, boardId, input());
  expect(commands).toHaveBeenCalledTimes(1); expect(objectIds).not.toHaveBeenCalled();
  expect(archivalIds).toEqual(['retained-note']);
});
it.each([undefined, ['same', 'same'], ['']])('rejects invalid same-worker object IDs before publication: %j', async ids => {
  const s = session();
  const broken: WhiteboardUpdateValidator = { ...validator, commands: async () => ({ snapshot: new Uint8Array([0, 0]), update: new Uint8Array([0, 0]), objectIds: ids as string[] }) };
  const db: DatabasePort = { withTenant: async (_org, fn) => fn(s.value), withoutTenant: async () => { throw new Error('No tenant'); }, close: async () => {} };
  await expect(new PgWhiteboardCollaborationStore(db, broken).writeCommands(p, boardId, input())).rejects.toThrow('VALIDATION_FAILED');
  expect(s.queries.some(sql => sql.startsWith('INSERT INTO whiteboard_updates') || sql.startsWith('UPDATE whiteboard_documents'))).toBe(false);
});
