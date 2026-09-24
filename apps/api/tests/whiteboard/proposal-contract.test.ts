import { describe,expect,it } from 'vitest';
import * as C from '@repo/contracts/whiteboard-proposal';
const command={type:'delete' as const,id:'note'};
const input={requestId:'123e4567-e89b-42d3-a456-426614174000',title:'Suggestion',baseEpoch:1,baseSeq:0,commands:[command]};
const pending={status:'pending' as const,decidedBy:null,decidedAt:null,requestId:null,committedEpoch:null,committedSeq:null};
describe('AI proposal trust boundary',()=>{
  it('rejects spoofed identity and generator claims; public creates are explicitly human/API',()=>{
    for(const claim of [{actorId:'admin'},{submittedBy:'admin'},{generatorLabel:'pretend AI'},{agentId:'agent'}])expect(C.CreateProposal.safeParse({...input,...claim}).success).toBe(false);
    const output={id:input.requestId,title:'Suggestion',status:'pending',baseEpoch:1,baseSeq:0,commands:input.commands,commandDecisions:[pending],
      provenance:{submittedBy:'real-principal',actor:{kind:'human',id:'real-principal'},source:{kind:'api'},createdAt:'2026-09-24T00:00:00.000Z',participant:{kind:'human-api',actorId:'real-principal',verified:true}},decidedBy:null,createdAt:'2026-09-24T00:00:00.000Z',decidedAt:null,committedEpoch:null,committedSeq:null};
    expect(C.Proposal.safeParse(output).success).toBe(true);
    expect(C.Proposal.safeParse({...output,provenance:{...output.provenance,participant:{kind:'agent',verified:true,agentId:'spoof'}}}).success).toBe(false);
  });
  it('uses the shared 500-command ceiling with an exact 500/501 counterexample',()=>{
    expect(C.WHITEBOARD_PROPOSAL_LIMITS.commands).toBe(500);
    expect(C.CreateProposal.safeParse({...input,commands:Array.from({length:500},(_,index)=>({...command,id:`n${index}`}))}).success).toBe(true);
    expect(C.CreateProposal.safeParse({...input,commands:Array.from({length:501},(_,index)=>({...command,id:`n${index}`}))}).success).toBe(false);
  });
  it('requires unique, bounded command selections and unique proposals in an atomic decision',()=>{
    const proposalId='223e4567-e89b-42d3-a456-426614174000';
    const valid={requestId:input.requestId,action:'accept',selections:[{proposalId,commandIndexes:[0,2]}]};
    expect(C.BatchDecision.safeParse(valid).success).toBe(true);
    expect(C.BatchDecision.safeParse({...valid,selections:[{proposalId,commandIndexes:[0,0]}]}).success).toBe(false);
    expect(C.BatchDecision.safeParse({...valid,selections:[...valid.selections,...valid.selections]}).success).toBe(false);
    expect(C.BatchDecision.safeParse({...valid,selections:[{proposalId,commandIndexes:Array.from({length:501},(_,index)=>index)}]}).success).toBe(false);
  });
  it('requires explicit epoch/sequence preconditions and valid commands',()=>{
    for(const bad of [{baseEpoch:0},{baseSeq:-1},{baseSeq:Number.MAX_SAFE_INTEGER+1},{commands:[]},{commands:[{type:'execute-tool',tool:'admin'}]}])expect(C.CreateProposal.safeParse({...input,...bad}).success).toBe(false);
    expect(C.DecideProposal.safeParse({requestId:input.requestId,decidedBy:'admin'}).success).toBe(false);
  });
});
