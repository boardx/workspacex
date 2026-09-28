import {expect,it,vi} from 'vitest';
import {fixture,principal,boardId,request} from './operation-service.test';
import {PgWhiteboardOperationRepository} from '../../src/infrastructure/whiteboard/pg-operation-repository';
import {WhiteboardEventCursor,WhiteboardEventPage} from '@repo/contracts/whiteboard-operation';
it('resumes the epoch/sequence pair and binds Agent polling to current read delegation',async()=>{
 const f=fixture();await f.service.execute(principal,boardId,request);
 const event=f.session.events[0] as {revision:{epoch:number;seq:number}};event.revision={epoch:2,seq:1};
 const events=vi.fn(f.audit.events);f.audit.events=events;
 const result=await f.service.events(principal,boardId,{actorId:'agent-1',afterEpoch:1,afterSeq:99,limit:1});
 expect(result).toMatchObject({nextEpoch:2,nextSeq:1});expect(WhiteboardEventPage.safeParse(result).success).toBe(true);
 expect(events).toHaveBeenCalledWith(f.session,principal,boardId,99,1,1);
 f.audit.events=async()=>[];expect(await f.service.events(principal,boardId,{actorId:'agent-1',afterEpoch:2,afterSeq:1})).toMatchObject({events:[],nextEpoch:2,nextSeq:1});
});
it.each(['disabled','foreign','write-only'] as const)('rejects %s Agent event reads before repository disclosure',async mode=>{
 const f=fixture(),events=vi.fn(f.audit.events);f.audit.events=events;
 f.audit.resolveActor=async()=>mode==='disabled'?null:{actorId:'agent-1',kind:'ai',delegatedBy:mode==='foreign'?'other':principal.userId,scopes:mode==='write-only'?['board:write']:['board:read'],model:null,skill:null};
 await expect(f.service.events(principal,boardId,{actorId:'agent-1'})).rejects.toMatchObject({code:'FORBIDDEN'});expect(events).not.toHaveBeenCalled();
});
it('SQL cursor compares and orders both epoch and sequence while retaining tenant scope',async()=>{
 const query=vi.fn(async(_sql:string,_params?:readonly unknown[])=>({rows:[]})),repository=new PgWhiteboardOperationRepository();
 await repository.events({query},principal,boardId,99,5,1);
 expect(query).toHaveBeenCalledWith(expect.stringContaining('revision_epoch>$5 OR (revision_epoch=$5 AND revision_seq>$3)'),[principal.orgId,boardId,99,5,1]);
 expect(query.mock.calls[0]?.[0]).toContain('ORDER BY revision_epoch,revision_seq,event_id');
 expect(WhiteboardEventCursor.safeParse({afterEpoch:0}).success).toBe(false);
});
