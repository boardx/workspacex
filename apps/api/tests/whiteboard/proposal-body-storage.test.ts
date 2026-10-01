import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WhiteboardAIProposal } from '@repo/contracts/whiteboard-operation';
import type { TenantSession } from '../../src/application/ports/database.port';
import type { Principal } from '../../src/domain/principal';
import { FsObjectStore } from '../../src/infrastructure/storage/fs-object-store';
import { PgWhiteboardProposalRepository } from '../../src/infrastructure/whiteboard/pg-proposal-repository';
const p={orgId:'org-proposal',userId:'owner'} as Principal;
const boardId='11111111-1111-4111-8111-111111111111',proposalId='22222222-2222-4222-8222-222222222222';
const proposal=()=>WhiteboardAIProposal.parse({proposalId,boardId,createdBy:{kind:'ai',actorId:'agent',orgId:p.orgId,role:'owner',scopes:['board:write'],delegatedBy:p.userId},baseRevision:{epoch:1,seq:2},baseObjectDigests:{},action:{type:'generate',commands:[{type:'text',id:'n1',index:0,deleteCount:0,insert:'PRIVATE_PROPOSAL_CONTENT'}]},provenance:{source:'ai-proposal',model:'provider/model',skill:'skill-v1'},status:'preview',createdAt:'2026-09-27T00:00:00.000Z',expiresAt:'2026-09-27T00:05:00.000Z'});
const dirs:string[]=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
async function objects(){const dir=await mkdtemp(join(tmpdir(),'proposal-body-'));dirs.push(dir);return new FsObjectStore(dir);}
describe('proposal body storage',()=>{
 it('never sends proposal commands or undo text to PostgreSQL',async()=>{
  const calls:Array<{sql:string;params:readonly unknown[]}>=[];
  const session={query:async(sql:string,params:readonly unknown[]=[])=>{calls.push({sql,params});return{rows:[]};}} as TenantSession;
  const repo=new PgWhiteboardProposalRepository(await objects());
  await repo.create(session,p,proposal(),'a'.repeat(64));
  expect(JSON.stringify(calls)).not.toContain('PRIVATE_PROPOSAL_CONTENT');
  expect(calls.some(call=>call.sql.includes('whiteboard_asset_refs'))).toBe(true);
 });
});

