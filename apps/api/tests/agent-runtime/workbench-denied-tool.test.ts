import { expect, it } from "vitest";
import { matchesDeniedTool } from "../../src/infrastructure/agent-run/pg-parent-run-control";
import { toolArgumentsDigest } from "../../src/application/agent-run/tool-arguments-digest";
import { toOrgId } from "../../src/domain/org-id";
const input={orgId:toOrgId("org"),parentRunId:"run",attemptId:"run:1",leaseEpoch:1,toolName:"external_write",toolArgs:{target:"rejected"}};
const pending={pending_decision:"deny",pending_tool_call_id:"denied",pending_tool_name:"external_write",pending_tool_args_digest:toolArgumentsDigest(input.toolArgs)};
it("denial cannot be bypassed by omitted or relabeled call identity",()=>{
  expect(matchesDeniedTool(input,pending)).toBe(true);
  expect(matchesDeniedTool({...input,toolCallId:"invented"},pending)).toBe(true);
  expect(matchesDeniedTool({...input,toolCallId:"denied",toolArgs:{target:"other"}},pending)).toBe(true);
  expect(matchesDeniedTool({...input,toolCallId:"new",toolArgs:undefined},pending)).toBe(true);
});
it("preserves scoped grants for genuinely distinct future calls",()=>{
  expect(matchesDeniedTool({...input,toolCallId:"new",toolArgs:{target:"other"}},pending)).toBe(false);
  expect(matchesDeniedTool(input,{...pending,pending_decision:"approve"})).toBe(false);
});
