import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { WhiteboardFileAssets, type BoardFileRecord } from '../../src/application/whiteboard/file-assets';
import type { WhiteboardRepository } from '../../src/application/whiteboard/ports';
import type { Principal } from '../../src/domain/principal';
import { WHITEBOARD_FILE_LIMITS } from '@repo/contracts/whiteboard-file';
import { PgBoardFileAssets } from '../../src/infrastructure/whiteboard/pg-file-assets';
import type { DatabasePort, TenantSession } from '../../src/application/ports/database.port';
import { WhiteboardFilesController } from '../../src/interface/controllers/whiteboard-files.controller';
import type { Response } from 'express';

const principal = { orgId: 'org', userId: 'owner' } as Principal;
const boardId = '20000000-0000-4000-8000-000000000001';
function fixture() {
  let allowed = true, role = 'owner', archived = false, fail = false, revoke = false, failSave = false, corruptReadback = false;
  const blobs = new Map<string, { bytes: Uint8Array; mime: string }>(), records = new Map<string, BoardFileRecord>();
  const otherBoardId = '20000000-0000-4000-8000-000000000002';
  const service = new WhiteboardFileAssets({ get: async (p, id) => allowed && p.orgId === principal.orgId && [boardId, otherBoardId].includes(id) ? { role, archived } : null } as WhiteboardRepository,
    { save: async (_p, id, record) => { if (failSave) throw new Error('metadata commit failed'); const key = `${id}:${record.metadata.assetId}`; if (!records.has(key)) records.set(key, record); }, get: async (_p, id, assetId) => records.get(`${id}:${assetId}`) ?? null },
    { putOnce: async (key, bytes, mime) => { if (fail) throw Error(); blobs.set(key, { bytes, mime }); },
      get: async key => { if (revoke) allowed = false; const value = blobs.get(key)?.bytes; return value ? corruptReadback ? new Uint8Array(value.length) : value : null; },
      head: async key => { const blob = blobs.get(key); return blob ? { sizeBytes: blob.bytes.length, mime: blob.mime } : null; } });
  return { service, blobs, records, otherBoardId, viewer: () => { role = 'viewer'; }, archive: () => { archived = true; }, fail: () => { fail = true; }, revoke: () => { revoke = true; }, failSave: () => { failSave = true; }, corruptReadback: () => { corruptReadback = true; } };
}
const bytes = new TextEncoder().encode('ordinary file bytes');
describe('durable board files', () => {
  it.each([
    [Buffer.from('普通便利贴.txt', 'utf8').toString('latin1'), '普通便利贴.txt'],
    [Buffer.from('café.txt', 'utf8').toString('latin1'), 'café.txt'],
    ['普通便利贴.txt', '普通便利贴.txt'],
    ['café.txt', 'café.txt'],
    ['badÃx.txt', 'badÃx.txt'],
    ['emoji😀.txt', 'emoji😀.txt'],
    [Buffer.from('cafÃ©.txt', 'utf8').toString('latin1'), 'cafÃ©.txt'],
    [Buffer.from([0xc0, 0xaf]).toString('latin1') + '.txt', Buffer.from([0xc0, 0xaf]).toString('latin1') + '.txt'],
    [Buffer.from([0xed, 0xa0, 0xbd]).toString('latin1') + '.txt', Buffer.from([0xed, 0xa0, 0xbd]).toString('latin1') + '.txt'],
  ])('restores multipart filename %s without losing legitimate Latin1 or double-decoding Unicode', async (originalname, expected) => {
    const f = fixture(), controller = new WhiteboardFilesController(f.service);
    const metadata = await controller.upload(principal, boardId, { buffer: Buffer.from(bytes), originalname, mimetype: 'text/plain' } as Express.Multer.File);
    expect(metadata?.fileName).toBe(expected);
    expect((await f.service.read(principal, boardId, metadata!.assetId)).metadata.fileName).toBe(expected);
  });
  it.each(["it's.txt", 'final(1).txt', 'star*.txt', '普通便利贴.txt', '100%.txt', '"quoted".txt'])('delivers %s with a valid RFC 5987 attachment filename and inert content headers', async fileName => {
    const f = fixture(), metadata = await f.service.upload(principal, boardId, bytes, fileName, 'text/html');
    const headers = new Map<string, string | number>();
    let delivered: Buffer | undefined;
    const response = { setHeader: (name: string, value: string | number) => headers.set(name, value), send: (value: Buffer) => { delivered = value; } } as unknown as Response;
    await new WhiteboardFilesController(f.service).content(principal, boardId, metadata.assetId, response);
    const header = String(headers.get('Content-Disposition'));
    expect(header).toMatch(/^attachment; filename\*=UTF-8''(?:[A-Za-z0-9!#$&+.^_`|~-]|%[0-9A-F]{2})+$/);
    expect(decodeURIComponent(header.split("UTF-8''")[1]!)).toBe(fileName);
    expect(headers.get('Content-Type')).toBe('application/octet-stream');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Cache-Control')).toBe('private, no-store');
    expect(headers.get('Content-Length')).toBe(bytes.byteLength);
    expect(delivered).toEqual(Buffer.from(bytes));
  });
  it('rejects CRLF filenames before persisting bytes or emitting any download metadata', async () => {
    const f = fixture();
    await expect(f.service.upload(principal, boardId, bytes, 'notes.txt\r\nX-Test: injected', 'text/plain')).rejects.toMatchObject({ code: 'INVALID_FILE' });
    expect(f.records.size).toBe(0); expect(f.blobs.size).toBe(0);
  });
  it('stores real non-image bytes and lets a peer retrieve them with integrity metadata', async () => {
    const f = fixture(), metadata = await f.service.upload(principal, boardId, bytes, 'notes.txt', 'text/plain');
    expect(metadata).toMatchObject({ fileName: 'notes.txt', byteSize: bytes.length, persistence: 'durable' });
    expect(metadata.assetId).toMatch(/^board-file-[a-f0-9]{64}$/);
    expect((await f.service.read({ ...principal, userId: 'peer' }, boardId, metadata.assetId)).bytes).toEqual(bytes);
    expect(f.blobs.values().next().value?.mime).toBe('application/octet-stream');
  });
  it('rejects viewer/archived writes and isolates tenants and boards', async () => {
    const f = fixture(); f.viewer(); await expect(f.service.upload(principal, boardId, bytes, 'a.txt', 'text/plain')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const g = fixture(); g.archive(); await expect(g.service.upload(principal, boardId, bytes, 'a.txt', 'text/plain')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(g.service.read({ ...principal, orgId: 'other' } as Principal, boardId, `board-file-${'a'.repeat(64)}`)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(g.service.upload(principal, 'other', bytes, 'a.txt', 'text/plain')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('returns the first persisted name and MIME for repeated identical bytes', async () => {
    const f = fixture(), first = await f.service.upload(principal, boardId, bytes, 'notes.txt', 'text/plain');
    expect(await f.service.upload(principal, boardId, bytes, 'renamed.csv', 'text/csv')).toEqual(first);
    expect((await f.service.read(principal, boardId, first.assetId)).metadata).toEqual(first);
  });
  it('refuses an asset from another board even when the caller owns both boards', async () => {
    const f = fixture(), metadata = await f.service.upload(principal, boardId, bytes, 'a.txt', 'text/plain');
    await expect(f.service.read(principal, f.otherBoardId, metadata.assetId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const other = await f.service.upload(principal, f.otherBoardId, bytes, 'b.txt', 'text/plain');
    expect(other.assetId).toBe(metadata.assetId); expect(other.fileName).toBe('b.txt');
    expect(f.records.size).toBe(2); expect(f.blobs.size).toBe(2);
  });
  it('rejects unsafe metadata, empty files and oversized bytes', async () => {
    const f = fixture();
    await expect(f.service.upload(principal, boardId, bytes, '../a.txt', 'text/plain')).rejects.toMatchObject({ code: 'INVALID_FILE' });
    await expect(f.service.upload(principal, boardId, bytes, 'a.txt', 'text/plain\r\nX: bad')).rejects.toMatchObject({ code: 'INVALID_FILE' });
    await expect(f.service.upload(principal, boardId, new Uint8Array(), 'a.txt', 'text/plain')).rejects.toMatchObject({ code: 'INVALID_FILE' });
    await expect(f.service.upload(principal, boardId, new Uint8Array(WHITEBOARD_FILE_LIMITS.bytes + 1), 'a.txt', 'text/plain')).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(f.records.size).toBe(0);
  });
  it('maps missing and zero-byte multipart files to HTTP 400 without persisting a root', async () => {
    const f = fixture(), controller = new WhiteboardFilesController(f.service);
    await expect(controller.upload(principal, boardId)).rejects.toMatchObject({ status: 400 });
    await expect(controller.upload(principal, boardId, { buffer: Buffer.alloc(0), originalname: 'empty.txt', mimetype: 'text/plain' } as Express.Multer.File)).rejects.toMatchObject({ status: 400 });
    expect(f.records.size).toBe(0); expect(f.blobs.size).toBe(0);
  });
  it('refuses tampered bytes and ACL revocation during read', async () => {
    const f = fixture(), metadata = await f.service.upload(principal, boardId, bytes, 'a.txt', 'text/plain');
    f.blobs.values().next().value!.bytes = new Uint8Array([1]);
    await expect(f.service.read(principal, boardId, metadata.assetId)).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
    const g = fixture(), other = await g.service.upload(principal, boardId, bytes, 'a.txt', 'text/plain'); g.revoke();
    await expect(g.service.read(principal, boardId, other.assetId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('does not publish metadata after object storage failure', async () => {
    const f = fixture(); f.fail();
    await expect(f.service.upload(principal, boardId, bytes, 'a.txt', 'text/plain')).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' }); expect(f.records.size).toBe(0);
  });
  it('rejects failed metadata commits after writing bytes instead of returning a successful asset', async () => {
    const f = fixture(); f.failSave();
    await expect(f.service.upload(principal, boardId, bytes, 'a.txt', 'text/plain')).rejects.toThrow('metadata commit failed');
    expect(f.records.size).toBe(0); expect(f.blobs.size).toBe(1);
  });
  it('rejects same-length corrupt upload readback before publishing any asset reference', async () => {
    const f = fixture(); f.corruptReadback();
    await expect(f.service.upload(principal, boardId, bytes, 'a.txt', 'text/plain')).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
    expect(f.records.size).toBe(0); expect(f.blobs.size).toBe(1);
  });
  it('guards repository disclosure with the existing Board role before issuing tenant SQL', async () => {
    let reads = 0;
    const db = { withTenant: async (_org: string, run: (session: unknown) => Promise<unknown>) => run({ query: async () => { reads++; return { rows: [] }; } }) } as unknown as DatabasePort;
    const absent = new PgBoardFileAssets(db, { get: async () => null } as unknown as WhiteboardRepository);
    await expect(absent.get(principal, boardId, 'unknown')).rejects.toMatchObject({ code: 'NOT_FOUND' }); expect(reads).toBe(0);
    const viewer = new PgBoardFileAssets(db, { get: async () => ({ role: 'viewer', archived: false }) } as unknown as WhiteboardRepository);
    await expect(viewer.get(principal, boardId, 'unknown')).resolves.toBeNull(); expect(reads).toBe(1);
    const metadata = await fixture().service.upload(principal, boardId, bytes, 'a.txt', 'text/plain');
    await expect(viewer.save(principal, boardId, { metadata, objectKey: 'untrusted' })).rejects.toMatchObject({ code: 'FORBIDDEN' }); expect(reads).toBe(1);
  });
});

const frozenPolicyMessage = 'new row violates row-level security policy "whiteboard_file_assets_org_frozen_ins" for table "whiteboard_file_assets"';
function databaseDenial(message=frozenPolicyMessage,code='42501') {
  const error=new pg.DatabaseError(message,0,'error');error.code=code;return error;
}
function failedInsertFixture(error:Error) {
  let refs=3,accessChecks=0;const assets=2,events:string[]=[];
  const boards={get:async()=>{accessChecks++;return{role:'owner',archived:false};}} as unknown as WhiteboardRepository;
  // Unit transaction port models pending writes; live PG/RLS verification remains CI.
  const db={withTenant:async(_org:string,run:(session:TenantSession)=>Promise<unknown>)=>{
    events.push('begin');let pendingRefs=refs;
    try{
      const result=await run({query:async(sql:string)=>{
        if(sql.includes('INSERT INTO whiteboard_asset_refs')){events.push('ref insert');pendingRefs++;return{rows:[]};}
        if(sql.includes('INSERT INTO whiteboard_file_assets')){events.push('asset insert denied');throw error;}
        return{rows:[]};
      }});refs=pendingRefs;events.push('commit');return result;
    }catch(failure){events.push('rollback');throw failure;}
  }} as unknown as DatabasePort;
  const repository=new PgBoardFileAssets(db,boards),blobs=new Map<string,Uint8Array>();
  const service=new WhiteboardFileAssets(boards,repository,{putOnce:async(key,value)=>{blobs.set(key,value);},get:async key=>blobs.get(key)??null,head:async key=>blobs.has(key)?{sizeBytes:blobs.get(key)!.length,mime:'application/octet-stream'}:null});
  return{controller:new WhiteboardFilesController(service),repository,events,rows:()=>({refs,assets}),blobs,accessChecks:()=>accessChecks};
}
describe('ordinary-file frozen RLS adapter mapping',()=>{
  it('retains HTTP404 privacy for cross-tenant uploads and reads without writes',async()=>{
    const f=fixture(),controller=new WhiteboardFilesController(f.service),other={...principal,orgId:'other'} as Principal;
    await expect(controller.upload(other,boardId,{buffer:Buffer.from(bytes),originalname:'a.txt',mimetype:'text/plain'} as Express.Multer.File)).rejects.toMatchObject({status:404});
    await expect(controller.content(other,boardId,`board-file-${'0'.repeat(64)}`,{} as Response)).rejects.toMatchObject({status:404});
    expect(f.records.size).toBe(0);expect(f.blobs.size).toBe(0);
  });
  it.each([false,true])('maps only the known frozen policy to HTTP403 after transaction rollback (driver table fields=%s)',async fields=>{
    const denied=databaseDenial();if(fields){denied.table='whiteboard_file_assets';denied.schema='public';}
    const f=failedInsertFixture(denied),before=f.rows();
    await expect(f.controller.upload(principal,boardId,{buffer:Buffer.from(bytes),originalname:'frozen.txt',mimetype:'text/plain'} as Express.Multer.File)).rejects.toMatchObject({status:403});
    expect(f.events).toEqual(['begin','ref insert','asset insert denied','rollback']);expect(f.rows()).toEqual(before);
    // Bytes may already exist, but neither SQL reference nor metadata is published.
    expect(f.blobs.size).toBe(1);expect(f.accessChecks()).toBeGreaterThanOrEqual(3);
  });
  it.each([
    ['wrong SQLSTATE',()=>databaseDenial(frozenPolicyMessage,'08006')],
    ['different policy',()=>databaseDenial(frozenPolicyMessage.replace('whiteboard_file_assets_org_frozen_ins','tenant_isolation'))],
    ['different table',()=>databaseDenial(frozenPolicyMessage.replace('for table "whiteboard_file_assets"','for table "other_assets"'))],
    ['generic table RLS',()=>databaseDenial('new row violates row-level security policy for table "whiteboard_file_assets"')],
    ['wrong driver schema',()=>Object.assign(databaseDenial(),{schema:'untrusted'})],
    ['wrong driver table',()=>Object.assign(databaseDenial(),{table:'other_assets'})],
    ['unknown database error',()=>new Error('database unavailable')],
  ])('preserves %s without disguising it as forbidden',async(_label,create)=>{
    const denied=create(),f=failedInsertFixture(denied),before=f.rows();
    await expect(f.controller.upload(principal,boardId,{buffer:Buffer.from(bytes),originalname:'a.txt',mimetype:'text/plain'} as Express.Multer.File)).rejects.toBe(denied);
    expect(f.events.at(-1)).toBe('rollback');expect(f.events).not.toContain('commit');expect(f.rows()).toEqual(before);
  });
});
