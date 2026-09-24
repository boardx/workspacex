import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgDatabase } from '../../src/infrastructure/db/pg-database';
import { appConfig } from '../../src/infrastructure/db/pg-config';
import { PgWhiteboardRepository } from '../../src/infrastructure/whiteboard/pg-whiteboard-repository';
import { PgWhiteboardCollaborationStore } from '../../src/infrastructure/whiteboard/pg-collaboration-store';
import { PgWorkshopControlRepository } from '../../src/infrastructure/whiteboard/pg-workshop-control-repository';
import { PgOrgMemberRepository } from '../../src/infrastructure/auth/pg-org-member-repository';
import type { DatabasePort, TenantSession } from '../../src/application/ports/database.port';
import type { OrgId } from '../../src/domain/org-id';
import { toOrgId } from '../../src/domain/org-id';
import type { Principal } from '../../src/domain/principal';
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from '../support/db';

const orgId = toOrgId('wb-workshop-control-a'), otherOrg = toOrgId('wb-workshop-control-b');
const owner: Principal = { orgId, userId: 'wb-control-owner' };
const editor: Principal = { orgId, userId: 'wb-control-editor' };
const admin: Principal = { orgId, userId: 'wb-control-admin' };
const backupAdmin = 'wb-control-backup-admin';
const crossTenant: Principal = { orgId: otherOrg, userId: owner.userId };
let db: PgDatabase, boards: PgWhiteboardRepository, controls: PgWorkshopControlRepository, collaboration: PgWhiteboardCollaborationStore;

function pauseAfterAdminLock(base: DatabasePort, actorId: string): { database: DatabasePort; entered: Promise<void>; release: () => void } {
  let signalEntered!: () => void, signalRelease!: () => void, paused = false;
  const entered = new Promise<void>(resolve => { signalEntered = resolve; });
  const released = new Promise<void>(resolve => { signalRelease = resolve; });
  const wrap = (session: TenantSession): TenantSession => ({
    async query<R = Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
      const result = await session.query<R>(sql, params);
      if (!paused && /FROM org_memberships[\s\S]*FOR UPDATE/.test(sql) && params[1] === actorId) {
        paused = true; signalEntered(); await released;
      }
      return result;
    },
  });
  const database: DatabasePort = {
    withTenant<T>(tenantId: OrgId, fn: (session: TenantSession) => Promise<T>): Promise<T> {
      return base.withTenant(tenantId, session => fn(wrap(session)));
    },
    withoutTenant<T>(fn: (session: TenantSession) => Promise<T>): Promise<T> {
      return base.withoutTenant(session => fn(wrap(session)));
    },
    close(): Promise<void> { return base.close(); },
  };
  return { database, entered, release: signalRelease };
}

function beginDowngrade(userId: string): { pid: Promise<number>; done: Promise<void> } {
  let reportPid!: (pid: number) => void;
  const pid = new Promise<number>(resolve => { reportPid = resolve; });
  const downgradeDb: DatabasePort = {
    withTenant<T>(tenantId: OrgId, fn: (session: TenantSession) => Promise<T>): Promise<T> {
      return db.withTenant(tenantId, async session => {
        const backend = await session.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        reportPid(backend.rows[0]!.pid);
        return fn(session);
      });
    },
    withoutTenant<T>(fn: (session: TenantSession) => Promise<T>): Promise<T> { return db.withoutTenant(fn); },
    async close(): Promise<void> {},
  };
  const done = new PgOrgMemberRepository(downgradeDb).changeRole(orgId, userId, 'consultant').then(result => {
    if (!result.ok || !result.changed) throw new Error(`admin downgrade did not commit: ${JSON.stringify(result)}`);
  });
  return { pid, done };
}

async function expectBlocked(pid: number): Promise<void> {
  await db.withTenant(orgId, async session => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const result = await session.query<{ blocked: boolean }>('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked', [pid]);
      if (result.rows[0]?.blocked) return;
      await session.query('SELECT pg_sleep(0.01)');
    }
    throw new Error(`backend ${pid} did not block on the admin membership lock`);
  });
}

beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); await resetOrgs(orgId, otherOrg);
  await seedOrg({ orgId, projectId: 'wb-workshop-control-project-a' });
  await seedOrg({ orgId: otherOrg, projectId: 'wb-workshop-control-project-b' });
  await addOrgMember(orgId, owner.userId, 'consultant', null);
  await addOrgMember(orgId, editor.userId, 'consultant', null);
  await addOrgMember(orgId, admin.userId, 'admin', null);
  await addOrgMember(orgId, backupAdmin, 'admin', null);
  await addOrgMember(otherOrg, crossTenant.userId, 'admin', null);
  db = new PgDatabase(appConfig()); boards = new PgWhiteboardRepository(db);
  controls = new PgWorkshopControlRepository(db); collaboration = new PgWhiteboardCollaborationStore(db);
});
afterAll(async () => { await db?.close(); await resetOrgs(orgId, otherOrg); });

