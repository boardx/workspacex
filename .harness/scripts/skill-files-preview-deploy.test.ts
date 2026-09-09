import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
const workflow=parse(readFileSync(join(import.meta.dirname,"../../.github/workflows/backend-gates.yml"),"utf8"));
const deploy=workflow.jobs.deploy;
const sha="a".repeat(40);
function admitted({ref="refs/heads/codex/ai-capability-studio-live",event="workflow_dispatch",enabled=true,expected=sha,failed="",cancelled=false}={}) {
  const needs=Object.fromEntries(deploy.needs.map((name:string)=>[name,{result:name===failed?"failure":"success"}]));
  // Evaluate the actual small checked-in predicate, not a second copy of its policy.
  const expression=deploy.if.replace(/needs\.([a-z0-9-]+)\.result/g, (_:string,name:string)=>`needs[${JSON.stringify(name)}].result`);
  return new Function("github","inputs","needs","always","cancelled","startsWith",`return (${expression});`)(
    {ref,event_name:event,sha},{deploy_skill_files_preview:enabled,expected_skill_files_sha:expected,deploy_capabilities_preview:false},needs,()=>true,()=>cancelled,(a:string,b:string)=>a.startsWith(b));
}
describe("authorized Skill candidate deployment",()=>{
  it("accepts only the explicit exact-SHA candidate dispatch",()=>{
    expect(admitted()).toBe(true);
    expect(admitted({enabled:false})).toBe(false);
    expect(admitted({expected:"b".repeat(40)})).toBe(false);
    expect(admitted({expected:""})).toBe(false);
    expect(admitted({event:"pull_request"})).toBe(false);
    expect(admitted({ref:"refs/heads/other"})).toBe(false);
  });
  it("keeps every existing gate and deployment serialization",()=>{
    expect(deploy.needs).toEqual(["gates-fast","gates-test","gates-runtime","e2e-core-loop","native-document-chain","native-runtime-lane"]);
    for(const failed of deploy.needs)expect(admitted({failed})).toBe(false);
    expect(admitted({cancelled:true})).toBe(false);
    expect(deploy.concurrency).toEqual({group:"workspacex-devapp-deploy","cancel-in-progress":false});
    expect(deploy.steps.at(-1).env.DEPLOY_REF).toBe("${{ github.sha }}");
    expect(workflow.on.workflow_dispatch.inputs.deploy_skill_files_preview.default).toBe(false);
  });
});

it("shell guard rejects case aliases and a checkout different from the approved SHA",()=>{
  const root=join(import.meta.dirname,"../..");
  const head=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
  const env={...process.env,GITHUB_EVENT_NAME:"workflow_dispatch",GITHUB_REF:"refs/heads/codex/ai-capability-studio-live",GITHUB_SHA:head,EXPECTED_SKILL_FILES_SHA:head};
  const run=(delta:Record<string,string>)=>spawnSync("bash",[".harness/scripts/vm/verify-skill-preview-ref.sh"],{cwd:root,env:{...env,...delta},encoding:"utf8"}).status;
  expect(run({})).toBe(0);
  for(const delta of [{GITHUB_REF:"refs/heads/codex/AI-capability-studio-live"},{EXPECTED_SKILL_FILES_SHA:head.toUpperCase()},
    {GITHUB_SHA:"b".repeat(40),EXPECTED_SKILL_FILES_SHA:"b".repeat(40)},{GITHUB_EVENT_NAME:"pull_request"},{EXPECTED_SKILL_FILES_SHA:"main"}])expect(run(delta)).not.toBe(0);
  const guard=deploy.steps.find((step:{name?:string})=>step.name==="Verify exact authorized Skill preview checkout");
  expect(guard.run).toBe("bash .harness/scripts/vm/verify-skill-preview-ref.sh");
});
