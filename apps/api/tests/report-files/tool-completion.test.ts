import {expect,it,vi} from 'vitest';
import {ToolExecutionAuthority} from '../../src/application/agent-run/tool-execution-authority';
import {toOrgId} from '../../src/domain/org-id';
const input={orgId:toOrgId('org-report-completion'),parentRunId:'run-report',attemptId:'attempt-1',leaseEpoch:1,toolName:'execute',toolCallId:'call-1',toolArgs:{command:'generate'}};
function fixture(){
 let published=false;const policy=()=>({jobId:'00000000-0000-4000-8000-000000000001',publication:{workspacePath:'/workspace/report.docx',title:'report.docx',mediaType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const,idempotencyKey:'report-file:request-1'},published});
 const snapshot={active:true,cancelRequested:false,leaseValid:true,attemptId:input.attemptId,skillVersionIds:['official-docx']};
 const reader={withSnapshot:async<T>(_i:unknown,check:(s:typeof snapshot)=>Promise<T>)=>check(snapshot)};
 const authority=new ToolExecutionAuthority(reader,{readPinnedSkills:vi.fn(async()=>[])},{hasGrant:vi.fn(async()=>true),grantForRun:vi.fn(async()=>undefined),grantStanding:vi.fn(async()=>undefined),revokeAllForRun:vi.fn(async()=>undefined),listStanding:vi.fn(async()=>[]),revokeStanding:vi.fn(async()=>false)},async()=>policy());
 return{authority,policy,publish:()=>{published=true;},snapshot};
}
it('refuses generation and repeat publication after the bound report file has actually staged',async()=>{
 const f=fixture();expect((await f.authority.check(input)).allowed).toBe(true);f.publish();
 expect(await f.authority.check(input)).toMatchObject({allowed:false,reason:'report_output_published'});
 expect(await f.authority.check({...input,toolName:'wx_artifact_publish',toolArgs:f.policy().publication})).toMatchObject({allowed:false,reason:'report_output_published'});
 expect((await f.authority.check({...input,toolName:'read_file'})).allowed).toBe(true);
});
it('requires the frozen publication parameters and does not supersede cancellation or lease checks',async()=>{
 const f=fixture();expect(await f.authority.check({...input,toolName:'wx_artifact_publish',toolArgs:{...f.policy().publication,title:'other.docx'}})).toMatchObject({allowed:false,reason:'report_output_mismatch'});
 f.snapshot.cancelRequested=true;expect(await f.authority.check(input)).toMatchObject({allowed:false,reason:'cancel_requested'});
});
