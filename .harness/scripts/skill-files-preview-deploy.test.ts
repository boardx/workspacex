import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
const workflow=parse(readFileSync(join(import.meta.dirname,"../../.github/workflows/backend-gates.yml"),"utf8"));
const release=parse(readFileSync(join(import.meta.dirname,"../../.github/workflows/image-release.yml"),"utf8"));
const sha="a".repeat(40);
function admitted(ref:string,event="workflow_dispatch",buildOnly=false) {
 return new Function("github","inputs",`return (${release.jobs.plan.if});`)(
  {ref,event_name:event},{build_only:buildOnly});
}
describe("retired Skill source-preview deployment",()=>{
 it("has no privileged source writer and rejects preview deployment refs",()=>{
  expect(workflow.jobs.deploy).toBeUndefined();
  for(const ref of ['refs/heads/codex/ai-capability-studio-live','refs/heads/codex/standard-capabilities','refs/heads/other']) {
   expect(admitted(ref)).toBe(false);
   expect(admitted(ref,'workflow_dispatch',true)).toBe(true);
  }
 });
 it("only admits develop automatic release and main/develop manual release",()=>{
  expect(admitted('refs/heads/develop','push')).toBe(true);
  for(const ref of ['refs/heads/main','refs/heads/main-cn','refs/tags/v1'])expect(admitted(ref,'push')).toBe(false);
  for(const ref of ['refs/heads/main','refs/heads/develop'])expect(admitted(ref)).toBe(true);
  expect(admitted('refs/heads/develop','merge_group')).toBe(false);
 });
 it("keeps registry build/manifest admission and fixed host activation",()=>{
  expect(release.jobs.deploy.needs).toEqual(['plan','build','manifest']);
  expect(release.jobs.deploy.concurrency).toEqual({group:"${{ needs.plan.outputs.group }}","cancel-in-progress":false});
  expect(release.jobs.deploy.steps.some((s:{uses?:string})=>s.uses?.startsWith('actions/checkout'))).toBe(false);
  expect(release.jobs.deploy.steps.at(-1).run).toBe('sudo -n /usr/local/bin/workspacex-image-release "$TARGET_ENVIRONMENT" "$IMAGE_TAG"');
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
  // The historical guard remains tested, but no current workflow invokes it.
  expect(workflow.jobs.deploy).toBeUndefined();
  expect(JSON.stringify(release)).not.toContain('verify-skill-preview-ref.sh');
});