describe('real PostgreSQL workshop control boundary', () => {
  it('persists tenant-isolated state, gates controllers and makes reveal/idempotency atomic', async () => {
    const board = await boards.create(owner, { requestId: randomUUID(), name: '冻结工作坊' });
    await boards.putMember(owner, board.id, { userId: editor.userId, role: 'editor' });
    await boards.putMember(owner, board.id, { userId: admin.userId, role: 'editor' });
    await expect(controls.get(crossTenant, board.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(controls.setFreeze(editor, board.id, { requestId: randomUUID(), frozen: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const freezeId = randomUUID();
    const frozen = await controls.setFreeze(owner, board.id, { requestId: freezeId, frozen: true });
    expect(frozen).toMatchObject({ frozen: true, revision: 1, hiddenPhaseIds: [] });
    expect(await controls.setFreeze(owner, board.id, { requestId: freezeId, frozen: true })).toEqual(frozen);
    await expect(controls.setFreeze(owner, board.id, { requestId: freezeId, frozen: false })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    await expect(collaboration.writeCommands(editor, board.id, { epoch: 1, requestId: randomUUID(), commands: [{ type: 'create', object: { id: 'blocked-note', schemaVersion: 1, kind: 'sticky', text: 'blocked', style: {}, parentId: null, orderKey: '', geometry: { x: 0, y: 0, width: 200, height: 120, rotation: 0 } } }] })).rejects.toMatchObject({ code: 'WORKSHOP_FROZEN' });
    await expect(collaboration.writeCommands(owner, board.id, { epoch: 1, requestId: randomUUID(), commands: [{ type: 'create', object: { id: 'owner-note', schemaVersion: 1, kind: 'sticky', text: 'owner', style: {}, parentId: null, orderKey: '', geometry: { x: 0, y: 0, width: 200, height: 120, rotation: 0 } } }] })).resolves.toMatchObject({ seq: 1 });
    await expect(collaboration.writeCommands(admin, board.id, { epoch: 1, requestId: randomUUID(), commands: [{ type: 'create', object: { id: 'admin-note', schemaVersion: 1, kind: 'sticky', text: 'admin', style: {}, parentId: null, orderKey: '', geometry: { x: 220, y: 0, width: 200, height: 120, rotation: 0 } } }] })).resolves.toMatchObject({ seq: 2 });

    const hidden = await controls.hidePhases(admin, board.id, { requestId: randomUUID(), phaseIds: ['discover', 'decide'] });
    expect(hidden).toMatchObject({ frozen: true, hiddenPhaseIds: ['decide', 'discover'], revision: 2 });
    const revealId = randomUUID(), revealed = await controls.revealPhases(owner, board.id, { requestId: revealId });
    expect(revealed).toMatchObject({ hiddenPhaseIds: [], revision: 3 });
    expect(await controls.revealPhases(owner, board.id, { requestId: revealId })).toEqual(revealed);
    expect(await new PgWorkshopControlRepository(db).get(owner, board.id)).toEqual(revealed);
  });

  it('serializes admin downgrade with frozen Yjs writes and hide/reveal control changes', async () => {
    const board = await boards.create(owner, { requestId: randomUUID(), name: '降级串行化' });
    await boards.putMember(owner, board.id, { userId: admin.userId, role: 'editor' });
    await controls.setFreeze(owner, board.id, { requestId: randomUUID(), frozen: true });

    const writeGate = pauseAfterAdminLock(db, admin.userId);
    const gatedCollaboration = new PgWhiteboardCollaborationStore(writeGate.database);
    const oldAdminWrite = gatedCollaboration.writeCommands(admin, board.id, {
      epoch: 1, requestId: randomUUID(),
      commands: [{ type: 'create', object: { id: 'before-downgrade', schemaVersion: 1, kind: 'sticky', text: 'before downgrade', style: {}, parentId: null, orderKey: '', geometry: { x: 0, y: 0, width: 200, height: 120, rotation: 0 } } }],
    });
    await writeGate.entered;
    const writeDowngrade = beginDowngrade(admin.userId);
    try { await expectBlocked(await writeDowngrade.pid); }
    finally { writeGate.release(); }
    await expect(oldAdminWrite).resolves.toMatchObject({ seq: 1 });
    await writeDowngrade.done;
    await expect(collaboration.writeCommands(admin, board.id, {
      epoch: 1, requestId: randomUUID(),
      commands: [{ type: 'create', object: { id: 'after-downgrade', schemaVersion: 1, kind: 'sticky', text: 'after downgrade', style: {}, parentId: null, orderKey: '', geometry: { x: 220, y: 0, width: 200, height: 120, rotation: 0 } } }],
    })).rejects.toMatchObject({ code: 'WORKSHOP_FROZEN' });
    expect((await collaboration.load(owner, board.id)).seq).toBe(1);

    await db.withTenant(orgId, session => session.query("UPDATE org_memberships SET org_role='admin' WHERE org_id=$1 AND user_id=$2", [orgId, admin.userId]));
    const controlGate = pauseAfterAdminLock(db, admin.userId);
    const gatedControls = new PgWorkshopControlRepository(controlGate.database);
    const oldAdminHide = gatedControls.hidePhases(admin, board.id, { requestId: randomUUID(), phaseIds: ['private-input'] });
    await controlGate.entered;
    const controlDowngrade = beginDowngrade(admin.userId);
    try { await expectBlocked(await controlDowngrade.pid); }
    finally { controlGate.release(); }
    await expect(oldAdminHide).resolves.toMatchObject({ hiddenPhaseIds: ['private-input'], revision: 2 });
    await controlDowngrade.done;
    await expect(controls.revealPhases(admin, board.id, { requestId: randomUUID() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await controls.get(owner, board.id)).toMatchObject({ hiddenPhaseIds: ['private-input'], revision: 2 });
  });
});
