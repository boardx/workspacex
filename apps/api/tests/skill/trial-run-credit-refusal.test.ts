import {describe,expect,it,vi} from "vitest";
import {executeQueuedTrialRuns,type ExecuteTrialRunDeps} from "../../src/application/skill/execute-trial-run";
import {CreditConsumptionError} from "../../src/application/billing/credit-consumption";
import {currentCreditSubject} from "../../src/application/billing/credit-execution-context";
import {toOrgId} from "../../src/domain/org-id";

describe("claimed trial run credit refusal",()=>{
 it.each(["credit_required","credit_accounting_unavailable"] as const)("persists both claimed runs after %s without retrying a paid operation",async code=>{
  const orgId=toOrgId("trial-org"),subjects:unknown[]=[];
  const complete=vi.fn(async()=>{subjects.push(currentCreditSubject());throw new CreditConsumptionError(code,"user","actor-a");});
  const fail=vi.fn(),succeed=vi.fn(),sandbox=vi.fn();
  const deps={
   store:{claimQueued:async()=>[{id:"trial-a",actorId:"actor-a",versionId:"version",sampleInput:"one"},{id:"trial-b",actorId:"actor-b",versionId:"version",sampleInput:"two"}],fail,succeed},
   runs:{readPinnedSkills:async()=>[{versionId:"version",content:"make a script"}]},
   model:{complete},sandbox:{run:sandbox},objects:{putOnce:vi.fn()},modelProvider:"test",modelId:"test",log:vi.fn(),
  } as unknown as ExecuteTrialRunDeps;
  await expect(executeQueuedTrialRuns(deps,{orgId})).resolves.toBe(2);
  expect(fail.mock.calls.map(([row])=>row)).toEqual([
   {orgId,id:"trial-a",code:"DEPENDENCY_UNAVAILABLE",stderr:code,attempts:0},
   {orgId,id:"trial-b",code:"DEPENDENCY_UNAVAILABLE",stderr:code,attempts:0},
  ]);
  expect(subjects).toEqual([{orgId,userId:"actor-a"},{orgId,userId:"actor-b"}]);
  expect(complete).toHaveBeenCalledTimes(2);
  expect(succeed).not.toHaveBeenCalled();expect(sandbox).not.toHaveBeenCalled();
  expect(currentCreditSubject()).toBeUndefined();
 });
});
