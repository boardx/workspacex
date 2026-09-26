import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createWhiteboardDocument, executeCommands, readObjects } from '@repo/whiteboard-core';
import { toOrgId } from '../../src/domain/org-id';
import type { Principal } from '../../src/domain/principal';
import type { DatabasePort, TenantSession } from '../../src/application/ports/database.port';
import type { BoardContentCopyPort, CapturedBoardContent, PreparedBoardContent } from '../../src/application/whiteboard/board-content-copy-port';
import { DuplicateBoard } from '../../src/application/whiteboard/duplicate-board';
import { PgBoardContentCopyStore } from '../../src/infrastructure/whiteboard/pg-board-content-copy-store';

const principal: Principal = { orgId: toOrgId('board-duplicate-unit'), userId: 'owner' };
const sourceBoardId = randomUUID();
const input = () => ({ requestId: randomUUID(), targetName: 'Copy', expectedSource: { epoch: 4, seq: 12 } });
function sourceSnapshot(extensionData?: Record<string, unknown>): Uint8Array {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: 'create', object: {
    id: 'note', schemaVersion: 1, kind: extensionData ? 'extension' : 'sticky', text: 'Idea', style: {}, parentId: null, orderKey: '',
    geometry: { x: 1, y: 2, width: 100, height: 80, rotation: 0 }, ...(extensionData ? { extensionData } : {}),
  } }], 'test');
  const result = Y.encodeStateAsUpdate(doc); doc.destroy(); return result;
}
const targetBoard = (id = randomUUID()) => ({
  id, name: 'Copy', ownerId: principal.userId, role: 'owner' as const, archived: false, tagIds: [], tagsRevision: 0,
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
});

describe('DuplicateBoard use case', () => {
  it('uses the captured epoch/seq and sends only canonical fresh content to the persistence port', async () => {
    const prepared: PreparedBoardContent[] = [];
    const port: BoardContentCopyPort = { duplicate: async (_p, sourceId, request, prepare) => {
      const value = prepare({ source: { epoch: 4, seq: 12 }, snapshot: sourceSnapshot() }); prepared.push(value);
      return { board: targetBoard(), receipt: { requestId: request.requestId, sourceBoardId: sourceId, sourceEpoch: 4, sourceSeq: 12,
        objectCount: value.objectCount, connectorCount: value.connectorCount, assetCount: value.assetCount } };
    } };
    const request = input();
    const result = await new DuplicateBoard(port).duplicate(principal,sourceBoardId,request);
    const target = createWhiteboardDocument(); Y.applyUpdate(target,prepared[0]!.snapshot);
    const copied = readObjects(target);
    expect(result.receipt).toMatchObject({sourceEpoch:4,sourceSeq:12,objectCount:1});
    expect(copied[0]?.id).toMatch(/^copy_[0-9a-f]{64}$/);
    expect(copied[0]?.id).not.toBe('note');
    target.destroy();
  });

  it('rejects a changed source version before producing target content', async () => {
    let prepared = false;
    const port: BoardContentCopyPort = { duplicate: async (_p,_id,_request,prepare) => {
      prepared = true; prepare({source:{epoch:4,seq:13},snapshot:sourceSnapshot()}); throw new Error('unreachable');
    } };
    await expect(new DuplicateBoard(port).duplicate(principal,sourceBoardId,input())).rejects.toMatchObject({code:'SOURCE_VERSION_CHANGED'});
    expect(prepared).toBe(true);
  });

  it('maps an opaque extension reference failure to COPY_INTEGRITY_FAILED', async () => {
    const port: BoardContentCopyPort = { duplicate: async (_p,_id,_request,prepare) => {
      prepare({source:{epoch:4,seq:12},snapshot:sourceSnapshot({relatedObjectId:'note'})}); throw new Error('unreachable');
    } };
    await expect(new DuplicateBoard(port).duplicate(principal,sourceBoardId,input())).rejects.toMatchObject({code:'COPY_INTEGRITY_FAILED'});
  });
});

