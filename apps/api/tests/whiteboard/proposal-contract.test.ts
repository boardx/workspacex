import { describe,expect,it } from 'vitest';
import * as C from '@repo/contracts/whiteboard-proposal';
import { WHITEBOARD_LIMITS } from '@repo/contracts/whiteboard-document';
const input={requestId:'123e4567-e89b-42d3-a456-426614174000',title:'Suggestion',baseEpoch:1,baseSeq:0,commands:[{type:'delete',id:'note'}]};
describe('AI proposal trust boundary',()=>{
  it('rejects spoofed authenticated identities while permitting explicitly unverified generator labels',()=>{
    expect(C.CreateProposal.safeParse({...input,actorId:'admin'}).success).toBe(false);
    expect(C.CreateProposal.safeParse({...input,submittedBy:'admin'}).success).toBe(false);
    expect(C.CreateProposal.safeParse({...input,generatorLabel:'caller supplied label'}).success).toBe(true);
    expect(C.DecideProposal.safeParse({requestId:input.requestId,decidedBy:'admin'}).success).toBe(false);
  });
  it('requires bounded valid commands and explicit epoch/sequence preconditions',()=>{
    for(const bad of [{baseEpoch:0},{baseSeq:-1},{baseSeq:Number.MAX_SAFE_INTEGER+1},{commands:[]},{commands:Array.from({length:WHITEBOARD_LIMITS.batch+1},()=>({type:'delete',id:'note'}))},{commands:[{type:'execute-tool',tool:'admin'}]}])expect(C.CreateProposal.safeParse({...input,...bad}).success).toBe(false);
  });
  it('never upgrades caller metadata to verified agent identity',()=>{
    const output={id:input.requestId,title:'Suggestion',status:'pending',baseEpoch:1,baseSeq:0,commands:input.commands,provenance:{submittedBy:'real-principal',generator:{label:'bot',verified:false}},decidedBy:null,createdAt:'2026-09-24T00:00:00.000Z',decidedAt:null,committedEpoch:null,committedSeq:null};
    expect(C.Proposal.safeParse(output).success).toBe(true);
    expect(C.Proposal.safeParse({...output,provenance:{...output.provenance,generator:{label:'bot',verified:true}}}).success).toBe(false);
  });
});
