import { describe,it,expect } from 'vitest';
import sharp from 'sharp';
import { SharpBoardImageVerifier } from '../../src/infrastructure/whiteboard/image-verifier';
const raster=()=>sharp({create:{width:32,height:24,channels:4,background:'#4488ff'}});
describe('verified board image bytes',()=>{
 it.each(['png','jpeg','webp','gif'] as const)('decodes real %s pixels',async(format)=>{const bytes=await raster()[format]().toBuffer();const r=await new SharpBoardImageVerifier().verify(bytes,`image/${format}`);expect(r.metadata).toMatchObject({intrinsicWidth:32,intrinsicHeight:24,byteSize:bytes.length,persistence:'durable'});});
 it('rejects truncated pixels and MIME mismatch',async()=>{const v=new SharpBoardImageVerifier(),b=await raster().png().toBuffer();await expect(v.verify(b.subarray(0,45),'image/png')).rejects.toMatchObject({code:'INVALID_IMAGE'});await expect(v.verify(b,'image/jpeg')).rejects.toMatchObject({code:'INVALID_IMAGE'});});
 it('normalizes safe SVG and refuses external content and oversized decode',async()=>{const v=new SharpBoardImageVerifier(),s=(x:string)=>new TextEncoder().encode(x);expect((await v.verify(s('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30"><rect width="20" height="30" fill="red"/></svg>'),'image/svg+xml')).metadata).toMatchObject({mimeType:'image/png',intrinsicWidth:20,intrinsicHeight:30});for(const x of ['<svg><image href="https://example.com/a"/></svg>','<svg width="100000" height="100000"/>'])await expect(v.verify(s(x),'image/svg+xml')).rejects.toMatchObject({code:'INVALID_IMAGE'});});
});

import { WhiteboardImageAssets,type BoardImageAssetRecord } from '../../src/application/whiteboard/image-assets';
import type { WhiteboardRepository } from '../../src/application/whiteboard/ports';
import { toOrgId } from '../../src/domain/org-id';
const principal={orgId:toOrgId('image-org'),userId:'owner'},board='board';
function fixture(){let allowed=true,role='owner',archived=false,fail=false,revoke=false;const blobs=new Map<string,{bytes:Uint8Array;mime:string}>(),records=new Map<string,BoardImageAssetRecord>();const service=new WhiteboardImageAssets({get:async(p,id)=>allowed&&p.orgId===principal.orgId&&id===board?{role,archived}:null} as WhiteboardRepository,{save:async(_p,_b,r)=>{records.set(r.metadata.assetId,r);},get:async(_p,_b,id)=>records.get(id)??null},{putOnce:async(k,bytes,mime)=>{if(fail)throw Error();blobs.set(k,{bytes,mime});},get:async(k)=>{if(revoke)allowed=false;return blobs.get(k)?.bytes??null;},head:async(k)=>{const b=blobs.get(k);return b?{sizeBytes:b.bytes.length,mime:b.mime}:null;}},new SharpBoardImageVerifier());return{service,blobs,records,viewer:()=>role='viewer',archive:()=>archived=true,fail:()=>fail=true,revoke:()=>revoke=true};}
describe('board asset authorization and durable integrity',()=>{
 it('lets a peer resolve persisted bytes without exposing a storage key',async()=>{const f=fixture(),b=await raster().png().toBuffer(),m=await f.service.upload(principal,board,b,'image/png');expect(JSON.stringify(m)).not.toContain('/assets/');expect(Buffer.from((await f.service.read({...principal,userId:'peer'},board,m.assetId)).bytes)).toEqual(b);f.archive();await expect(f.service.read(principal,board,m.assetId)).resolves.toMatchObject({metadata:m});});
 it('denies viewer and archived uploads and isolates tenants and boards',async()=>{const f=fixture(),b=await raster().png().toBuffer();f.viewer();await expect(f.service.upload(principal,board,b,'image/png')).rejects.toMatchObject({code:'FORBIDDEN'});const g=fixture();g.archive();await expect(g.service.upload(principal,board,b,'image/png')).rejects.toMatchObject({code:'FORBIDDEN'});await expect(g.service.upload({...principal,orgId:toOrgId('outside')},board,b,'image/png')).rejects.toMatchObject({code:'NOT_FOUND'});await expect(g.service.upload(principal,'other',b,'image/png')).rejects.toMatchObject({code:'NOT_FOUND'});});
 it('rechecks ACL after ObjectStore I/O',async()=>{const f=fixture(),m=await f.service.upload(principal,board,await raster().png().toBuffer(),'image/png');f.revoke();await expect(f.service.read(principal,board,m.assetId)).rejects.toMatchObject({code:'NOT_FOUND'});});
 it('fails closed on changed bytes and never publishes ready on failed writes',async()=>{const f=fixture(),m=await f.service.upload(principal,board,await raster().png().toBuffer(),'image/png');f.blobs.values().next().value!.bytes=new Uint8Array([1]);await expect(f.service.read(principal,board,m.assetId)).rejects.toMatchObject({code:'INTEGRITY_FAILED'});const g=fixture();g.fail();await expect(g.service.upload(principal,board,await raster().png().toBuffer(),'image/png')).rejects.toMatchObject({code:'DEPENDENCY_UNAVAILABLE'});expect(g.records.size).toBe(0);});
});

