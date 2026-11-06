import { expect, it, vi } from 'vitest';
import { ToolExecutionAuthority } from '../../src/application/agent-run/tool-execution-authority';
import { createInMemoryToolPermissionGrantStore } from '../../src/application/agent-run/tool-permission-grants';
it('marks only verified one-call approval, preserving grants and hard denials', async () => {
 const grants=createInMemoryToolPermissionGrantStore();
 const snapshot={active:true,cancelRequested:false,leaseValid:true,attemptId:'attempt',skillVersionIds:[],explicitlyDenied:false,pendingApprovalCall:false,authorizeOnce:vi.fn(async()=>false)};
 const authority=new ToolExecutionAuthority({withSnapshot:async(_i,check)=>check(snapshot)}, {readPinnedSkills:async()=>[]},grants);
 const input={orgId:'org',parentRunId:'run',attemptId:'attempt',leaseEpoch:1,toolName:'execute',toolCallId:'call',toolArgs:{command:'render'}} as any;
 expect(await authority.check(input)).toEqual({allowed:false,reason:'approval_required'});
 snapshot.authorizeOnce.mockResolvedValue(true);
 expect(await authority.check(input)).toEqual({allowed:true,approvedOnce:true});
 snapshot.explicitlyDenied=true;
 expect(await authority.check(input)).toEqual({allowed:false,reason:'approval_required'});
 snapshot.explicitlyDenied=false; snapshot.leaseValid=false;
 expect(await authority.check(input)).toEqual({allowed:false,reason:'lease_lost'});
 snapshot.leaseValid=true;
 await grants.grantForRun(input.orgId,input.parentRunId,'execute');
 expect(await authority.check(input)).toEqual({allowed:true});
 // A run/standing grant cannot silently dispatch original arguments after a user edit.
 snapshot.pendingApprovalCall=true; snapshot.authorizeOnce.mockResolvedValue(false);
 expect(await authority.check(input)).toEqual({allowed:false,reason:'approval_required'});
 snapshot.authorizeOnce.mockResolvedValue(true);
 expect(await authority.check(input)).toEqual({allowed:true,approvedOnce:true});
});
