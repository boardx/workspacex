/** Real controller/auth/PostgreSQL/Yjs acceptance for Chat → Board. */
import { createHash, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { whiteboard as W, whiteboardImport as I } from '@repo/contracts';
import { createWhiteboardDocument, readObjects } from '@repo/whiteboard-core';
import * as Y from 'yjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WHITEBOARD_COLLABORATION_STORE, type WhiteboardCollaborationStore } from '../../src/application/whiteboard/collaboration-ports';
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from '../support/db';
import { addChatMessage, addChatThread } from '../support/chat-db';

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = '1';
process.env.KERNEL_QUIET = '1';
const ORG = 'wb-chat-import-3975';
const OWNER = 'wb-chat-import-owner', VIEWER = 'wb-chat-import-viewer';
const THREAD = 'wb-chat-import-thread', MESSAGE = 'wb-chat-import-message';
const code = 'flowchart LR\n  a[Start] --> b[Done]';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
let app: NestExpressApplication, base: string, store: WhiteboardCollaborationStore, boardId: string;
const headers = (userId = OWNER) => ({ 'content-type': 'application/json', 'x-kernel-test-principal': `${userId}:${ORG}` });
const bundle = {
  schemaVersion: 1 as const, converterVersion: 'diagram-copy/1' as const, groupId: 'chat-source', payloadReferenceSpace: 'source-local' as const,
  nodeIds: { a: 'a', b: 'b' }, edgeIds: { e: 'e' }, diagnostics: [], model: {
    kind: 'flowchart', direction: 'LR', nodes: [
      { id: 'a', label: 'Start', shape: 'rect', x: 100, y: 100, width: 120, height: 60 },
      { id: 'b', label: 'Done', shape: 'rect', x: 320, y: 100, width: 120, height: 60 },
    ], edges: [{ id: 'e', source: 'a', target: 'b', kind: 'arrow' }],
  },
};
const makeInput = (requestId = randomUUID()) => ({
  requestId, acceptedLosses: ['PLUGIN_STYLE_NOT_RENDERED' as const], bundle,
  sourceRef: { threadId: THREAD, messageId: MESSAGE, kind: 'mermaid' as const, sourceHash: hash(code), blockId: hash(`mermaid\0${code}`), sourceVersion: `sha256:${hash(code)}` },
});

beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); await resetOrgs(ORG); await seedOrg({ orgId: ORG, projectId: `${ORG}-project` });
  await addOrgMember(ORG, OWNER, 'consultant', null); await addOrgMember(ORG, VIEWER, 'consultant', null);
  await addChatThread({ orgId: ORG, id: THREAD, projectId: null, visibilityScope: 'private', createdBy: OWNER });
  await addChatMessage({ orgId: ORG, id: MESSAGE, threadId: THREAD, authorId: 'agent', authorKind: 'agent', body: `\`\`\`mermaid\n${code}\n\`\`\`` });
  const { createApp } = await import('../../src/main'); app = await createApp(); store = app.get(WHITEBOARD_COLLABORATION_STORE);
  await app.listen(0, '127.0.0.1'); const address = app.getHttpServer().address(); if (!address || typeof address === 'string') throw new Error('missing address');
  base = `http://127.0.0.1:${address.port}`;
  const created = await fetch(`${base}/whiteboards`, { method: 'POST', headers: headers(), body: JSON.stringify({ requestId: randomUUID(), name: 'Chat imports' }) });
  boardId = W.Board.parse(await created.json()).id;
  const member = await fetch(`${base}/whiteboards/${boardId}/members`, { method: 'PUT', headers: headers(), body: JSON.stringify({ userId: VIEWER, role: 'viewer' }) });
  expect(member.status).toBe(200);
});
afterAll(async () => { await app?.close(); await resetOrgs(ORG); });

describe('Chat → Board real HTTP boundary', () => {
  it('atomically persists editable objects and replays the same request without duplication', async () => {
    const input = makeInput();
    const first = await fetch(`${base}/whiteboards/${boardId}/import-diagram`, { method: 'POST', headers: headers(), body: JSON.stringify(input) });
    expect(first.status).toBe(201); const result = I.ImportDiagramResult.parse(await first.json());
    expect(result.losses.map(loss => loss.code)).toContain('PLUGIN_STYLE_NOT_RENDERED');
    const retry = await fetch(`${base}/whiteboards/${boardId}/import-diagram`, { method: 'POST', headers: headers(), body: JSON.stringify(input) });
    expect(retry.status).toBe(201); expect(I.ImportDiagramResult.parse(await retry.json()).seq).toBe(result.seq);
    const count = await asApp(ORG, client => client.query<{ n: string }>('SELECT count(*)::text n FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 AND update_id=$3', [ORG, boardId, input.requestId]));
    expect(count.rows[0]?.n).toBe('1');
    const state = await store.load({ userId: OWNER, orgId: ORG as never }, boardId), doc = createWhiteboardDocument(); Y.applyUpdate(doc, state.update);
    const objects = readObjects(doc), group = objects.find(item => item.id === result.groupId);
    expect(objects).toHaveLength(4); expect(group?.kind).toBe('group'); expect(group?.extensionData?.sourceRef).toMatchObject({ threadId: THREAD, messageId: MESSAGE, sourceHash: hash(code) });
  });

  it('rejects viewer writes and changed sources without appending an update', async () => {
    const before = await asApp(ORG, client => client.query<{ n: string }>('SELECT count(*)::text n FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2', [ORG, boardId]));
    const viewer = await fetch(`${base}/whiteboards/${boardId}/import-diagram`, { method: 'POST', headers: headers(VIEWER), body: JSON.stringify(makeInput()) });
    expect(viewer.status).toBe(403);
    const changed = makeInput(); changed.sourceRef.sourceHash = '0'.repeat(64); changed.sourceRef.sourceVersion = `sha256:${'0'.repeat(64)}`;
    const stale = await fetch(`${base}/whiteboards/${boardId}/import-diagram`, { method: 'POST', headers: headers(), body: JSON.stringify(changed) });
    expect(stale.status).toBe(409);
    const after = await asApp(ORG, client => client.query<{ n: string }>('SELECT count(*)::text n FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2', [ORG, boardId]));
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });
});
