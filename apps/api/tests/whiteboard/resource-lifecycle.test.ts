import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgDatabase } from '../../src/infrastructure/db/pg-database';
import { appConfig } from '../../src/infrastructure/db/pg-config';
import { PgWhiteboardRepository } from '../../src/infrastructure/whiteboard/pg-whiteboard-repository';
import { toOrgId } from '../../src/domain/org-id';
import type { Principal } from '../../src/domain/principal';
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from '../support/db';
const orgId = toOrgId('wb-resource-3926-a'), otherOrg = toOrgId('wb-resource-3926-b');
const actor = (userId: string, org = orgId): Principal => ({ userId, orgId: org });
const owner = actor('wb-3926-owner'), editor = actor('wb-3926-editor'), viewer = actor('wb-3926-viewer');
const colleague = actor('wb-3926-colleague'), outsider = actor('wb-3926-outsider', otherOrg);
let db: PgDatabase;
let repo: PgWhiteboardRepository;
const create = () => repo.create(owner, { requestId: randomUUID(), name: '团队白板' });
beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); await resetOrgs(orgId, otherOrg);
  await seedOrg({ orgId, projectId: 'wb-3926-project-a' });
  await seedOrg({ orgId: otherOrg, projectId: 'wb-3926-project-b' });
  for (const p of [owner, editor, viewer, colleague, outsider]) await addOrgMember(p.orgId, p.userId, 'consultant', null);
  db = new PgDatabase(appConfig()); repo = new PgWhiteboardRepository(db);
});
afterAll(async () => { await db?.close(); await resetOrgs(orgId, otherOrg); });
describe('whiteboard resource lifecycle on real PostgreSQL', () => {
  it('concurrent retries create one private board and a fresh connection reads it back', async () => {
    const input = { requestId: randomUUID(), name: '幂等白板' };
    const [first, retry] = await Promise.all([repo.create(owner, input), repo.create(owner, input)]);
    expect(retry.id).toBe(first.id); expect(first).toMatchObject({ name: input.name, ownerId: owner.userId, role: 'owner', archived: false });
    expect((await repo.list(owner)).filter(b => b.id === first.id)).toHaveLength(1);
    const fresh = new PgDatabase(appConfig());
    try { expect(await new PgWhiteboardRepository(fresh).get(owner, first.id)).toEqual(first); }
    finally { await fresh.close(); }
  });
  it('private default excludes same-org users and cross-org access', async () => {
    const board = await create();
    expect(await repo.get(colleague, board.id)).toBeNull();
    expect((await repo.list(colleague)).some(b => b.id === board.id)).toBe(false);
    const crossOwner = actor(owner.userId, otherOrg);
    expect(await repo.get(crossOwner, board.id)).toBeNull();
    expect(await repo.update(crossOwner, board.id, { name: '非法修改' })).toBeNull();
    expect(await repo.members(crossOwner, board.id)).toBeNull();
    expect(await repo.putMember(crossOwner, board.id, { userId: outsider.userId, role: 'editor' })).toBe(false);
    expect(await repo.removeMember(crossOwner, board.id, viewer.userId)).toBe(false);
    expect((await repo.list(outsider)).some(b => b.id === board.id)).toBe(false);
    expect((await repo.get(owner, board.id))?.name).toBe('团队白板');
  });
  it('owner renames, archives and restores persisted metadata', async () => {
    const board = await create();
    expect(await repo.update(owner, board.id, { name: '新的名称' })).toMatchObject({ name: '新的名称' });
    expect(await repo.update(owner, board.id, { archived: true })).toMatchObject({ archived: true });
    expect(await repo.get(owner, board.id)).toMatchObject({ name: '新的名称', archived: true });
    expect(await repo.update(owner, board.id, { archived: false })).toMatchObject({ archived: false });
    expect((await repo.list(owner)).some(b => b.id === board.id)).toBe(true);
  });
  it.each([['editor', editor], ['viewer', viewer]] as const)('%s can read but cannot manage metadata or membership', async (role, member) => {
    const board = await create();
    expect(await repo.putMember(owner, board.id, { userId: member.userId, role })).toBe(true);
    expect(await repo.get(member, board.id)).toMatchObject({ id: board.id, role });
    expect((await repo.list(member)).some(b => b.id === board.id)).toBe(true);
    expect(await repo.update(member, board.id, { name: '非法修改', archived: true })).toBeNull();
    expect(await repo.members(member, board.id)).toBeNull();
    expect(await repo.putMember(member, board.id, { userId: colleague.userId, role: 'editor' })).toBe(false);
    expect(await repo.removeMember(member, board.id, member.userId)).toBe(false);
    expect(await repo.get(owner, board.id)).toMatchObject({ name: '团队白板', archived: false });
    expect(await repo.members(owner, board.id)).toContainEqual({ userId: member.userId, role });
  });
  it('owner grants only same-org members and revocation removes read access', async () => {
    const board = await create();
    expect(await repo.putMember(owner, board.id, { userId: outsider.userId, role: 'viewer' })).toBe(false);
    expect(await repo.putMember(owner, board.id, { userId: 'wb-3926-nonmember', role: 'editor' })).toBe(false);
    expect(await repo.putMember(owner, board.id, { userId: colleague.userId, role: 'viewer' })).toBe(true);
    expect(await repo.get(colleague, board.id)).toMatchObject({ role: 'viewer' });
    expect(await repo.putMember(owner, board.id, { userId: colleague.userId, role: 'editor' })).toBe(true);
    expect(await repo.get(colleague, board.id)).toMatchObject({ role: 'editor' });
    expect(await repo.removeMember(owner, board.id, colleague.userId)).toBe(true);
    expect(await repo.get(colleague, board.id)).toBeNull();
    expect((await repo.list(colleague)).some(b => b.id === board.id)).toBe(false);
    expect(await repo.members(owner, board.id)).toEqual([]);
  });
});