import { PgBoardImageAssets } from '../../src/infrastructure/whiteboard/pg-image-assets';
import type { DatabasePort } from '../../src/application/ports/database.port';
import { readFileSync } from 'node:fs';
it('persists only board-scoped reference metadata through the governed root and tenant transaction',async()=>{
 const queries:Array<{sql:string;params:readonly unknown[]}>=[],tenants:string[]=[];
 const db={withTenant:async(org:string,run:(session:unknown)=>Promise<unknown>)=>{tenants.push(org);return run({query:async(sql:string,params:readonly unknown[]=[])=>{queries.push({sql,params});return{rows:[]};}});}} as unknown as DatabasePort;
 const repository=new PgBoardImageAssets(db),verified=await new SharpBoardImageVerifier().verify(await raster().png().toBuffer(),'image/png');
 await repository.save(principal,board,{metadata:verified.metadata,objectKey:'private-reference'});await repository.get(principal,board,verified.metadata.assetId);
 expect(tenants).toEqual([principal.orgId,principal.orgId]);expect(queries[0]?.sql).toContain('whiteboard_asset_refs');expect(queries[1]?.params[4]).toBe(JSON.stringify(verified.metadata));expect(queries[2]?.params).toEqual([principal.orgId,board,verified.metadata.assetId]);expect(queries[2]?.sql).toContain("r.state='active'");expect(queries[2]?.sql).toContain('r.released_at IS NULL');
 const migration=readFileSync(new URL('../../migrations/20260927123000_whiteboard_image_assets.sql',import.meta.url),'utf8');expect(migration).toContain('FORCE ROW LEVEL SECURITY');expect(migration).toContain('REFERENCES whiteboard_asset_refs');expect(migration).not.toMatch(/\bbytea\b/i);
});

import { BOARD_IMAGE_UPLOAD_LIMITS } from '../../src/interface/controllers/whiteboard-assets.controller';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
it('accepts exactly one multipart file with the controller parser limits',async()=>{
 const require=createRequire(import.meta.url),load=createRequire(require.resolve('@nestjs/platform-express'));
 const multer=load('multer') as typeof import('multer');
 const bytes=await raster().png().toBuffer(),boundary='board-image-test';
 const body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}--\r\n`)]);
 const request=Object.assign(new PassThrough(),{headers:{'content-type':`multipart/form-data; boundary=${boundary}`,'content-length':String(body.length)},method:'POST'});
 const middleware=multer({limits:BOARD_IMAGE_UPLOAD_LIMITS}).single('file');
 const parsed=new Promise<void>((resolve,reject)=>middleware(request as never,{} as never,error=>error?reject(error):resolve()));request.end(body);await parsed;
 expect((request as unknown as {file:{buffer:Buffer}}).file.buffer).toEqual(bytes);
});
