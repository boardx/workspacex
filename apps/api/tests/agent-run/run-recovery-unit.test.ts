import {afterEach,describe,expect,it,vi} from "vitest";
import {DeepAgentModelProvider} from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import {assertCurrentRunLease,RunLeaseLostError,withRunLease} from "../../src/application/agent-run/run-lease";
import {toOrgId} from "../../src/domain/org-id";
const provider=new DeepAgentModelProvider({baseUrl:"http://kernel.invalid",timeoutMs:1000,pollIntervalMs:1});
afterEach(()=>vi.unstubAllGlobals());
function remote(status:string,state:unknown){
 const fetcher=vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith("/state")?state:{run_id:"remote",status}),{status:200}));
 vi.stubGlobal("fetch",fetcher);return fetcher;
}
describe("recovery joins an existing run without re-execution",()=>{
 it("reads running status without submitting anything",async()=>{
  const fetcher=remote("running",{});expect(await provider.reconcileExistingRun("t","remote")).toEqual({kind:"running"});
  expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0]?.[0]).toContain("/runs/remote");
 });
 it("uses completion only when checkpoint identity belongs to that remote run",async()=>{
  const fetcher=remote("success",{metadata:{run_id:"remote"},values:{messages:[{type:"ai",content:"Recovered answer"}]}});
  expect(await provider.reconcileExistingRun("t","remote")).toEqual({kind:"success",completion:{text:"Recovered answer"}});
  for(const call of fetcher.mock.calls)expect(call[0]).not.toContain("/cancel");
  remote("success",{metadata:{run_id:"different-run"},values:{messages:[{type:"ai",content:"Wrong answer"}]}});
  expect(await provider.reconcileExistingRun("t","remote")).toMatchObject({kind:"uncertain",diagnostic:"checkpoint_run_identity_unverified"});
 });
 it("does not rerun a candidate script after an ambiguous API crash",async()=>{
  remote("success",{metadata:{run_id:"remote"},values:{messages:[{type:"tool",content:"```run_script\nsideEffect()\n```"},{type:"ai",content:"Created"}]}});
  expect(await provider.reconcileExistingRun("t","remote")).toMatchObject({kind:"failed",diagnostic:"output_execution_requires_review_no_replay"});
 });
 it("blocks the next outbound side effect after losing a lease",async()=>{
  const effect=vi.fn();
  await expect(withRunLease({orgId:toOrgId("o"),runId:"r",epoch:1,verify:async()=>{throw new RunLeaseLostError();}},async()=>{await assertCurrentRunLease();effect();})).rejects.toBeInstanceOf(RunLeaseLostError);
  expect(effect).not.toHaveBeenCalled();
 });
});

describe("checkpoint response identity and turn boundary",()=>{
 it("returns the actual final id and ignores scripts from an older turn",async()=>{
  remote("success",{metadata:{run_id:"remote"},values:{messages:[
   {type:"tool",content:"```run_script\noldAlreadyExecuted()\n```"},
   {type:"human",id:"wsx-turn:logical:user",content:"new request"},
   {type:"ai",id:"answer-actual",content:"Fresh response"},
  ]}});
  expect(await provider.reconcileExistingRun("t","remote","logical")).toEqual({kind:"success",completion:{text:"Fresh response",finalMessageId:"answer-actual"}});
 });
 it("does not guess the current turn when its persisted message marker is absent",async()=>{
  remote("success",{metadata:{run_id:"remote"},values:{messages:[{type:"ai",id:"other",content:"Old text"}]}});
  expect(await provider.reconcileExistingRun("t","remote","logical")).toMatchObject({kind:"uncertain",diagnostic:"checkpoint_turn_boundary_unverified"});
 });
});
