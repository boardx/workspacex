import {expect,it,vi} from 'vitest';
import {STANDARD_ARTIFACT_DOWNLOAD_TOOL} from '@repo/contracts/standard-artifact-download';
import {STANDARD_RUN_STATUS_TOOL} from '@repo/contracts/standard-run-status';
import {STANDARD_RUN_CANCEL_TOOL} from '@repo/contracts/standard-run-cancel';
import {bindNativeInvocation} from '../../src/application/agent-run/native-invocation';
import type {NativeSessionOwner} from '../../src/application/agent-run/native-session-owner';
it('admission registers shared tools with explicit read versus grant/cancellation approval',async()=>{
 const provision=vi.fn(async(..._args:Parameters<NativeSessionOwner['provision']>)=>({bindingId:'11111111-1111-4111-8111-111111111111',profile:'native-v1' as const,policy:'native-v1' as const}));
 await bindNativeInvocation({provision,resolve:vi.fn(),release:vi.fn(),releaseForRun:vi.fn()},{modelProvider:'deep-agent',modelId:'test',system:'',user:'',orgId:'org',runId:'run',executionAttemptId:'run:0',executionLeaseEpoch:1,onSkillActivity:async()=>{},onRemoteRunStarted:async()=>{}});
 expect(provision.mock.calls[0]![2]).toMatchObject({[STANDARD_ARTIFACT_DOWNLOAD_TOOL]:true,[STANDARD_RUN_STATUS_TOOL]:false,[STANDARD_RUN_CANCEL_TOOL]:true});
});
