import {describe,it,expect} from "vitest";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {completeSquashProofHistory} from "./squash-proof-history";
const p={source:"a".repeat(40),parent:"b".repeat(40),squash:"c".repeat(40)},base="d".repeat(40);
describe("fixed proof history completion",()=>{
 it("complete connected graph needs no fetch",()=>{
  const calls:string[]=[];completeSquashProofHistory(cmd=>{calls.push(cmd);return{code:0,out:cmd.includes("is-shallow")?"false":base};},[p],()=>{});
  expect(calls.some(c=>c.startsWith("fetch"))).toBe(false);
 });
 it("network rejection stops after one same-origin fetch",()=>{
  const calls:string[]=[];expect(()=>completeSquashProofHistory(cmd=>{calls.push(cmd);return cmd.includes("is-shallow")?{code:0,out:"true"}:{code:1,out:"PRIVATE-TOKEN"};},[p],()=>{})).toThrow("FETCH_REJECTED");
  expect(calls.filter(c=>c.startsWith("fetch"))).toEqual(["fetch --no-tags --no-write-fetch-head --unshallow origin "+p.parent+" "+p.source+" "+p.squash]);
 });
 it("unrelated graph is still refused after ordinary fetch",()=>{
  expect(()=>completeSquashProofHistory(cmd=>cmd.includes("is-shallow")?{code:0,out:"false"}:cmd.startsWith("fetch")?{code:0,out:""}:{code:1,out:""},[p],()=>{})).toThrow("INCOMPLETE");
 });
 it("real shallow graph gains common ancestry without changing HEAD refs or worktree",()=>{
  const root=mkdtempSync(join(tmpdir(),"proof-history-")),origin=join(root,"origin"),clone=join(root,"clone");
  const env={...process.env,GIT_ALLOW_PROTOCOL:"file",GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:"/dev/null"};
  const run=(cwd:string,args:string[])=>spawnSync("git",["-C",cwd,...args],{env,encoding:"utf8"});
  const ok=(cwd:string,...args:string[])=>{const r=run(cwd,["-c","user.name=Fixture","-c","user.email=fixture@example.invalid",...args]);expect(r.status,r.stderr).toBe(0);return r.stdout.trim();};
  try{
   expect(spawnSync("git",["init","-q","-b","main",origin],{env}).status).toBe(0);
   writeFileSync(join(origin,"base"),"base");ok(origin,"add",".");ok(origin,"commit","-qm","base");const common=ok(origin,"rev-parse","HEAD");
   for(let i=0;i<4;i++){writeFileSync(join(origin,"main"),String(i));ok(origin,"add",".");ok(origin,"commit","-qm","target advance");}
   const parent=ok(origin,"rev-parse","HEAD");ok(origin,"checkout","-qb","source",common);
   for(let i=0;i<4;i++){writeFileSync(join(origin,"source"),String(i));ok(origin,"add",".");ok(origin,"commit","-qm","source advance");}
   const source=ok(origin,"rev-parse","HEAD");ok(origin,"checkout","main");ok(origin,"merge","--squash","source");ok(origin,"commit","-qm","actual squash");const squash=ok(origin,"rev-parse","HEAD");
   expect(spawnSync("git",["init","-q",clone],{env}).status).toBe(0);ok(clone,"remote","add","origin","file://"+origin);
   ok(clone,"fetch","--depth=2","origin",parent,source,squash);ok(clone,"checkout","--detach",squash);
   expect(run(clone,["merge-base",parent,source]).status).toBe(1);
   const head=ok(clone,"rev-parse","HEAD"),refs=ok(clone,"for-each-ref","--format=%(refname):%(objectname)").trim(),status=ok(clone,"status","--porcelain");
   const git=(cmd:string)=>{const r=run(clone,cmd.split(" "));return{code:r.status??1,out:r.stdout};};
   const notes:string[]=[];completeSquashProofHistory(git,[{source,parent,squash}],x=>notes.push(x));
   expect(ok(clone,"merge-base",parent,source)).toBe(common);expect(ok(clone,"rev-parse","--is-shallow-repository")).toBe("false");
   expect(ok(clone,"merge-tree","--write-tree","--no-messages",parent,source)).toBe(ok(clone,"rev-parse",squash+"^{tree}"));
   expect(ok(clone,"rev-parse","HEAD")).toBe(head);expect(ok(clone,"for-each-ref","--format=%(refname):%(objectname)").trim()).toBe(refs);expect(ok(clone,"status","--porcelain")).toBe(status);
   expect(notes[0]).toContain('"shallow":true');expect(notes[1]).toContain('"mergeBaseCounts":[1]');
  }finally{rmSync(root,{recursive:true,force:true});}
 });
});
