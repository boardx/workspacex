import { randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import * as Y from 'yjs';
import * as C from '@repo/contracts/whiteboard-proposal';
import { createWhiteboardDocument,readObjects } from '@repo/whiteboard-core';
import { PgDatabase } from '../../src/infrastructure/db/pg-database';
import { appConfig } from '../../src/infrastructure/db/pg-config';
import { PgProposalRepository } from '../../src/infrastructure/whiteboard/pg-proposal-repository';
import { PgWhiteboardRepository } from '../../src/infrastructure/whiteboard/pg-whiteboard-repository';
import { PgWhiteboardCollaborationStore } from '../../src/infrastructure/whiteboard/pg-collaboration-store';
import { FsBoardBlobStore } from '../../src/infrastructure/whiteboard/fs-board-blob-store';
import { AesGcmBoardBlobCodec } from '../../src/infrastructure/whiteboard/aes-gcm-board-blob-codec';
import { WorkerWhiteboardUpdateValidator } from '../../src/infrastructure/whiteboard/update-validator';
import type { DatabasePort } from '../../src/application/ports/database.port';
import { toOrgId } from '../../src/domain/org-id';
import type { Principal } from '../../src/domain/principal';
import { addOrgMember,ensureDatabase,migrateOnce,resetOrgs,seedOrg } from '../support/db';
const org=toOrgId('wb-proposal-a'),other=toOrgId('wb-proposal-b');
const owner:Principal={orgId:org,userId:'wb-proposal-owner'},editor:Principal={orgId:org,userId:'wb-proposal-editor'},viewer:Principal={orgId:org,userId:'wb-proposal-viewer'},outsider:Principal={orgId:other,userId:owner.userId};
let db:PgDatabase,repo:PgProposalRepository,boards:PgWhiteboardRepository,store:PgWhiteboardCollaborationStore,blobRoot:string;
const codec=new AesGcmBoardBlobCodec({resolve:async()=>new Uint8Array(32).fill(29)});
const collaboration=(database:DatabasePort)=>new PgWhiteboardCollaborationStore(database,new WorkerWhiteboardUpdateValidator(),120,new FsBoardBlobStore(blobRoot),codec,1);
async function board(){const b=await boards.create(owner,{requestId:randomUUID(),name:'AI proposals'});await boards.putMember(owner,b.id,{userId:editor.userId,role:'editor'});await boards.putMember(owner,b.id,{userId:viewer.userId,role:'viewer'});return b.id;}
function input():C.CreateProposal{return{requestId:randomUUID(),title:'Propose sticky',baseEpoch:1,baseSeq:0,commands:[{type:'create',object:{id:`suggested_${randomUUID()}`,schemaVersion:1,kind:'sticky',geometry:{x:0,y:0,width:100,height:100,rotation:0},text:'suggestion',style:{},parentId:null,orderKey:''}}]};}
beforeAll(async()=>{ensureDatabase();blobRoot=await mkdtemp(join(tmpdir(),'wsx-proposal-blob-'));await migrateOnce();await resetOrgs(org,other);await seedOrg({orgId:org,projectId:'wb-proposal-project-a'});await seedOrg({orgId:other,projectId:'wb-proposal-project-b'});for(const p of [owner,editor,viewer,outsider])await addOrgMember(p.orgId,p.userId,'consultant',null);db=new PgDatabase(appConfig());store=collaboration(db);repo=new PgProposalRepository(db,store);boards=new PgWhiteboardRepository(db);});
afterAll(async()=>{await db?.close();await resetOrgs(org,other);if(blobRoot)await rm(blobRoot,{recursive:true,force:true});});
describe('AI suggestion persistence and explicit decisions',()=>{
  it('stores an attributed proposal without changing the shared document, with strict retry semantics',async()=>{
    const id=await board(),request=input(),p=await repo.create(editor,id,request);expect(p).toMatchObject({status:'pending',provenance:{submittedBy:editor.userId,participant:{kind:'human-api',actorId:editor.userId,verified:true}}});
    expect((await store.load(owner,id)).seq).toBe(0);expect(await repo.create(editor,id,request)).toEqual(p);
    await expect(repo.create(editor,id,{...request,title:'changed'})).rejects.toThrow('REQUEST_ID_REUSED');expect(await repo.list(viewer,id)).toEqual([p]);
  });
  it('accepts once under the current epoch/sequence and records the deciding principal separately',async()=>{
    const id=await board(),p=await repo.create(editor,id,input()),decision={requestId:randomUUID()};
    const applied=await repo.decide(owner,id,p!.id,'accept',decision);expect(applied).toMatchObject({status:'applied',decidedBy:owner.userId,committedEpoch:1,committedSeq:1,provenance:{submittedBy:editor.userId}});
    const state=await store.load(owner,id),doc=createWhiteboardDocument();Y.applyUpdate(doc,state.update);expect(readObjects(doc)).toHaveLength(1);expect(readObjects(doc)[0]!.text).toBe('suggestion');
    const persisted=await db.withTenant(org,s=>s.query<{snapshot:Buffer|null;update:Buffer|null;storage_kind:string}>(`SELECT d.snapshot,u.update,h.storage_kind FROM whiteboard_documents d JOIN whiteboard_content_heads h ON h.org_id=d.org_id AND h.board_id=d.board_id LEFT JOIN whiteboard_updates u ON u.org_id=d.org_id AND u.board_id=d.board_id AND u.seq=d.seq WHERE d.org_id=$1 AND d.board_id=$2`,[org,id]));
    expect(persisted.rows[0]).toEqual({snapshot:null,update:null,storage_kind:'blob_primary'});
    const pointerBefore=await db.withTenant(org,s=>s.query<{head_seq:string;manifest_digest:string}>(`SELECT head_seq,manifest_digest FROM whiteboard_content_heads WHERE org_id=$1 AND board_id=$2`,[org,id]));
    expect(await repo.decide(owner,id,p!.id,'accept',decision)).toEqual(applied);expect((await store.load(owner,id)).seq).toBe(1);
    const pointerAfter=await db.withTenant(org,s=>s.query<{head_seq:string;manifest_digest:string}>(`SELECT head_seq,manifest_digest FROM whiteboard_content_heads WHERE org_id=$1 AND board_id=$2`,[org,id]));expect(pointerAfter.rows).toEqual(pointerBefore.rows);
    await expect(repo.decide(owner,id,p!.id,'reject',decision)).rejects.toThrow('PROPOSAL_ALREADY_DECIDED');
  });
  it('serializes concurrent accept/reject so exactly one human decision commits',async()=>{
    const id=await board(),p=await repo.create(editor,id,input());
    const outcomes=await Promise.allSettled([
      repo.decide(owner,id,p!.id,'accept',{requestId:randomUUID()}),
      repo.decide(editor,id,p!.id,'reject',{requestId:randomUUID()}),
    ]);
    expect(outcomes.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result=>result.status==='rejected')).toHaveLength(1);
    const decided=(await repo.list(owner,id))![0]!;
    expect(['applied','rejected']).toContain(decided.status);
    expect((await store.load(owner,id)).seq).toBe(decided.status==='applied'?1:0);
  });
  it('rejects without altering the shared document',async()=>{
    const id=await board(),p=await repo.create(editor,id,input()),decision={requestId:randomUUID()};
    expect(await repo.decide(editor,id,p!.id,'reject',decision)).toMatchObject({status:'rejected',committedSeq:null});expect((await store.load(owner,id)).seq).toBe(0);
    expect(await repo.decide(editor,id,p!.id,'reject',decision)).toMatchObject({status:'rejected'});
  });
  it('persists conflicted when humans changed the board before acceptance',async()=>{
    const id=await board(),p=await repo.create(editor,id,input());
    const commands=input().commands;const command=commands[0]!;if(command.type==='create')command.object.id='human_note';
    await store.writeCommands(owner,id,{epoch:1,requestId:randomUUID(),commands});
    const before=await db.withTenant(org,s=>s.query<{head_seq:string;manifest_digest:string}>(`SELECT head_seq,manifest_digest FROM whiteboard_content_heads WHERE org_id=$1 AND board_id=$2`,[org,id]));
    expect(await repo.decide(owner,id,p!.id,'accept',{requestId:randomUUID()})).toMatchObject({status:'conflicted',committedSeq:null});
    const after=await db.withTenant(org,s=>s.query<{head_seq:string;manifest_digest:string}>(`SELECT head_seq,manifest_digest FROM whiteboard_content_heads WHERE org_id=$1 AND board_id=$2`,[org,id]));expect(after.rows).toEqual(before.rows);
    expect((await store.load(owner,id)).seq).toBe(1);expect((await repo.list(owner,id))![0]!.status).toBe('conflicted');
  });
  it('epoch mismatch conflicts even when sequence matches',async()=>{
    const id=await board(),p=await repo.create(owner,id,{...input(),baseEpoch:2});
    expect(await repo.decide(owner,id,p!.id,'accept',{requestId:randomUUID()})).toMatchObject({status:'conflicted'});expect((await store.load(owner,id)).seq).toBe(0);
  });
  it('enforces current permissions for create, accept and receipt replays',async()=>{
    const id=await board();expect(await repo.create(viewer,id,input())).toBeNull();expect(await repo.list(outsider,id)).toBeNull();
    const p=await repo.create(editor,id,input()),decision={requestId:randomUUID()};expect(await repo.decide(viewer,id,p!.id,'accept',decision)).toBeNull();expect(await repo.decide(outsider,id,p!.id,'accept',decision)).toBeNull();
    await repo.decide(editor,id,p!.id,'accept',decision);await boards.removeMember(owner,id,editor.userId);expect(await repo.decide(editor,id,p!.id,'accept',decision)).toBeNull();
  });
  it('rolls back the accepted update when decision receipt persistence fails',async()=>{
    const id=await board(),p=await repo.create(owner,id,input());
    const failingDb:DatabasePort={withTenant:(orgId,run)=>db.withTenant(orgId,s=>run({query:async(sql,params)=>{if(sql.startsWith('UPDATE whiteboard_proposals'))throw new Error('DECISION_WRITE_FAILED');return s.query(sql,params);}})),withoutTenant:db.withoutTenant.bind(db),close:async()=>{}};
    await expect(new PgProposalRepository(failingDb,collaboration(failingDb)).decide(owner,id,p!.id,'accept',{requestId:randomUUID()})).rejects.toThrow('DECISION_WRITE_FAILED');
    expect((await store.load(owner,id)).seq).toBe(0);expect((await repo.list(owner,id))![0]!.status).toBe('pending');
  });
  it('accepts selected commands across proposals in one mutation and rejects the remainder atomically',async()=>{
    const id=await board();
    const proposalInput=(prefix:string):C.CreateProposal=>({...input(),title:prefix,commands:[0,1].map(index=>({type:'create' as const,object:{id:`${prefix}_${index}`,schemaVersion:1 as const,kind:'sticky' as const,geometry:{x:index*120,y:0,width:100,height:100,rotation:0},text:`${prefix} ${index}`,style:{},parentId:null,orderKey:''}}))});
    const a=await repo.create(editor,id,proposalInput('a')),b=await repo.create(editor,id,proposalInput('b')),acceptId=randomUUID();
    const accepted=await repo.batchDecide(owner,id,{requestId:acceptId,action:'accept',selections:[{proposalId:a!.id,commandIndexes:[0]},{proposalId:b!.id,commandIndexes:[0]}]});
    expect(accepted?.proposals).toHaveLength(2);expect(accepted?.proposals.every(item=>item.status==='pending')).toBe(true);
    expect(accepted?.proposals.map(item=>item.commandDecisions.map(value=>value.status))).toEqual([['applied','pending'],['applied','pending']]);
    expect((await store.load(owner,id)).seq).toBe(1);
    expect(await repo.batchDecide(owner,id,{requestId:acceptId,action:'accept',selections:[{proposalId:a!.id,commandIndexes:[0]},{proposalId:b!.id,commandIndexes:[0]}]})).toEqual(accepted);
    await expect(repo.batchDecide(owner,id,{requestId:acceptId,action:'reject',selections:[{proposalId:a!.id,commandIndexes:[1]}]})).rejects.toThrow('REQUEST_ID_REUSED');
    await expect(repo.batchDecide(owner,id,{requestId:randomUUID(),action:'accept',selections:[{proposalId:a!.id,commandIndexes:[0]}]})).rejects.toThrow('PROPOSAL_ALREADY_DECIDED');
    const rejected=await repo.batchDecide(editor,id,{requestId:randomUUID(),action:'reject',selections:[{proposalId:a!.id,commandIndexes:[1]},{proposalId:b!.id,commandIndexes:[1]}]});
    expect(rejected?.proposals.every(item=>item.status==='applied')).toBe(true);
    expect(rejected?.proposals.map(item=>item.commandDecisions.map(value=>value.status))).toEqual([['applied','rejected'],['applied','rejected']]);
    const state=await store.load(owner,id),doc=createWhiteboardDocument();Y.applyUpdate(doc,state.update);expect(readObjects(doc).map(value=>value.id).sort()).toEqual(['a_0','b_0']);
    await expect(repo.batchDecide(owner,id,{requestId:randomUUID(),action:'accept',selections:[{proposalId:a!.id,commandIndexes:[1]}]})).rejects.toThrow('PROPOSAL_ALREADY_DECIDED');
  });
  it('rejects a stale multi-proposal acceptance without applying or partially deciding anything',async()=>{
    const id=await board(),a=await repo.create(editor,id,input()),b=await repo.create(editor,id,input());
    const human=input().commands;await store.writeCommands(owner,id,{epoch:1,requestId:randomUUID(),commands:human});
    await expect(repo.batchDecide(owner,id,{requestId:randomUUID(),action:'accept',selections:[{proposalId:a!.id,commandIndexes:[0]},{proposalId:b!.id,commandIndexes:[0]}]})).rejects.toThrow('PROPOSAL_CONFLICT');
    expect((await store.load(owner,id)).seq).toBe(1);
    expect((await repo.list(owner,id))!.filter(item=>[a!.id,b!.id].includes(item.id)).every(item=>item.status==='pending'&&item.commandDecisions[0]!.status==='pending')).toBe(true);
    expect(await repo.batchDecide(viewer,id,{requestId:randomUUID(),action:'reject',selections:[{proposalId:a!.id,commandIndexes:[0]}]})).toBeNull();
  });
});
