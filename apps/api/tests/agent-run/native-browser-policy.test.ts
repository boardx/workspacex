import { expect,it,vi } from "vitest";
import { STANDARD_BROWSER_TOOLS } from "@repo/contracts/standard-browser-tools";
import { classifyToolRisk } from "../../src/domain/agent-run/tool-risk-tier";
import { bindNativeInvocation } from "../../src/application/agent-run/native-invocation";
import type { NativeSessionOwner } from "../../src/application/agent-run/native-session-owner";

it("browser policy follows existing read/reversible-file/external-action levels",()=>{
 expect(STANDARD_BROWSER_TOOLS.map(name=>[name,classifyToolRisk(name)])).toEqual([
  ["browser_navigate","L2"],["browser_snapshot","L0"],["browser_click","L2"],
  ["browser_fill_form","L2"],["browser_take_screenshot","L1"],
 ]);
 expect(classifyToolRisk("browser_evaluate")).toBe("L2");
});
it("native owner receives all five canonical tools and requires approval before external actions",async()=>{
 const provision=vi.fn(async(..._args:Parameters<NativeSessionOwner["provision"]>)=>({bindingId:"11111111-1111-4111-8111-111111111111",profile:"native-v1" as const,policy:"native-v1" as const}));
 await bindNativeInvocation({provision,resolve:vi.fn(),release:vi.fn(async()=>{}),releaseForRun:vi.fn(async()=>{})},
 {modelProvider:"deep-agent",modelId:"test",system:"",user:"",orgId:"org",runId:"run",executionAttemptId:"run:1",executionLeaseEpoch:1,onSkillActivity:async()=>{},onRemoteRunStarted:async()=>{}});
 const policy=provision.mock.calls[0]![2];
 for(const name of STANDARD_BROWSER_TOOLS)expect(policy).toHaveProperty(name,classifyToolRisk(name)==="L2");
 expect(policy).not.toHaveProperty("browser_evaluate");
});
