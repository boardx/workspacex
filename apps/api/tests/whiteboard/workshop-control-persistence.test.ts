import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgDatabase } from '../../src/infrastructure/db/pg-database';
import { appConfig } from '../../src/infrastructure/db/pg-config';
import { PgWhiteboardRepository } from '../../src/infrastructure/whiteboard/pg-whiteboard-repository';
import { PgWhiteboardCollaborationStore } from '../../src/infrastructure/whiteboard/pg-collaboration-store';
import { PgWorkshopControlRepository } from '../../src/infrastructure/whiteboard/pg-workshop-control-repository';
import { toOrgId } from '../../src/domain/org-id';
import type { Principal } from '../../src/domain/principal';
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from '../support/db';

const orgId = toOrgId('wb-workshop-control-a'), otherOrg = toOrgId('wb-workshop-control-b');
const owner: Principal = { orgId, userId: 'wb-control-owner' };
const editor: Principal = { orgId, userId: 'wb-control-editor' };
const admin: Principal = { orgId, userId: 'wb-control-admin' };
const crossTenant: Principal = { orgId: otherOrg, userId: owner.userId };
let db: PgDatabase, boards: PgWhiteboardRepository, controls: PgWorkshopControlRepository, collaboration: PgWhiteboardCollaborationStore;

beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); await resetOrgs(orgId, otherOrg);
  await seedOrg({ orgId, projectId: 'wb-workshop-control-project-a' });
  await seedOrg({ orgId: otherOrg, projectId: 'wb-workshop-control-project-b' });
  await addOrgMember(orgId, owner.userId, 'consultant', null);
  await addOrgMember(orgId, editor.userId, 'consultant', null);
  await addOrgMember(orgId, admin.userId, 'admin', null);
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
});
