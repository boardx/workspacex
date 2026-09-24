import * as Y from 'yjs';
import { createWhiteboardDocument,readObjects } from '@repo/whiteboard-core';
import type { DatabasePort } from '../../src/application/ports/database.port';
import { randomUUID } from 'node:crypto';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import * as C from '@repo/contracts/whiteboard-workshop';
import { PgWhiteboardCollaborationStore } from '../../src/infrastructure/whiteboard/pg-collaboration-store';
import { PgDatabase } from '../../src/infrastructure/db/pg-database';
import { appConfig } from '../../src/infrastructure/db/pg-config';
import { PgWorkshopRepository } from '../../src/infrastructure/whiteboard/pg-workshop-repository';
import { PgWhiteboardRepository } from '../../src/infrastructure/whiteboard/pg-whiteboard-repository';
import { toOrgId } from '../../src/domain/org-id';
import type { Principal } from '../../src/domain/principal';
import { addOrgMember,asApp,ensureDatabase,migrateOnce,resetOrgs,seedOrg } from '../support/db';
const org=toOrgId('wb-workshop-a'),otherOrg=toOrgId('wb-workshop-b');
const owner:Principal={orgId:org,userId:'wb-workshop-owner'},editor:Principal={orgId:org,userId:'wb-workshop-editor'},viewer:Principal={orgId:org,userId:'wb-workshop-viewer'};
const outsider:Principal={orgId:otherOrg,userId:owner.userId};
let db:PgDatabase,repo:PgWorkshopRepository,boards:PgWhiteboardRepository;
async function board(){const b=await boards.create(owner,{requestId:randomUUID(),name:'Workshop'});await boards.putMember(owner,b.id,{userId:editor.userId,role:'editor'});await boards.putMember(owner,b.id,{userId:viewer.userId,role:'viewer'});await new PgWhiteboardCollaborationStore(db).writeCommands(owner,b.id,{epoch:1,requestId:randomUUID(),commands:['note_a','note_b'].map(id=>({type:'create' as const,object:{id,schemaVersion:1 as const,kind:'sticky' as const,geometry:{x:0,y:0,width:100,height:100,rotation:0},text:id,style:{},parentId:null,orderKey:''}}))});return b.id;}
const voteInput=():C.CreateVote=>({requestId:randomUUID(),title:'优先级',quota:2,durationSeconds:3600,objectIds:['note_a','note_b']});
beforeAll(async()=>{ensureDatabase();await migrateOnce();await resetOrgs(org,otherOrg);await seedOrg({orgId:org,projectId:'wb-workshop-project-a'});await seedOrg({orgId:otherOrg,projectId:'wb-workshop-project-b'});for(const p of [owner,editor,viewer,outsider])await addOrgMember(p.orgId,p.userId,'consultant',null);db=new PgDatabase(appConfig());repo=new PgWorkshopRepository(db);boards=new PgWhiteboardRepository(db);});
afterAll(async()=>{await db?.close();await resetOrgs(org,otherOrg);});