// SQL recorder models only the repository boundary; file bytes use FsObjectStore.
// Actual PG transaction/ACL/GC races remain the root integration lane.
function sqlFixture(legacy?:ReturnType<typeof proposal>){
 const calls:Array<{sql:string;params:readonly unknown[]}>=[];
 let row:Record<string,unknown>|null=legacy?{owner_user_id:p.userId,actor_id:'agent',request_hash:'a'.repeat(64),status:legacy.status,payload:legacy,object_key:null,content_hash:null,byte_size:null}:null;
 const session={query:async(sql:string,params:readonly unknown[]=[])=>{
  calls.push({sql,params});
  if(sql.startsWith('SELECT'))return{rows:row?[{...row}]:[]};
  if(sql.startsWith('INSERT INTO whiteboard_ai_proposals'))row={owner_user_id:params[3],actor_id:params[4],request_hash:params[5],status:params[6],payload:{},object_key:params[8],content_hash:params[9],byte_size:params[10]};
  if(sql.startsWith('UPDATE whiteboard_ai_proposals SET payload'))row={...row,payload:{},object_key:params[3],content_hash:params[4],byte_size:params[5],status:params[6]};
  if(sql.startsWith('UPDATE whiteboard_ai_proposals SET status'))row={...row,status:params[3]};
  return{rows:[]};
 }} as TenantSession;
 return{session,calls,row:()=>row!,mutate:(values:Record<string,unknown>)=>{row={...row,...values};}};
}
it('hydrates confirmed undo entirely from file after PG payload is cleared',async()=>{
 const fs=await objects(),repo=new PgWhiteboardProposalRepository(fs),db=sqlFixture();
 await repo.create(db.session,p,proposal(),'a'.repeat(64));
 const undo={undoId:'33333333-3333-4333-8333-333333333333',operationId:'44444444-4444-4444-8444-444444444444',boardId,expectedRevision:{epoch:1,seq:3},commands:[{type:'text' as const,id:'n1',index:0,deleteCount:0,insert:'PRIVATE_ORIGINAL_TEXT'}],createdAt:'2026-09-27T00:01:00.000Z'};
 await repo.setConfirmation(db.session,p,boardId,proposalId,undo);
 const loaded=await new PgWhiteboardProposalRepository(fs).lock(db.session,p,boardId,proposalId);
 expect(loaded?.proposal.undoReceipt).toEqual(undo);expect(loaded?.proposal.status).toBe('confirmed');
 expect(db.row().payload).toEqual({});expect(JSON.stringify(db.calls)).not.toContain('PRIVATE_');
 expect(db.calls.filter(c=>c.sql.startsWith('INSERT INTO whiteboard_asset_refs'))).toHaveLength(2);
});
it('status is metadata and idempotent replay still returns canonical file content',async()=>{
 const fs=await objects(),repo=new PgWhiteboardProposalRepository(fs),db=sqlFixture();
 await repo.create(db.session,p,proposal(),'a'.repeat(64));
 await repo.setStatus(db.session,p,boardId,proposalId,'cancelled');
 expect((await repo.create(db.session,p,proposal(),'a'.repeat(64))).status).toBe('cancelled');
 await expect(repo.create(db.session,p,proposal(),'b'.repeat(64))).rejects.toThrow('IDEMPOTENCY_CONFLICT');
 expect(db.calls.filter(c=>c.sql.startsWith('INSERT INTO whiteboard_ai_proposals'))).toHaveLength(1);
});
it('migrates legacy payload only after file readback and GC root registration',async()=>{
 const fs=await objects(),repo=new PgWhiteboardProposalRepository(fs),db=sqlFixture(proposal());
 expect((await repo.lock(db.session,p,boardId,proposalId))?.proposal).toEqual(proposal());
 expect(db.row().payload).toEqual({});
 const pin=db.calls.findIndex(c=>c.sql.startsWith('INSERT INTO whiteboard_asset_refs'));
 expect(pin).toBeGreaterThan(0);expect(db.calls.findIndex(c=>c.sql.startsWith('UPDATE'))).toBeGreaterThan(pin);
 expect((await repo.lock(db.session,p,boardId,proposalId))?.proposal).toEqual(proposal());
});
it('missing/corrupt files never acknowledge a new proposal or clear a legacy payload',async()=>{
 const bad={putOnce:async()=>{},get:async()=>null,head:async()=>null};
 for(const legacy of [undefined,proposal()]){
  const repo=new PgWhiteboardProposalRepository(bad),db=sqlFixture(legacy);
  await expect(legacy?repo.lock(db.session,p,boardId,proposalId):repo.create(db.session,p,proposal(),'a'.repeat(64))).rejects.toThrow('INTEGRITY');
  expect(db.calls.every(c=>c.sql.startsWith('SELECT'))).toBe(true);
  if(legacy)expect(db.row().payload).toEqual(legacy);
 }
});
it('a purge fence/root insertion failure cannot publish the proposal pointer',async()=>{
 const db=sqlFixture(),repo=new PgWhiteboardProposalRepository(await objects());
 const session={query:async(sql:string,params?:readonly unknown[])=>{if(sql.startsWith('INSERT INTO whiteboard_asset_refs'))throw new Error('WHITEBOARD_OBJECT_PURGE_FENCED');return db.session.query(sql,params);}} as TenantSession;
 await expect(repo.create(session,p,proposal(),'a'.repeat(64))).rejects.toThrow('PURGE_FENCED');
 expect(db.calls.some(c=>c.sql.startsWith('INSERT INTO whiteboard_ai_proposals'))).toBe(false);
});
it('a published pointer never falls back to PG even if legacy text is planted',async()=>{
 const fs=await objects(),repo=new PgWhiteboardProposalRepository(fs),db=sqlFixture();await repo.create(db.session,p,proposal(),'a'.repeat(64));
 db.mutate({payload:proposal()});await expect(repo.lock(db.session,p,boardId,proposalId)).rejects.toThrow('INTEGRITY');
});
it('validates tenant, Board, proposal identity, hash, size, MIME and existing immutable bytes',async()=>{
 const {ProposalBodyStorage}=await import('../../src/infrastructure/whiteboard/proposal-body-storage');
 const fs=await objects(),storage=new ProposalBodyStorage(fs),value=proposal(),ref=await storage.write(p,value);
 expect(await storage.write(p,value)).toEqual(ref);
 for(const wrong of [{...ref,key:ref.key.replace(boardId,'55555555-5555-4555-8555-555555555555')},{...ref,bytes:ref.bytes+1},{...ref,hash:'f'.repeat(64)}])await expect(storage.read(p,boardId,proposalId,wrong)).rejects.toThrow('INTEGRITY');
 await expect(storage.read({...p,orgId:'other-org' as Principal['orgId']},boardId,proposalId,ref)).rejects.toThrow('INTEGRITY');
 await expect(storage.read(p,boardId,'66666666-6666-4666-8666-666666666666',ref)).rejects.toThrow('INTEGRITY');
 const wrongMime=new ProposalBodyStorage({putOnce:fs.putOnce.bind(fs),get:fs.get.bind(fs),head:async()=>({sizeBytes:ref.bytes,mime:'text/plain'})});
 await expect(wrongMime.read(p,boardId,proposalId,ref)).rejects.toThrow('INTEGRITY');
 const corrupt=new ProposalBodyStorage({putOnce:fs.putOnce.bind(fs),get:async()=>new Uint8Array(ref.bytes),head:fs.head.bind(fs)});
 await expect(corrupt.write(p,value)).rejects.toThrow('INTEGRITY');
});
