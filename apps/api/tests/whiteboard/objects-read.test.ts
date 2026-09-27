import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument, executeCommands, readObjects, validateDocument } from '@repo/whiteboard-core';
import type { DatabasePort, TenantSession } from '../../src/application/ports/database.port';
import type { WhiteboardUpdateValidator } from '../../src/application/whiteboard/collaboration-ports';
import { WhiteboardOperationService } from '../../src/application/whiteboard/operation-service';
import { PgWhiteboardCollaborationStore } from '../../src/infrastructure/whiteboard/pg-collaboration-store';
import { PgWhiteboardOperationRepository } from '../../src/infrastructure/whiteboard/pg-operation-repository';
import { WhiteboardOperationController } from '../../src/interface/controllers/whiteboard-operation.controller';
import { toOrgId } from '../../src/domain/org-id';

const boardId = '00000000-0000-4000-8000-000000000001';
const principal = { orgId: toOrgId('read-org'), userId: 'reader' };
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function fixture() {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: 'create', object: { id: 'note', schemaVersion: 1, kind: 'sticky',
    geometry: { x: 10, y: 20, width: 200, height: 100, rotation: 0 }, text: 'Canonical 中文', style: {}, parentId: null, orderKey: 'a' } }], 'test');
  const snapshot = Y.encodeStateAsUpdate(doc); doc.destroy();
  const objectKey = `whiteboards/tenants/${digest(principal.orgId).slice(0, 32)}/boards/${boardId}/epochs/3/snapshots/7.yjs`;
  const state = { enabled: true, actorOrg: principal.orgId, delegatedBy: principal.userId, scopes: ['board:read'],
    role: 'viewer', archived: false, member: true, missing: false, tampered: false, seq: 7 };
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const session: TenantSession = { async query<R>(sql: string, params: readonly unknown[] = []) {
    calls.push({ sql, params });
    let rows: unknown[] = [];
    if (sql.includes('FROM whiteboard_actor_identities')) {
      expect(sql).toContain('enabled=true');
      expect(sql).toContain('org_id=$1'); expect(sql).toContain('delegated_by=$3');
      if (state.enabled && params[0] === state.actorOrg && params[1] === 'agent' && params[2] === state.delegatedBy) {
        rows = [{ actor_id: 'agent', kind: 'ai', delegated_by: state.delegatedBy, scopes: state.scopes, model_snapshot: 'model', skill_snapshot: 'skill' }];
      }
    } else if (sql.startsWith('SELECT owner_id')) {
      expect(sql).toContain('FOR SHARE');
      if (!state.missing && params[0] === principal.orgId && params[1] === boardId) rows = [{ owner_id: 'owner', archived: state.archived }];
    } else if (sql.startsWith('SELECT role')) rows = state.member ? [{ role: state.role }] : [];
    else if (sql.startsWith('SELECT epoch,seq,snapshot')) rows = [{ epoch: 3, seq: String(state.seq), snapshot: null, object_key: objectKey, content_hash: digest(snapshot), byte_size: String(snapshot.byteLength) }];
    else if (!sql.startsWith('INSERT INTO whiteboard_documents')) throw new Error(`unexpected SQL ${sql}`);
    return { rows: rows as R[] };
  } };
  const transactions = vi.fn(async <T>(org: Parameters<DatabasePort['withTenant']>[0], work: (session: TenantSession) => Promise<T>) => {
    expect(org).toBe(principal.orgId); return work(session);
  });
  const db = { withTenant: transactions } as unknown as DatabasePort;
  const objects = { get: vi.fn(async () => { state.seq = 99; return state.tampered ? new Uint8Array([0]) : snapshot; }), putOnce: vi.fn(), head: vi.fn() };
  const decode = vi.fn(async (bytes: Uint8Array) => {
    const copy = createWhiteboardDocument();
    try { Y.applyUpdate(copy, bytes); validateDocument(copy); return readObjects(copy); } finally { copy.destroy(); }
  });
  const validator = { objects: decode } as unknown as WhiteboardUpdateValidator;
  const store = new PgWhiteboardCollaborationStore(db, validator, 120, objects);
  const service = new WhiteboardOperationService(db, store, new PgWhiteboardOperationRepository(), undefined, undefined, validator);
  return { service, state, calls, objects, decode, transactions };
}

