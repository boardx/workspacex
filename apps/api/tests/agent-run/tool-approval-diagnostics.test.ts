import {afterEach,it,expect,vi} from 'vitest';
import {PgParentRunControlReader} from '../../src/infrastructure/agent-run/pg-parent-run-control';
import {toolArgumentsDigest} from '../../src/application/agent-run/tool-arguments-digest';
import type {DatabasePort} from '../../src/application/ports/database.port';
import {toOrgId} from '../../src/domain/org-id';
afterEach(()=>vi.restoreAllMocks());
const input={orgId:toOrgId('org'),parentRunId:'run',attemptId:'attempt',leaseEpoch:2,toolName:'fetch_url',toolCallId:'call',permissionRequestId:'permission',toolArgs:{url:'secret-url'}};
const row={active:true,cancel_requested:false,lease_valid:true,attempt_id:'attempt',skill_version_ids:[],pending_permission_request_id:'permission',pending_tool_call_id:'call',pending_tool_name:'fetch_url',pending_decision:'approve',pending_tool_args_digest:toolArgumentsDigest(input.toolArgs),pending_tool_authorized_attempt:null};
async function check(patch={},inputPatch={},consume=true){
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 const query=vi.fn().mockResolvedValueOnce({rows:[{...row,...patch}]}).mockResolvedValue({rows:consume?[{id:'run'}]:[]});
 const db={withTenant:async(_org:unknown,fn:(s:unknown)=>unknown)=>fn({query})} as unknown as DatabasePort;
 const allowed=await new PgParentRunControlReader(db).withSnapshot({...input,...inputPatch},async s=>s?.authorizeOnce?.());
 return {allowed,warn,query};
}
it.each([
 [{},{permissionRequestId:undefined},'missing_binding'],
 [{pending_permission_request_id:'other'}, {},'permission_mismatch'],
 [{pending_tool_call_id:'other'},{},'call_mismatch'],
 [{pending_tool_name:'other'},{},'tool_mismatch'],
 [{pending_decision:'deny'},{},'decision_unapproved'],
 [{pending_decision:'edit',pending_edited_args:'secret-invalid-json'},{},'edited_args_invalid'],
 [{pending_tool_args_digest:'other'},{},'digest_mismatch'],
 [{pending_tool_authorized_attempt:'other'},{},'attempt_mismatch'],
] as const)('preserves refusal and logs only fixed branch label %#',async(patch,change,reason)=>{
 const r=await check(patch,change);expect(r.allowed).toBe(false);
 expect(r.warn.mock.calls).toEqual([[`[tool-approval] once refused: ${reason}`]]);
 expect(r.query).toHaveBeenCalledTimes(1);
});
it('reports a failed consume without relaxing authorization',async()=>{
 const r=await check({}, {}, false);expect(r.allowed).toBe(false);
 expect(r.warn.mock.calls).toEqual([['[tool-approval] once refused: consume_failed']]);
});
it('approved identity and repeat same attempt remain allowed and silent',async()=>{
 const first=await check();expect(first.allowed).toBe(true);expect(first.warn).not.toHaveBeenCalled();
 vi.restoreAllMocks();
 const repeat=await check({pending_tool_authorized_attempt:'attempt'});expect(repeat.allowed).toBe(true);expect(repeat.warn).not.toHaveBeenCalled();expect(repeat.query).toHaveBeenCalledTimes(1);
});
