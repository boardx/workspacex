import {describe,it,expect} from "vitest";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
import {mergeTreeSummary,runMergeTreeDiagnostic} from "./merge-tree-diagnostic";
describe("separate bounded merge-tree diagnostics",()=>{
 it("classifies a nonzero error without emitting paths identity or token text",()=>{
  const value=mergeTreeSummary({status:128,signal:null,stdout:"PRIVATE-TOKEN",stderr:"fatal: unable to auto-detect email (PRIVATE-TOKEN)"});
  expect(value.exitCode).toBe(128);expect(value.stderrKinds).toEqual(["IDENTITY_REQUIRED"]);
  expect(JSON.stringify(value)).not.toContain("PRIVATE-TOKEN");expect(value.stdoutBytes).toBe(13);
 });
 it.each([["Permission denied /PRIVATE","OBJECT_PERMISSION"],["fatal: bad object PRIVATE","OBJECT_MISSING"],
  ["fatal: refusing to merge unrelated histories","NO_COMMON_HISTORY"],["fatal: not a git repository PRIVATE","REPOSITORY_CONTEXT"],
  ["No space left on device PRIVATE","NO_SPACE"]])("uses fixed classes for %s",(stderr,kind)=>{
  expect(mergeTreeSummary({status:128,signal:null,stdout:"",stderr}).stderrKinds).toContain(kind);
 });
 it("rejects real conflicting git merge with separate streams",()=>{
  const repo=mkdtempSync(join(tmpdir(),"merge-diagnostic-"));
  try{
   const git=(...args:string[])=>{const r=spawnSync("git",["-C",repo,"-c","user.name=Fixture","-c","user.email=fixture@example.invalid",...args],{encoding:"utf8"});expect(r.status).toBe(0);return r.stdout.trim();};
   git("init","-q");mkdirSync(join(repo,"files"));writeFileSync(join(repo,"files/shared"),"base\n");git("add",".");git("commit","-qm","base");
   const base=git("rev-parse","HEAD");writeFileSync(join(repo,"files/shared"),"left\n");git("commit","-qam","left");const left=git("rev-parse","HEAD");
   git("checkout","--detach",base);writeFileSync(join(repo,"files/shared"),"right\n");git("commit","-qam","right");const right=git("rev-parse","HEAD");
   const result=runMergeTreeDiagnostic(repo,left,right);expect(result.code).not.toBe(0);
  }finally{rmSync(repo,{recursive:true,force:true});}
 });
});