describe('versioned canonical object read', () => {
  it('reads viewer-accessible canonical content and the same immutable snapshot revision in one tenant transaction', async () => {
    const f = fixture();
    const result = await f.service.readObjects(principal, boardId, { actorId: 'agent' });
    expect(result).toMatchObject({ boardId, revision: { epoch: 3, seq: 7 }, role: 'viewer', archived: false,
      objects: [{ id: 'note', text: 'Canonical 中文', geometry: { x: 10, y: 20 } }] });
    expect(f.state.seq).toBe(99); // A moving head cannot relabel the sampled content.
    expect(f.transactions).toHaveBeenCalledOnce(); expect(f.decode).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain('object_key');
    expect(JSON.stringify(result)).not.toContain('whiteboards/tenants/');
  });
  it.each(['disabled', 'other-tenant', 'other-delegator', 'no-read-scope', 'unknown-actor'] as const)('denies %s before reading snapshot bytes', async reason => {
    const f = fixture();
    if (reason === 'disabled') f.state.enabled = false;
    if (reason === 'other-tenant') f.state.actorOrg = toOrgId('other-org');
    if (reason === 'other-delegator') f.state.delegatedBy = 'other-user';
    if (reason === 'no-read-scope') f.state.scopes = ['board:write'];
    await expect(f.service.readObjects(principal, boardId, { actorId: reason === 'unknown-actor' ? 'unknown' : 'agent' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.objects.get).not.toHaveBeenCalled(); expect(f.decode).not.toHaveBeenCalled();
  });
  it.each(['revoked-member', 'missing', 'other-board'] as const)('does not disclose content for %s', async reason => {
    const f = fixture();
    if (reason === 'revoked-member') f.state.member = false;
    if (reason === 'missing') f.state.missing = true;
    await expect(f.service.readObjects(principal, reason === 'other-board' ? '00000000-0000-4000-8000-000000000002' : boardId, { actorId: 'agent' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(f.objects.get).not.toHaveBeenCalled();
  });
  it('allows archived board reads while preserving archived status', async () => {
    const f = fixture(); f.state.archived = true;
    expect(await f.service.readObjects(principal, boardId, { actorId: 'agent' })).toMatchObject({ archived: true, objects: [{ id: 'note' }] });
  });
  it('fails closed on corrupt ObjectStore bytes before decoding or disclosing content', async () => {
    const f = fixture(); f.state.tampered = true;
    await expect(f.service.readObjects(principal, boardId, { actorId: 'agent' })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(f.decode).not.toHaveBeenCalled();
  });
  it('rejects malformed query and does not accept caller-supplied scopes', async () => {
    const f = fixture();
    await expect(f.service.readObjects(principal, boardId, { actorId: 'agent', scopes: ['board:read'] })).rejects.toHaveProperty('name', 'ZodError');
    await expect(f.service.readObjects(principal, boardId, {})).rejects.toHaveProperty('name', 'ZodError');
    expect(f.transactions).not.toHaveBeenCalled();
  });
  it('routes object reads through the shared principal rate limit before the service', async () => {
    const readObjects = vi.fn();
    const db = { withTenant: async (_org: unknown, work: (session: unknown) => Promise<unknown>) => work({ query: async () => ({ rows: [{ allowed: false }] }) }) };
    const controller = new WhiteboardOperationController({ readObjects } as never, {} as never, {} as never, db as never);
    await expect(controller.readObjects(principal, boardId, { actorId: 'agent' })).rejects.toMatchObject({ status: 429 });
    expect(readObjects).not.toHaveBeenCalled();
  });
});