type State = {
  queries: Array<{sql:string;params:readonly unknown[]}>;
  job?: { request_hash:string; source_board_id:string; target_board_id:string; source_epoch:number; source_seq:string; object_count:number; connector_count:number; asset_count:number; status:string };
  targetId?: string;
  lockedTagIds: string[];
  currentTagIds: string[];
};
function database(snapshot: Uint8Array): { db: DatabasePort; state: State } {
  const state: State = {queries:[],lockedTagIds:[],currentTagIds:[]};
  const session: TenantSession = { async query<R>(sql: string, params: readonly unknown[] = []) {
    state.queries.push({sql,params});
    if (sql.startsWith('INSERT INTO whiteboard_duplicate_requests')) return {rows:(state.job ? [] : [{job_id:String(params[0])}]) as R[]};
    if (sql.includes('FROM whiteboard_duplicate_requests') && sql.includes('FOR UPDATE')) return {rows:(state.job ? [state.job] : []) as R[]};
    if (sql.startsWith('SELECT b.owner_id')) return {rows:[{owner_id:principal.userId,role:'owner'}] as R[]};
    if (sql.startsWith('SELECT t.id')) return {rows:state.lockedTagIds.map(id => ({id})) as R[]};
    if (sql.startsWith('SELECT bt.tag_id')) return {rows:state.currentTagIds.map(tag_id => ({tag_id})) as R[]};
    if (sql.startsWith('SELECT epoch,seq,snapshot')) return {rows:[{epoch:4,seq:'12',snapshot:Buffer.from(snapshot)}] as R[]};
    if (sql.startsWith('INSERT INTO whiteboards')) { state.targetId = String(params[0]); return {rows:[] as R[]}; }
    if (sql.startsWith('UPDATE whiteboard_duplicate_requests')) {
      state.job = { request_hash:'',source_board_id:sourceBoardId,target_board_id:String(params[3]),source_epoch:4,source_seq:'12',
        object_count:Number(params[6]),connector_count:Number(params[7]),asset_count:Number(params[8]),status:'completed' };
      return {rows:[] as R[]};
    }
    if (sql.startsWith('SELECT b.id,b.name')) return {rows:[{
      id:state.targetId,name:'Copy',owner_id:principal.userId,role:'owner',archived:false,tags_revision:0,tag_ids:[],created_at:new Date(0),updated_at:new Date(0),
    }] as R[]};
    return {rows:[] as R[]};
  } };
  return { state, db: { withTenant: async (_org,fn) => fn(session), withoutTenant: async () => { throw new Error('not allowed'); }, close: async () => {} } };
}

