import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, expect, it} from 'vitest';
import * as Y from 'yjs';
import {createWhiteboardDocument, executeCommands, readObjects} from '@repo/whiteboard-core';
import {FsObjectStore} from '../../src/infrastructure/storage/fs-object-store';
import {PgBoardContentCopyStore} from '../../src/infrastructure/whiteboard/pg-board-content-copy-store';
import type {DatabasePort, TenantSession} from '../../src/application/ports/database.port';
import {toOrgId} from '../../src/domain/org-id';
const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'board-copy-files-')); roots.push(root);
  const objects = new FsObjectStore(root), p = {orgId: toOrgId('copy-org'), userId: 'copy-owner'}, sourceId = randomUUID();
  const bytes = Buffer.from('verified-image-byte-content'), hash = digest(bytes);
  const metadata = {assetId: `board-image-${hash}`, persistence: 'durable', contentDigest: `sha256:${hash}`, byteSize: bytes.length, mimeType: 'image/png', magicMimeType: 'image/png', intrinsicWidth: 1, intrinsicHeight: 1};
  const sourceKey = `whiteboards/tenants/${digest(p.orgId).slice(0,32)}/boards/${sourceId}/assets/${hash}`;
  await objects.putOnce(sourceKey, bytes, 'image/png');
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{type: 'create', object: {id: 'copied-image', schemaVersion: 1, kind: 'image', geometry: {x: 0, y: 0, width: 100, height: 100, rotation: 0}, text: '', style: {}, parentId: null, orderKey: 'a', extensionData: {contentObject: {version: 1, type: 'image', ...metadata, status: 'ready', sourceUrl: null, crop: {x:0,y:0,width:1,height:1}, opacity: 1, borderColor: '#000000', borderWidth: 0, cornerRadius: 0, fileName: 'image.png', replacementOf: null, failureCode: null}}}}], {});
  const snapshot = Y.encodeStateAsUpdate(doc); doc.destroy();
  const queries: Array<{sql: string; values: readonly unknown[]}> = []; let targetId = '', sourceRecord = {object_key: sourceKey, metadata};
  const session: TenantSession = {async query<R>(sql: string, values: readonly unknown[] = []) {
    queries.push({sql, values}); let rows: unknown[] = [];
    if (sql.startsWith('INSERT INTO whiteboard_duplicate_requests')) rows = [{job_id: values[0]}];
    else if (sql.startsWith('SELECT b.owner_id')) rows = [{owner_id: p.userId, role: 'owner'}];
    else if (sql.startsWith('SELECT a.object_key')) rows = [sourceRecord];
    else if (sql.startsWith('INSERT INTO whiteboards')) targetId = String(values[0]);
    else if (sql.startsWith('SELECT b.id,b.name')) rows = [{id:targetId,name:'copy',owner_id:p.userId,role:'owner',archived:false,lifecycle_revision:0,tags_revision:0,tag_ids:[],created_at:new Date(0),updated_at:new Date(0)}];
    return {rows: rows as R[]};
  }};
  const db: DatabasePort = {withTenant: async (org, fn) => {expect(org).toBe(p.orgId); return fn(session);}, withoutTenant: async () => {throw new Error('unscoped');}, close: async () => {}};
  const loader = {loadInTransaction: async (actual: TenantSession) => {expect(actual).toBe(session); return {epoch: 3, seq: 7, update: snapshot, role: 'owner' as const, archived: false};}};
  const run = (store = objects) => new PgBoardContentCopyStore(db, loader, store).duplicate(p, sourceId, {requestId: randomUUID(),targetName:'copy'}, () => ({snapshot,objectCount:1,connectorCount:0,assetCount:1}));
  return {objects, queries, run, bytes, sourceKey, metadata, sourceId, setSourceKey: (value: string) => {sourceRecord = {...sourceRecord, object_key:value};}};
}
it('copies real filesystem bytes to a target-scoped asset root and publishes only a verified snapshot pointer', async () => {
  const f = await fixture(), result = await f.run();
  const pointer = f.queries.find(query => query.sql.startsWith('INSERT INTO whiteboard_documents'))!;
  expect(pointer.sql).toContain('VALUES($1,$2,1,0,NULL,1,$3,$4,$5)'); expect(pointer.values.some(value => value instanceof Uint8Array)).toBe(false);
  const bytes = await f.objects.get(String(pointer.values[2])); expect(bytes).not.toBeNull(); expect(digest(bytes!)).toBe(pointer.values[3]);
  const doc = createWhiteboardDocument(); Y.applyUpdate(doc,bytes!); expect(readObjects(doc)).toHaveLength(1); doc.destroy();
  const asset = f.queries.find(query => query.sql.startsWith('INSERT INTO whiteboard_image_assets'))!;
  expect(asset.values[1]).toBe(result.board.id); expect(asset.values[2]).toBe(f.metadata.assetId);
  expect(String(asset.values[3])).toContain(`/boards/${result.board.id}/assets/`); expect(asset.values[3]).not.toBe(f.sourceKey);
  expect(Buffer.from((await f.objects.get(String(asset.values[3])))!)).toEqual(f.bytes);
  const ref = f.queries.find(query => query.sql.startsWith('INSERT INTO whiteboard_asset_refs'))!; expect(ref.values[1]).toBe(result.board.id);
  expect(f.queries.find(query => query.sql.startsWith('SELECT a.object_key'))!.sql).toContain("a.org_id=$1 AND a.board_id=$2 AND a.asset_id=$3 AND r.state='active'");
});
it('refuses a source asset key belonging to another board before publishing references', async () => {
  const f = await fixture(); f.setSourceKey(f.sourceKey.replace(f.sourceId,randomUUID()));
  await expect(f.run()).rejects.toMatchObject({code:'COPY_INTEGRITY_FAILED'});
  expect(f.queries.some(query => query.sql.startsWith('INSERT INTO whiteboard_documents') || query.sql.startsWith('INSERT INTO whiteboard_asset_refs'))).toBe(false);
});
it('refuses corrupt source bytes even when metadata claims a valid hash', async () => {
  const f = await fixture(), original = f.objects.get.bind(f.objects);
  f.objects.get = async key => key === f.sourceKey ? new Uint8Array(f.bytes.length) : original(key);
  await expect(f.run()).rejects.toMatchObject({code:'COPY_INTEGRITY_FAILED'});
  expect(f.queries.some(query => query.sql.startsWith('INSERT INTO whiteboard_documents'))).toBe(false);
});
it('does not publish a document pointer when immutable snapshot readback is corrupt', async () => {
  const f = await fixture(), original = f.objects.get.bind(f.objects);
  f.objects.get = async key => key.endsWith('.yjs') ? new Uint8Array([0,0]) : original(key);
  await expect(f.run()).rejects.toMatchObject({code:'COPY_INTEGRITY_FAILED'});
  expect(f.queries.some(query => query.sql.startsWith('INSERT INTO whiteboard_documents') || query.sql.startsWith('UPDATE whiteboard_duplicate_requests'))).toBe(false);
});

it('does not publish metadata when ObjectStore write fails', async () => {
  const f = await fixture(); f.objects.putOnce = async () => {throw new Error('ObjectStore unavailable');};
  await expect(f.run()).rejects.toMatchObject({code:'COPY_INTEGRITY_FAILED'});
  expect(f.queries.some(query => query.sql.startsWith('INSERT INTO whiteboard_documents') || query.sql.startsWith('INSERT INTO whiteboard_asset_refs') || query.sql.startsWith('UPDATE whiteboard_duplicate_requests'))).toBe(false);
});
