import { describe,expect,it } from 'vitest';
import * as C from '@repo/contracts/whiteboard-workshop';
const requestId='123e4567-e89b-42d3-a456-426614174000';
describe('workshop strict input and anonymous response contracts',()=>{
  it('does not accept actor spoofing or oversized private text',()=>{
    expect(C.SavePrivateDraft.safeParse({text:'private',userId:'other'}).success).toBe(false);
    expect(C.SavePrivateDraft.safeParse({text:'x'.repeat(20001)}).success).toBe(false);
    expect(C.CreateComment.safeParse({requestId,objectId:null,text:'x',authorId:'other'}).success).toBe(false);
  });
  it('bounds votes and requires unique allowed objects',()=>{
    const value={requestId,title:'vote',quota:2,durationSeconds:30,objectIds:['note']};
    expect(C.CreateVote.parse(value)).toEqual(value);
    for(const bad of [{quota:0},{quota:101},{durationSeconds:0},{objectIds:['note','note']},{objectIds:Array.from({length:5001},(_,i)=>`n${i}`)}])expect(C.CreateVote.safeParse({...value,...bad}).success).toBe(false);
    expect(C.CastVote.safeParse({requestId,objectId:'note',count:0}).success).toBe(false);
  });
  it('hides active totals and rejects voter identity disclosure in final results',()=>{
    const active={id:requestId,title:'vote',quota:2,deadline:'2026-09-24T00:00:00.000Z',closed:false as const,objectIds:['note'],used:0,results:null};
    expect(C.Vote.parse(active)).toEqual(active);
    expect(C.Vote.safeParse({...active,results:[{objectId:'note',count:1}]}).success).toBe(false);
    const closed={...active,closed:true as const,results:[{objectId:'note',count:1}]};
    expect(C.Vote.parse(closed)).toEqual(closed);
    expect(C.Vote.safeParse({...closed,voters:['person']}).success).toBe(false);
    expect(C.Vote.safeParse({...closed,results:[{objectId:'note',count:1,userId:'person'}]}).success).toBe(false);
  });
  it('requires an exact draft revision and validated geometry for publication',()=>{
    const value={requestId,expectedRevision:requestId,geometry:{x:0,y:0,width:240,height:180,rotation:0}};
    expect(C.PublishDraft.parse(value)).toEqual(value);
    expect(C.PublishDraft.safeParse({...value,expectedRevision:null}).success).toBe(false);
    expect(C.PublishDraft.safeParse({...value,userId:'another-person'}).success).toBe(false);
    expect(C.PublishDraft.safeParse({...value,geometry:{...value.geometry,width:0}}).success).toBe(false);
    expect(C.PrivateDraft.parse({text:'',revision:null})).toEqual({text:'',revision:null});
  });

});
