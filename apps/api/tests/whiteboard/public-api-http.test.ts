/** Real session guard/controller/PG boundary. Run by integration owner, not worker agents. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as C from '@repo/contracts/whiteboard-public';
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from '../support/db';
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = '1'; process.env.KERNEL_QUIET = '1';
const ORG = 'wb-public-http-a', OTHER = 'wb-public-http-b', OWNER = 'wb-public-owner', VIEWER = 'wb-public-viewer';
let app: NestExpressApplication, base: string;
const headers = (user = OWNER, org = ORG) => ({ 'content-type': 'application/json', 'x-kernel-test-principal': `${user}:${org}` });
const call = (method: string, path: string, body?: unknown, user = OWNER, org = ORG) => fetch(`${base}/whiteboards${path}`, { method, headers: headers(user, org), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
async function create(): Promise<string> { const response = await call('POST', '', { name: '公开接口', requestId: randomUUID() }); expect(response.status).toBe(201); return (await response.json() as { id: string }).id; }
const commands = (requestId = randomUUID()) => ({ epoch: 1, requestId, commands: [{ type: 'create', object: { id: 'note', kind: 'sticky', schemaVersion: 1, text: 'API 创建的便签', style: {}, geometry: { x: 10, y: 20, width: 200, height: 100, rotation: 0 } } }] });
beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); await resetOrgs(ORG, OTHER);
  await seedOrg({ orgId: ORG, projectId: `${ORG}-project` }); await seedOrg({ orgId: OTHER, projectId: `${OTHER}-project` });
  for (const user of [OWNER, VIEWER]) await addOrgMember(ORG, user, 'consultant', null);
  await addOrgMember(OTHER, OWNER, 'consultant', null);
  const { createApp } = await import('../../src/main'); app = await createApp(); await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address(); if (!address || typeof address === 'string') throw new Error('No HTTP test address'); base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await app?.close(); await resetOrgs(ORG, OTHER); });
it('requires authentication on both public API methods', async () => {
  const id = randomUUID();
  expect((await fetch(`${base}/whiteboards/${id}/document`)).status).toBe(401);
  expect((await fetch(`${base}/whiteboards/${id}/commands`, { method: 'POST' })).status).toBe(401);
});
it('creates durable content, returns a public projection and replays the same request once', async () => {
  const id = await create(), body = commands();
  const first = await call('POST', `/${id}/commands`, body); expect(first.status).toBe(200);
  const ack = C.PublicWhiteboardCommandResult.parse(await first.json()); expect(ack).toMatchObject({ seq: 1, durable: true, replayed: false });
  const repeat = await call('POST', `/${id}/commands`, body); expect(repeat.status).toBe(200); expect(C.PublicWhiteboardCommandResult.parse(await repeat.json())).toMatchObject({ seq: 1, replayed: true });
  const response = await call('GET', `/${id}/document`); expect(response.status).toBe(200);
  const document = C.PublicWhiteboardDocument.parse(await response.json()); expect(document.seq).toBe(1); expect(document.objects).toHaveLength(1); expect(document.objects[0]?.text).toBe('API 创建的便签');
});
it('allows a viewer document read but rejects viewer writes and cross-tenant reads', async () => {
  const id = await create(); await call('PUT', `/${id}/members`, { userId: VIEWER, role: 'viewer' });
  const read = await call('GET', `/${id}/document`, undefined, VIEWER); expect(read.status).toBe(200); expect(C.PublicWhiteboardDocument.parse(await read.json()).role).toBe('viewer');
  expect((await call('POST', `/${id}/commands`, commands(), VIEWER)).status).toBe(403);
  expect((await call('GET', `/${id}/document`, undefined, OWNER, OTHER)).status).toBe(404);
});
it('rejects stale epoch, changed idempotency payload and undeclared fields', async () => {
  const id = await create(), body = commands();
  expect((await call('POST', `/${id}/commands`, { ...body, epoch: 2 })).status).toBe(409);
  expect((await call('POST', `/${id}/commands`, { ...body, actorId: 'forged-owner' })).status).toBe(400);
  expect((await call('POST', `/${id}/commands`, body)).status).toBe(200);
  expect((await call('POST', `/${id}/commands`, { ...body, commands: [{ type: 'delete', id: 'note' }] })).status).toBe(409);
  expect(C.PublicWhiteboardDocument.parse(await (await call('GET', `/${id}/document`)).json()).seq).toBe(1);
});
