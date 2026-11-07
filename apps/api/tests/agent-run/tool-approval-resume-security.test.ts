import { expect, it, vi } from 'vitest';
import { PgParentRunControlReader } from '../../src/infrastructure/agent-run/pg-parent-run-control';
import { ToolExecutionAuthority } from '../../src/application/agent-run/tool-execution-authority';
import { createInMemoryToolPermissionGrantStore } from '../../src/application/agent-run/tool-permission-grants';
import { toolArgumentsDigest } from '../../src/application/agent-run/tool-arguments-digest';
const original={command:'echo original'};
const edited={command:'echo edited'};
const input={orgId:'org',parentRunId:'run',attemptId:'run:1',leaseEpoch:2,toolName:'execute',toolCallId:'same-call',permissionRequestId:'123e4567-e89b-42d3-a456-426614174000',toolArgs:original};
function env(patch:Record<string,unknown>={}){
 const row={active:true,cancel_requested:false,lease_valid:true,attempt_id:'run:1',skill_version_ids:[],pending_permission_request_id:input.permissionRequestId,pending_tool_call_id:'same-call',pending_tool_name:'execute',pending_tool_args_digest:toolArgumentsDigest(original),pending_decision:'edit',pending_edited_args:JSON.stringify(edited),pending_tool_authorized_attempt:null,...patch};
 const query=vi.fn(async(sql:string)=>sql.startsWith('SELECT')?{rows:[row]}:{rows:[{id:'run'}]});
 const reader=new PgParentRunControlReader({withTenant:async(_org:unknown,work:any)=>work({query})} as never);
 const grants=createInMemoryToolPermissionGrantStore();
 const service=new ToolExecutionAuthority(reader,{readPinnedSkills:async()=>[]},grants);
 return {service,grants,query};
}
it.each(['run','standing'] as const)('does not execute original edited-away args under an existing %s grant',async(scope)=>{
 const {service,grants,query}=env();
 if(scope==='run')await grants.grantForRun('org' as never,'run','execute');else await grants.grantStanding('org' as never,'execute','user');
 expect(await service.check(input as never)).toEqual({allowed:false,reason:'approval_required'});
 expect(query).toHaveBeenCalledTimes(1);
});
it.each(['run','standing'] as const)('fails closed if resume marker is omitted despite a %s grant',async(scope)=>{
 const {service,grants}=env();
 if(scope==='run')await grants.grantForRun('org' as never,'run','execute');else await grants.grantStanding('org' as never,'execute','user');
 expect(await service.check({...input,permissionRequestId:undefined} as never)).toEqual({allowed:false,reason:'approval_required'});
});
it.each(['run','standing'] as const)('fails closed if resume marker is stale despite a %s grant',async(scope)=>{
 const {service,grants}=env();
 if(scope==='run')await grants.grantForRun('org' as never,'run','execute');else await grants.grantStanding('org' as never,'execute','user');
 expect(await service.check({...input,permissionRequestId:'223e4567-e89b-42d3-a456-426614174000'} as never)).toEqual({allowed:false,reason:'approval_required'});
});
it('approves exactly edited args and preserves same-attempt resume marker without consuming twice',async()=>{
 const first=env();
 expect(await first.service.check({...input,toolArgs:edited} as never)).toEqual({allowed:true,approvedOnce:true});
 expect(first.query).toHaveBeenCalledTimes(2);
 const resumed=env({pending_tool_authorized_attempt:'run:1'});
 expect(await resumed.service.check({...input,toolArgs:edited} as never)).toEqual({allowed:true,approvedOnce:true});
 expect(resumed.query).toHaveBeenCalledTimes(1);
});
it.each([[{cancel_requested:true},'cancel_requested'],[{lease_valid:false},'lease_lost'],[{attempt_id:'run:2'},'attempt_stale'],[{active:false},'run_unavailable']] as const)('does not consume approval through hard denial %s',async(patch,reason)=>{
 const {service,grants,query}=env(patch);await grants.grantForRun('org' as never,'run','execute');
 expect(await service.check({...input,toolArgs:edited} as never)).toEqual({allowed:false,reason});expect(query).toHaveBeenCalledTimes(1);
});

it.each(['run','standing'] as const)('fails closed when same-tool pending call omits call ID under %s grant',async scope=>{
 const {service,grants}=env();
 if(scope==='run')await grants.grantForRun('org' as never,'run','execute');else await grants.grantStanding('org' as never,'execute','user');
 expect(await service.check({...input,toolCallId:undefined,permissionRequestId:undefined} as never)).toEqual({allowed:false,reason:'approval_required'});
});
