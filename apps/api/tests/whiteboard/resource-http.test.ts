/** Real HTTP/controller/guard/PostgreSQL coverage; never run with a fake repository. */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { whiteboard as C } from '@repo/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from '../support/db';

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = '1';
process.env.KERNEL_QUIET = '1';
const ORG = 'wb-resource-http-3926-a';
const OTHER = 'wb-resource-http-3926-b';
const OWNER = 'wb-http-owner';
const MEMBER = 'wb-http-member';
const OUTSIDER = 'wb-http-outsider';
let app: NestExpressApplication;
let base: string;
const headers = (userId = OWNER, orgId = ORG) => ({
  'content-type': 'application/json', 'x-kernel-test-principal': `${userId}:${orgId}`,
});
const call = (method: string, path: string, body?: unknown, userId = OWNER, orgId = ORG) =>
  fetch(`${base}/whiteboards${path}`, { method, headers: headers(userId, orgId),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
async function create(name = 'HTTP 协作白板') {
  const res = await call('POST', '', { requestId: randomUUID(), name });
  expect(res.status).toBe(201);
  return C.operations.createBoard.out.parse(await res.json());
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG, OTHER);
  await seedOrg({ orgId: ORG, projectId: `${ORG}-project` });
  await seedOrg({ orgId: OTHER, projectId: `${OTHER}-project` });
  for (const userId of [OWNER, MEMBER]) await addOrgMember(ORG, userId, 'consultant', null);
  await addOrgMember(OTHER, OUTSIDER, 'consultant', null);
  // Same actor in two tenants ensures isolation is not merely owner-id filtering.
  await addOrgMember(OTHER, OWNER, 'consultant', null);
  const { createApp } = await import('../../src/main');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string') throw new Error('HTTP fixture has no TCP address');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await app?.close(); await resetOrgs(ORG, OTHER); });

describe('whiteboard resource HTTP boundary', () => {
  it('rejects unauthenticated requests before resource access', async () => {
    const id = randomUUID();
    for (const [method, path] of [['GET', ''], ['POST', ''], ['GET', `/${id}`], ['PATCH', `/${id}`], ['GET', `/${id}/members`], ['PUT', `/${id}/members`], ['DELETE', `/${id}/members/${MEMBER}`]]) {
      const res = await fetch(`${base}/whiteboards${path}`, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it('creates 201, reads persisted data, lists, renames, archives and restores with strict response schemas', async () => {
    const board = await create();
    expect(board).toMatchObject({ ownerId: OWNER, role: 'owner', archived: false });
    const rows = await asApp(ORG, c => c.query('SELECT name, owner_id, archived FROM whiteboards WHERE org_id=$1 AND id=$2', [ORG, board.id]));
    expect(rows.rows).toEqual([{ name: 'HTTP 协作白板', owner_id: OWNER, archived: false }]);
    const get = await call('GET', `/${board.id}`);
    expect(get.status).toBe(200);
    expect(C.operations.getBoard.out.parse(await get.json())).toEqual(board);
    const listed = await call('GET', '');
    expect(listed.status).toBe(200);
    expect(C.operations.listBoards.out.parse(await listed.json()).items).toContainEqual(board);
    for (const changes of [{ name: '重命名白板' }, { archived: true }, { archived: false }]) {
      const res = await call('PATCH', `/${board.id}`, changes);
      expect(res.status).toBe(200);
      expect(C.operations.updateBoard.out.parse(await res.json())).toMatchObject(changes);
    }
    const persisted = await asApp(ORG, c => c.query('SELECT name, archived FROM whiteboards WHERE org_id=$1 AND id=$2', [ORG, board.id]));
    expect(persisted.rows).toEqual([{ name: '重命名白板', archived: false }]);
  });

  it('hides private boards and all management paths from another tenant, even the same owner ID', async () => {
    const board = await create();
    for (const [method, path, body] of [
      ['GET', `/${board.id}`, undefined], ['PATCH', `/${board.id}`, { name: 'intrusion' }],
      ['GET', `/${board.id}/members`, undefined], ['PUT', `/${board.id}/members`, { userId: OUTSIDER, role: 'viewer' }],
      ['DELETE', `/${board.id}/members/${MEMBER}`, undefined],
    ] as const) expect((await call(method, path, body, OWNER, OTHER)).status, method).toBe(404);
    const listed = await call('GET', '', undefined, OWNER, OTHER);
    expect(C.operations.listBoards.out.parse(await listed.json()).items.some(b => b.id === board.id)).toBe(false);
    expect((await call('GET', `/${board.id}`, undefined, MEMBER)).status).toBe(404);
    const missing = await call('GET', `/${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect(C.Board.parse(await (await call('GET', `/${board.id}`)).json()).name).toBe(board.name);
  });

  it('grants editor/viewer access, denies member management, and revokes on the next request', async () => {
    const board = await create();
    for (const role of ['editor', 'viewer'] as const) {
      const put = await call('PUT', `/${board.id}/members`, { userId: MEMBER, role });
      expect(put.status).toBe(200);
      expect(C.operations.putMember.out.parse(await put.json())).toEqual({ ok: true });
      const get = await call('GET', `/${board.id}`, undefined, MEMBER);
      expect(get.status).toBe(200);
      expect(C.Board.parse(await get.json()).role).toBe(role);
      const members = await call('GET', `/${board.id}/members`);
      expect(C.operations.listMembers.out.parse(await members.json()).items).toEqual([{ userId: MEMBER, role }]);
      expect((await call('PATCH', `/${board.id}`, { name: 'not-owner' }, MEMBER)).status).toBe(404);
      expect((await call('GET', `/${board.id}/members`, undefined, MEMBER)).status).toBe(404);
      expect((await call('PUT', `/${board.id}/members`, { userId: OWNER, role: 'editor' }, MEMBER)).status).toBe(404);
      expect((await call('DELETE', `/${board.id}/members/${MEMBER}`, undefined, MEMBER)).status).toBe(404);
    }
    expect((await call('PUT', `/${board.id}/members`, { userId: OUTSIDER, role: 'viewer' })).status).toBe(404);
    const removed = await call('DELETE', `/${board.id}/members/${MEMBER}`);
    expect(removed.status).toBe(200);
    expect(C.operations.removeMember.out.parse(await removed.json())).toEqual({ ok: true });
    expect((await call('GET', `/${board.id}`, undefined, MEMBER)).status).toBe(404);
    const list = await call('GET', '', undefined, MEMBER);
    expect(C.operations.listBoards.out.parse(await list.json()).items.some(b => b.id === board.id)).toBe(false);
  });

  it('rejects malformed UUIDs and invalid/unknown body fields with 400', async () => {
    const board = await create();
    for (const [method, path, body] of [
      ['GET', '/not-a-uuid', undefined], ['PATCH', '/not-a-uuid', { name: 'x' }],
      ['GET', '/not-a-uuid/members', undefined], ['PUT', '/not-a-uuid/members', { userId: MEMBER, role: 'viewer' }],
      ['DELETE', `/not-a-uuid/members/${MEMBER}`, undefined],
      ['POST', '', { requestId: 'bad', name: 'x' }], ['POST', '', { requestId: randomUUID(), name: '   ' }],
      ['POST', '', { requestId: randomUUID(), name: 'x', orgId: OTHER }],
      ['PATCH', `/${board.id}`, {}], ['PATCH', `/${board.id}`, { archived: 'yes' }],
      ['PATCH', `/${board.id}`, { ownerId: MEMBER }],
      ['PUT', `/${board.id}/members`, { userId: MEMBER, role: 'owner' }],
      ['PUT', `/${board.id}/members`, { userId: '', role: 'editor' }],
    ] as const) expect((await call(method, path, body)).status, `${method} ${path} ${JSON.stringify(body)}`).toBe(400);
    expect(C.Board.parse(await (await call('GET', `/${board.id}`)).json())).toEqual(board);
  });
});