describe('PgBoardContentCopyStore legacy adapter', () => {
  it('captures an explicit source version and publishes a fresh epoch=1 seq=0 document atomically', async () => {
    const source = sourceSnapshot(), fixture = database(source), request = input();
    const store = new PgBoardContentCopyStore(fixture.db);
    const result = await store.duplicate(principal,sourceBoardId,request,(captured: CapturedBoardContent) => {
      expect(captured.source).toEqual({epoch:4,seq:12});
      return {snapshot:new Uint8Array([0,0]),objectCount:1,connectorCount:0,assetCount:0};
    });
    expect(result.receipt).toMatchObject({sourceEpoch:4,sourceSeq:12,objectCount:1});
    const targetWrite = fixture.state.queries.find(item => item.sql.startsWith('INSERT INTO whiteboard_documents') && item.sql.includes('epoch,seq,snapshot'));
    expect(targetWrite?.sql).toContain('VALUES($1,$2,1,0,$3)');
    expect(targetWrite?.params[1]).toBe(fixture.state.targetId);
    expect(fixture.state.queries.some(item => item.sql.includes('INSERT INTO whiteboard_updates'))).toBe(false);
    expect(fixture.state.queries.find(item => item.sql.startsWith('INSERT INTO whiteboard_duplicate_requests'))?.sql).toContain('ON CONFLICT(org_id,actor_id,request_id) DO NOTHING');
    const tagLock = fixture.state.queries.findIndex(item => item.sql.startsWith('SELECT t.id'));
    const boardLock = fixture.state.queries.findIndex(item => item.sql.startsWith('SELECT b.owner_id') && item.sql.includes('FOR SHARE OF b'));
    expect(tagLock).toBeGreaterThan(-1); expect(boardLock).toBeGreaterThan(tagLock);
  });

  it('checks the locked source version before preparing or creating a target', async () => {
    const fixture = database(sourceSnapshot()), store = new PgBoardContentCopyStore(fixture.db), request = input();
    let prepared = false;
    await expect(store.duplicate(principal,sourceBoardId,{...request,expectedSource:{epoch:4,seq:11}},() => {
      prepared = true; return {snapshot:new Uint8Array([0,0]),objectCount:0,connectorCount:0,assetCount:0};
    })).rejects.toMatchObject({code:'SOURCE_VERSION_CHANGED'});
    expect(prepared).toBe(false);
    expect(fixture.state.queries.some(item => item.sql.startsWith('INSERT INTO whiteboards'))).toBe(false);
    expect(fixture.state.queries.some(item => item.sql.startsWith('INSERT INTO whiteboard_documents') && item.sql.includes('epoch,seq,snapshot'))).toBe(false);
  });

  it('aborts when tag membership changes between tag and board locks', async () => {
    const fixture = database(sourceSnapshot()), store = new PgBoardContentCopyStore(fixture.db), request = input();
    fixture.state.lockedTagIds = [randomUUID()]; fixture.state.currentTagIds = [randomUUID()];
    let prepared = false;
    await expect(store.duplicate(principal,sourceBoardId,request,() => {
      prepared = true; return {snapshot:new Uint8Array([0,0]),objectCount:0,connectorCount:0,assetCount:0};
    })).rejects.toMatchObject({code:'SOURCE_VERSION_CHANGED'});
    expect(prepared).toBe(false);
    expect(fixture.state.queries.some(item => item.sql.startsWith('INSERT INTO whiteboards'))).toBe(false);
  });

  it('returns a completed request without recapturing or rewriting content', async () => {
    const fixture = database(sourceSnapshot()), request = input(), store = new PgBoardContentCopyStore(fixture.db), targetId = randomUUID();
    const first = await store.duplicate(principal,sourceBoardId,request,() => ({snapshot:new Uint8Array([0,0]),objectCount:1,connectorCount:0,assetCount:0}));
    fixture.state.job!.request_hash = fixture.state.queries.find(item => item.sql.startsWith('INSERT INTO whiteboard_duplicate_requests'))?.params[4] as string;
    fixture.state.targetId = targetId; fixture.state.job!.target_board_id = targetId; fixture.state.queries.length = 0;
    const replay = await store.duplicate(principal,sourceBoardId,request,() => { throw new Error('must not prepare twice'); });
    expect(replay.receipt).toEqual(first.receipt);
    expect(fixture.state.queries.some(item => item.sql.startsWith('SELECT epoch,seq,snapshot'))).toBe(false);
    expect(fixture.state.queries.some(item => item.sql.startsWith('INSERT INTO whiteboard_documents'))).toBe(false);
  });

  it('rejects reuse of a request id for different duplicate input', async () => {
    const fixture = database(sourceSnapshot()), request = input(), store = new PgBoardContentCopyStore(fixture.db);
    await store.duplicate(principal,sourceBoardId,request,() => ({snapshot:new Uint8Array([0,0]),objectCount:1,connectorCount:0,assetCount:0}));
    fixture.state.job!.request_hash = fixture.state.queries.find(item => item.sql.startsWith('INSERT INTO whiteboard_duplicate_requests'))?.params[4] as string;
    await expect(store.duplicate(principal,sourceBoardId,{...request,targetName:'Different'},() => { throw new Error('no'); })).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  });
});