describe('persisted workshop ACL and privacy',()=>{
  it('comments are shared, editor-authored, author/owner-deletable, retry-safe',async()=>{
    const id=await board(),input={requestId:randomUUID(),objectId:null,text:'Discuss'};
    expect(await repo.addComment(viewer,id,input)).toBeNull();
    const c=await repo.addComment(editor,id,input);expect(c).not.toBeNull();
    expect(await repo.addComment(editor,id,input)).toEqual(c);
    expect(await repo.comments(viewer,id)).toEqual([c]);
    expect(await repo.deleteComment(viewer,id,c!.id)).toBe(false);
    expect(await repo.deleteComment(owner,id,c!.id)).toBe(true);
    expect(await repo.comments(editor,id)).toEqual([]);
    const own=await repo.addComment(editor,id,{...input,requestId:randomUUID()});
    expect(await repo.deleteComment(editor,id,own!.id)).toBe(true);
  });
  it('private drafts remain actor-local including from owner, shared comments and votes',async()=>{
    const id=await board();await repo.saveDraft(editor,id,{text:'SECRET-PRIVATE-DRAFT'});
    expect(await repo.draft(editor,id)).toMatchObject({text:'SECRET-PRIVATE-DRAFT'});
    expect(await repo.draft(owner,id)).toMatchObject({text:''});expect(await repo.draft(viewer,id)).toMatchObject({text:''});
    expect(JSON.stringify(await repo.comments(owner,id))).not.toContain('SECRET');
    expect(JSON.stringify(await repo.votes(owner,id))).not.toContain('SECRET');
    const fresh=new PgDatabase(appConfig());try{expect(await new PgWorkshopRepository(fresh).draft(editor,id)).toMatchObject({text:'SECRET-PRIVATE-DRAFT'});}finally{await fresh.close();}
    await boards.removeMember(owner,id,editor.userId);
    expect(await repo.draft(editor,id)).toBeNull();expect(await repo.saveDraft(editor,id,{text:'late'})).toBeNull();
  });
  it('cross-org owner identity cannot read or mutate any workshop feature',async()=>{
    const id=await board();
    expect(await repo.comments(outsider,id)).toBeNull();expect(await repo.addComment(outsider,id,{requestId:randomUUID(),objectId:null,text:'x'})).toBeNull();
    expect(await repo.draft(outsider,id)).toBeNull();expect(await repo.saveDraft(outsider,id,{text:'x'})).toBeNull();
    expect(await repo.votes(outsider,id)).toBeNull();expect(await repo.createVote(outsider,id,voteInput())).toBeNull();
    expect(await repo.timer(outsider,id)).toBeNull();expect(await repo.startTimer(outsider,id,{durationSeconds:30})).toBeNull();
  });
  it('only owner starts/closes votes; viewer can vote; active totals stay hidden from every role',async()=>{
    const id=await board(),input=voteInput();
    expect(await repo.createVote(editor,id,input)).toBeNull();
    const vote=await repo.createVote(owner,id,input);expect(vote).not.toBeNull();
    const cast={requestId:randomUUID(),objectId:'note_a',count:1};
    const first=await repo.castVote(viewer,id,vote!.id,cast);expect(first).toMatchObject({used:1,closed:false,results:null});
    expect(await repo.castVote(viewer,id,vote!.id,cast)).toEqual(first);
    for(const principal of [owner,editor,viewer]){
      const active=(await repo.votes(principal,id))![0]!;expect(active).toMatchObject({closed:false,results:null});expect(C.Vote.parse(active)).toEqual(active);
    }
    const publicView=(await repo.votes(editor,id))![0]!;expect(publicView.used).toBe(0);
    expect(JSON.stringify(publicView)).not.toContain(viewer.userId);
    expect(await repo.closeVote(editor,id,vote!.id)).toBeNull();
    expect(await repo.closeVote(owner,id,vote!.id)).toMatchObject({closed:true,results:[{objectId:'note_a',count:1}]});
    await expect(repo.castVote(viewer,id,vote!.id,{...cast,requestId:randomUUID()})).rejects.toThrow('VOTE_CLOSED');
    expect(await repo.castVote(viewer,id,vote!.id,cast)).toMatchObject({used:1,closed:true});
  });
  it('serializes concurrent quota checks and rejects replay payload changes',async()=>{
    const id=await board(),vote=await repo.createVote(owner,id,voteInput());
    const outcomes=await Promise.allSettled(Array.from({length:4},()=>repo.castVote(editor,id,vote!.id,{requestId:randomUUID(),objectId:'note_a',count:1})));
    expect(outcomes.filter(o=>o.status==='fulfilled')).toHaveLength(2);
    expect(outcomes.filter(o=>o.status==='rejected')).toHaveLength(2);
    expect((await repo.votes(editor,id))![0]).toMatchObject({used:2,closed:false,results:null});
    const requestId=randomUUID();await repo.castVote(viewer,id,vote!.id,{requestId,objectId:'note_b',count:1});
    await expect(repo.castVote(viewer,id,vote!.id,{requestId,objectId:'note_a',count:1})).rejects.toThrow('REQUEST_ID_REUSED');
  });
  it('fails closed when the server deadline passes between validation and ballot insertion',async()=>{
    const id=await board(),vote=await repo.createVote(owner,id,{...voteInput(),durationSeconds:1});
    let delayed=false;
    const delayedDb:DatabasePort={withTenant:(org,run)=>db.withTenant(org,s=>run({query:async(sql,params)=>{
      if(!delayed&&sql.startsWith('INSERT INTO whiteboard_ballots')){delayed=true;await s.query('SELECT pg_sleep(1.1)');}
      return s.query(sql,params);
    }})),withoutTenant:db.withoutTenant.bind(db),close:async()=>{}};
    await expect(new PgWorkshopRepository(delayedDb).castVote(editor,id,vote!.id,{requestId:randomUUID(),objectId:'note_a',count:1})).rejects.toThrow('VOTE_CLOSED');
    expect(delayed).toBe(true);
    expect((await repo.votes(editor,id))![0]).toMatchObject({closed:true,used:0,results:[]});
  });
  it('enforces target allowlist and membership, then reveals final totals at the server deadline without explicit close',async()=>{
    const id=await board(),vote=await repo.createVote(owner,id,voteInput());
    await expect(repo.castVote(editor,id,vote!.id,{requestId:randomUUID(),objectId:'unknown',count:1})).rejects.toThrow('VOTE_TARGET_INVALID');
    await repo.castVote(editor,id,vote!.id,{requestId:randomUUID(),objectId:'note_a',count:1});
    await boards.removeMember(owner,id,viewer.userId);
    expect(await repo.castVote(viewer,id,vote!.id,{requestId:randomUUID(),objectId:'note_a',count:1})).toBeNull();
    await asApp(org,s=>s.query("UPDATE whiteboard_votes SET deadline=clock_timestamp()-interval '1 second' WHERE org_id=$1 AND board_id=$2",[org,id]));
    await expect(repo.castVote(editor,id,vote!.id,{requestId:randomUUID(),objectId:'note_a',count:1})).rejects.toThrow('VOTE_CLOSED');
    expect((await repo.votes(editor,id))![0]).toMatchObject({closed:true,used:1,results:[{objectId:'note_a',count:1}]});
  });
  it('rejects missing and deleted object references but permits whole-board comments',async()=>{
    const id=await board();
    await expect(repo.addComment(editor,id,{requestId:randomUUID(),objectId:'missing',text:'x'})).rejects.toThrow('OBJECT_NOT_FOUND');
    await expect(repo.createVote(owner,id,{...voteInput(),objectIds:['missing']})).rejects.toThrow('OBJECT_NOT_FOUND');
    const vote=await repo.createVote(owner,id,voteInput());
    await new PgWhiteboardCollaborationStore(db).writeCommands(owner,id,{epoch:1,requestId:randomUUID(),commands:[{type:'delete',id:'note_a'}]});
    await expect(repo.castVote(viewer,id,vote!.id,{requestId:randomUUID(),objectId:'note_a',count:1})).rejects.toThrow('OBJECT_NOT_FOUND');
    expect(await repo.addComment(editor,id,{requestId:randomUUID(),objectId:null,text:'whole board'})).not.toBeNull();
    expect((await repo.votes(editor,id))![0]?.results).toBeNull();
  });
  it('timer persists a server deadline, is readable by members and controllable only by owner',async()=>{
    const id=await board();expect(await repo.timer(viewer,id)).toEqual({deadline:null,running:false});
    expect(await repo.startTimer(editor,id,{durationSeconds:60})).toBeNull();
    const timer=await repo.startTimer(owner,id,{durationSeconds:60});expect(timer?.running).toBe(true);
    expect(await repo.timer(viewer,id)).toEqual(timer);expect(await repo.stopTimer(viewer,id)).toBeNull();
    expect(await repo.stopTimer(owner,id)).toEqual({deadline:null,running:false});
    expect(await repo.timer(editor,id)).toEqual({deadline:null,running:false});
  });
  it('archived boards remain readable but reject all workshop writes',async()=>{
    const id=await board();await repo.saveDraft(editor,id,{text:'before'});await boards.update(owner,id,{archived:true});
    expect(await repo.saveDraft(editor,id,{text:'after'})).toBeNull();expect(await repo.draft(editor,id)).toMatchObject({text:'before'});
    expect(await repo.createVote(owner,id,voteInput())).toBeNull();expect(await repo.startTimer(owner,id,{durationSeconds:30})).toBeNull();
    expect(await repo.addComment(owner,id,{requestId:randomUUID(),text:'late',objectId:null})).toBeNull();
  });
  it('publishes exactly one sticky and deletes only the published draft revision in the same commit',async()=>{
    const id=await board(),saved=await repo.saveDraft(editor,id,{text:'publish me'});
    const input={requestId:randomUUID(),expectedRevision:saved!.revision!,geometry:{x:20,y:40,width:240,height:180,rotation:0}};
    const result=await repo.publishDraft(editor,id,input);expect(result).toMatchObject({replayed:false});
    const state=await new PgWhiteboardCollaborationStore(db).load(owner,id),doc=createWhiteboardDocument();Y.applyUpdate(doc,state.update);
    expect(readObjects(doc).find(o=>o.id===result!.objectId)).toMatchObject({kind:'sticky',text:'publish me',geometry:input.geometry});
    expect(await repo.draft(editor,id)).toEqual({text:'',revision:null});
    expect(await repo.publishDraft(editor,id,input)).toEqual({...result,replayed:true});
    expect((await new PgWhiteboardCollaborationStore(db).load(owner,id)).seq).toBe(state.seq);
    // A new draft receives a new revision and is not deleted by an old retry.
    const next=await repo.saveDraft(editor,id,{text:'next private'});expect(next!.revision).not.toBe(saved!.revision);
    await repo.publishDraft(editor,id,input);expect(await repo.draft(editor,id)).toEqual(next);
  });
  it('rejects stale draft revisions and modified idempotent publish payload',async()=>{
    const id=await board(),old=await repo.saveDraft(editor,id,{text:'v1'}),current=await repo.saveDraft(editor,id,{text:'v2'});
    const input={requestId:randomUUID(),expectedRevision:old!.revision!,geometry:{x:0,y:0,width:240,height:180,rotation:0}};
    await expect(repo.publishDraft(editor,id,input)).rejects.toThrow('DRAFT_REVISION_CHANGED');
    expect(await repo.draft(editor,id)).toEqual(current);
    const valid={...input,expectedRevision:current!.revision!};await repo.publishDraft(editor,id,valid);
    await expect(repo.publishDraft(editor,id,{...valid,geometry:{...valid.geometry,x:100}})).rejects.toThrow('REQUEST_ID_REUSED');
  });
  it('rolls back shared update, draft deletion and receipt when the last transaction write fails',async()=>{
    const id=await board(),saved=await repo.saveDraft(editor,id,{text:'keep private'});
    const before=await new PgWhiteboardCollaborationStore(db).load(owner,id);
    const failingDb:DatabasePort={withTenant:(org,run)=>db.withTenant(org,s=>run({query:async(sql,params)=>{if(sql.startsWith('INSERT INTO whiteboard_draft_publications'))throw new Error('INJECTED_RECEIPT_FAILURE');return s.query(sql,params);}})),withoutTenant:db.withoutTenant.bind(db),close:async()=>{}};
    const failing=new PgWorkshopRepository(failingDb);
    await expect(failing.publishDraft(editor,id,{requestId:randomUUID(),expectedRevision:saved!.revision!,geometry:{x:0,y:0,width:240,height:180,rotation:0}})).rejects.toThrow('INJECTED_RECEIPT_FAILURE');
    const after=await new PgWhiteboardCollaborationStore(db).load(owner,id);expect(after.seq).toBe(before.seq);expect(after.update).toEqual(before.update);expect(await repo.draft(editor,id)).toEqual(saved);
  });
  it('does not publish viewer drafts or disclose old receipts after membership revocation',async()=>{
    const id=await board(),saved=await repo.saveDraft(viewer,id,{text:'viewer private'});
    const input={requestId:randomUUID(),expectedRevision:saved!.revision!,geometry:{x:0,y:0,width:240,height:180,rotation:0}};
    expect(await repo.publishDraft(viewer,id,input)).toBeNull();
    await boards.putMember(owner,id,{userId:viewer.userId,role:'editor'});expect(await repo.publishDraft(viewer,id,input)).not.toBeNull();
    await boards.removeMember(owner,id,viewer.userId);expect(await repo.publishDraft(viewer,id,input)).toBeNull();
  });

});
