import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgDatabase } from '../../src/infrastructure/db/pg-database';
import { appConfig } from '../../src/infrastructure/db/pg-config';
import { PgWhiteboardRepository } from '../../src/infrastructure/whiteboard/pg-whiteboard-repository';
import { PgWhiteboardTagRepository } from '../../src/infrastructure/whiteboard/pg-whiteboard-tag-repository';
import { toOrgId } from '../../src/domain/org-id';
import type { Principal } from '../../src/domain/principal';
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from '../support/db';
const orgId = toOrgId('wb-resource-3926-a'), otherOrg = toOrgId('wb-resource-3926-b');
const actor = (userId: string, org = orgId): Principal => ({ userId, orgId: org });
const owner = actor('wb-3926-owner'), admin = actor('wb-4242-admin'), editor = actor('wb-3926-editor'), viewer = actor('wb-3926-viewer');
const colleague = actor('wb-3926-colleague'), outsider = actor('wb-3926-outsider', otherOrg);
let db: PgDatabase;
let repo: PgWhiteboardRepository;
let tags: PgWhiteboardTagRepository;
const create = () => repo.create(owner, { requestId: randomUUID(), name: '团队白板' });
beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); await resetOrgs(orgId, otherOrg);
  await seedOrg({ orgId, projectId: 'wb-3926-project-a' });
  await seedOrg({ orgId: otherOrg, projectId: 'wb-3926-project-b' });
  for (const p of [owner, editor, viewer, colleague, outsider]) await addOrgMember(p.orgId, p.userId, 'consultant', null);
  await addOrgMember(admin.orgId,admin.userId,'admin',null);
  db = new PgDatabase(appConfig()); repo = new PgWhiteboardRepository(db); tags = new PgWhiteboardTagRepository(db);
});
afterAll(async () => { await db?.close(); await resetOrgs(orgId, otherOrg); });
describe('whiteboard resource lifecycle on real PostgreSQL', () => {
  it('concurrent retries create one private board and a fresh connection reads it back', async () => {
    const input = { requestId: randomUUID(), name: '幂等白板' };
    const [first, retry] = await Promise.all([repo.create(owner, input), repo.create(owner, input)]);
    expect(retry.id).toBe(first.id); expect(first).toMatchObject({ name: input.name, ownerId: owner.userId, role: 'owner', archived: false });
    expect((await repo.list(owner)).items.filter(b => b.id === first.id)).toHaveLength(1);
    const fresh = new PgDatabase(appConfig());
    try { expect(await new PgWhiteboardRepository(fresh).get(owner, first.id)).toEqual(first); }
    finally { await fresh.close(); }
  });
  it('private default excludes same-org users and cross-org access', async () => {
    const board = await create();
    expect(await repo.get(colleague, board.id)).toBeNull();
    expect((await repo.list(colleague)).items.some(b => b.id === board.id)).toBe(false);
    const crossOwner = actor(owner.userId, otherOrg);
    expect(await repo.get(crossOwner, board.id)).toBeNull();
    expect(await repo.update(crossOwner, board.id, { name: '非法修改' })).toBeNull();
    expect(await repo.members(crossOwner, board.id)).toBeNull();
    expect(await repo.putMember(crossOwner, board.id, { userId: outsider.userId, role: 'editor' })).toBe(false);
    expect(await repo.removeMember(crossOwner, board.id, viewer.userId)).toBe(false);
    expect((await repo.list(outsider)).items.some(b => b.id === board.id)).toBe(false);
    expect((await repo.get(owner, board.id))?.name).toBe('团队白板');
  });
  it('owner renames, archives and restores persisted metadata', async () => {
    const board = await create();
    expect(await repo.update(owner, board.id, { name: '新的名称' })).toMatchObject({ name: '新的名称' });
    const archived=await repo.update(owner, board.id, { archived: true, expectedLifecycleRevision: board.lifecycleRevision });
    expect(archived).toMatchObject({ archived: true, lifecycleRevision: board.lifecycleRevision+1 });
    expect(await repo.get(owner, board.id)).toMatchObject({ name: '新的名称', archived: true });
    expect(await repo.update(owner, board.id, { archived: false, expectedLifecycleRevision: archived!.lifecycleRevision }))
      .toMatchObject({ archived: false, lifecycleRevision: archived!.lifecycleRevision+1 });
    expect((await repo.list(owner,{archived:'all',limit:30})).items.some(b => b.id === board.id)).toBe(true);
  });
  it.each([['editor', editor], ['viewer', viewer]] as const)('%s can read but cannot manage metadata or membership', async (role, member) => {
    const board = await create();
    expect(await repo.putMember(owner, board.id, { userId: member.userId, role })).toBe(true);
    expect(await repo.get(member, board.id)).toMatchObject({ id: board.id, role });
    expect((await repo.list(member)).items.some(b => b.id === board.id)).toBe(true);
    expect(await repo.update(member, board.id, { name: '非法修改', archived: true, expectedLifecycleRevision: board.lifecycleRevision })).toBeNull();
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
    expect((await repo.list(colleague)).items.some(b => b.id === board.id)).toBe(false);
    expect(await repo.members(owner, board.id)).toEqual([]);
  });
  it('uses stable tag IDs, CAS replacement and AND filtering without leaking other boards', async () => {
    const first = await create(), second = await create();
    const research = await tags.createTag(owner,{requestId:randomUUID(),name:'Research'});
    const urgentRequest = randomUUID(), urgent = await tags.createTag(owner,{requestId:urgentRequest,name:'Urgent'});
    expect((await tags.createTag(owner,{requestId:urgentRequest,name:'Urgent'})).id).toBe(urgent.id);
    await expect(tags.createTag(owner,{requestId:urgentRequest,name:'Changed'})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
    expect(await repo.update(owner,first.id,{tagIds:[research.id,urgent.id],expectedTagsRevision:0})).toMatchObject({tagIds:[research.id,urgent.id].sort(),tagsRevision:1});
    expect(await repo.update(owner,second.id,{tagIds:[research.id],expectedTagsRevision:0})).toMatchObject({tagsRevision:1});
    await expect(repo.update(owner,first.id,{tagIds:[urgent.id],expectedTagsRevision:0})).rejects.toMatchObject({code:'REVISION_CONFLICT'});
    const filtered = await repo.list(owner,{archived:'active',limit:30,query:'团队',tagIds:[urgent.id,research.id]});
    expect(filtered.items.map(board => board.id)).toEqual([first.id]);
    expect((await repo.list(outsider,{archived:'all',limit:30,tagIds:[]})).items).toEqual([]);
    expect((await tags.listTags(outsider)).some(tag=>tag.id===research.id)).toBe(false);
    const renamed = await tags.renameTag(admin,research.id,{requestId:randomUUID(),name:'Customer Research',expectedRevision:1});
    expect(renamed).toMatchObject({id:research.id,name:'Customer Research',revision:2});
    expect(await tags.renameTag(colleague,research.id,{requestId:randomUUID(),name:'Forbidden',expectedRevision:2})).toBeNull();
    const deleted = await tags.deleteTag(owner,research.id,{requestId:randomUUID(),expectedRevision:2});
    expect(deleted).toMatchObject({tagId:research.id,deleted:true});
    expect((await repo.get(owner,first.id))?.tagIds).toEqual([urgent.id]);
    await expect(repo.list(owner,{archived:'active',limit:30,tagIds:[research.id]})).rejects.toMatchObject({code:'TAG_NOT_FOUND'});
  });
  it('requires archive before permanent delete and replays a durable delete receipt', async () => {
    const board = await create(), requestId = randomUUID();
    const input = {requestId,confirmation:'PERMANENTLY_DELETE' as const,expectedLifecycleRevision:board.lifecycleRevision};
    await expect(repo.permanentlyDelete(owner,board.id,input)).rejects.toMatchObject({code:'BOARD_NOT_ARCHIVED'});
    const archived = await repo.update(owner,board.id,{archived:true,expectedLifecycleRevision:board.lifecycleRevision});
    const deleteInput = {...input,expectedLifecycleRevision:archived!.lifecycleRevision};
    const receipt = await repo.permanentlyDelete(owner,board.id,deleteInput);
    expect(receipt).toEqual({requestId,boardId:board.id,deleted:true});
    expect(await repo.permanentlyDelete(owner,board.id,deleteInput)).toEqual(receipt);
    expect(await repo.get(owner,board.id)).toBeNull();
    const other = await create(); const otherArchived=await repo.update(owner,other.id,{archived:true,expectedLifecycleRevision:other.lifecycleRevision});
    await expect(repo.permanentlyDelete(owner,other.id,{...deleteInput,expectedLifecycleRevision:otherArchived!.lifecycleRevision})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  });
  it('rejects an old delete confirmation after archive, restore and re-archive', async () => {
    const board=await create();
    const firstArchive=await repo.update(owner,board.id,{archived:true,expectedLifecycleRevision:board.lifecycleRevision});
    const staleDelete={requestId:randomUUID(),confirmation:'PERMANENTLY_DELETE' as const,expectedLifecycleRevision:firstArchive!.lifecycleRevision};
    const restored=await repo.update(owner,board.id,{archived:false,expectedLifecycleRevision:firstArchive!.lifecycleRevision});
    const reArchived=await repo.update(owner,board.id,{archived:true,expectedLifecycleRevision:restored!.lifecycleRevision});
    await expect(repo.permanentlyDelete(owner,board.id,staleDelete)).rejects.toMatchObject({code:'REVISION_CONFLICT'});
    expect(await repo.get(owner,board.id)).toMatchObject({archived:true,lifecycleRevision:reArchived!.lifecycleRevision});
    await expect(repo.update(owner,board.id,{archived:false,expectedLifecycleRevision:firstArchive!.lifecycleRevision})).rejects.toMatchObject({code:'REVISION_CONFLICT'});
  });
});
