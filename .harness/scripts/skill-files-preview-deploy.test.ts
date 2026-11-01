import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
  expect(release.jobs.deploy.needs).toEqual(['plan','build','manifest','admission']);
  expect(release.jobs.deploy.concurrency).toEqual({group:"${{ needs.plan.outputs.group }}","cancel-in-progress":false});
  expect(release.jobs.deploy.steps.some((s:{uses?:string})=>s.uses?.startsWith('actions/checkout'))).toBe(false);
  const script=release.jobs.deploy.steps.at(-1).run as string;
  expect(script.match(/sudo -n \/usr\/local\/bin\/workspacex-image-release "\$TARGET_ENVIRONMENT" "\$IMAGE_TAG"/g)).toHaveLength(1);
  expect(script.match(/\bsudo\b/g)).toHaveLength(1);
  expect(script).not.toContain('eval ');
  expect(script).not.toContain('git ');
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

for(const status of [0,1,23])it(`fixed host activation preserves exit ${status}, exact argv and redacted summary`,()=>{
 const directory=mkdtempSync(join(tmpdir(),'wsx-release-summary-'));
 try {
  const stub=join(directory,'sudo'),args=join(directory,'args'),summary=join(directory,'summary');
  writeFileSync(stub,`#!/bin/sh
printf '%s\\n' "$@" > "$TEST_ARGS"
printf '%s\\n' '{"status":"REJECTED","code":"SCHEMA_CHANGE_REQUIRES_SEPARATE_RELEASE","applyAttempted":false,"secret":"never-forward","schemaChanges":[{"role":"api","added":["new.sql"],"removed":[],"changed":[]}]}'
exit "$TEST_EXIT"
`);chmodSync(stub,0o700);
  const result=spawnSync('bash',['-e','-c',release.jobs.deploy.steps.at(-1).run],{encoding:'utf8',env:{...process.env,PATH:directory+':'+process.env.PATH,TEST_ARGS:args,TEST_EXIT:String(status),GITHUB_STEP_SUMMARY:summary,TARGET_ENVIRONMENT:'us',IMAGE_TAG:'41248889927-1'}});
  expect(result.status,result.stderr).toBe(status);
  expect(readFileSync(args,'utf8').trim().split('\n')).toEqual(['-n','/usr/local/bin/workspacex-image-release','us','41248889927-1']);
  const text=readFileSync(summary,'utf8');expect(text).toContain('SCHEMA_CHANGE_REQUIRES_SEPARATE_RELEASE');expect(text).toContain('new.sql');expect(text).not.toContain('never-forward');
 } finally {rmSync(directory,{recursive:true,force:true});}
});
