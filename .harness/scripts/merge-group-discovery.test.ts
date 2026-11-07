import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMergeGroupPrNumbers } from "./lib/merge-queue";
import { readMergeGroupPrNumbers } from "./merge-gate";
const actual=JSON.parse(readFileSync(new URL("./fixtures/merge-queue/candidate-d0b8d0e.json",import.meta.url),"utf8"));
const base="b".repeat(40),head="a".repeat(40),prior="c".repeat(40),source="d".repeat(40);
const ref=(n:number,b=base)=>`refs/heads/gh-readonly-queue/develop/pr-${n}-${b}`;
const line=(sha:string,parent:string,n:number)=>`${sha}\t${parent} ${source}\tMerge pull request #${n} from boardx/topic`;
it("frozen actual d0b candidate contains only PR6123, not source issue6107",()=>{
 expect(actual.sourceIssueSubject).toContain("(#6107)");
 expect(parseMergeGroupPrNumbers(actual.ref,actual.firstParentLines,actual.baseSha,actual.headSha)).toEqual([6123]);
});
it("enumerates every synthetic merge in a multi-PR first-parent chain",()=>{
 expect(parseMergeGroupPrNumbers(ref(102),[line(head,prior,102),line(prior,base,101)],base,head)).toEqual([101,102]);
});
it.each([
 ["missing history",[]], ["incomplete chain",[line(head,prior,102)]],
 ["head mismatch",[line(prior,base,102)]], ["unknown subject",[`${head}\t${base} ${source}\tordinary source (#102)`]],
 ["single parent",[`${head}\t${base}\tMerge pull request #102 from boardx/topic`]],
 ["unknown intermediate",[line(head,prior,102),`${prior}\t${base} ${source}\tunknown (#101)`]],
 ["duplicate PR",[line(head,prior,102),line(prior,base,102)]],
 ["ref PR differs from head",[line(head,base,101)]],
] as const)("fails closed for %s even though the ref names a PR",(_name,lines)=>{
 expect(parseMergeGroupPrNumbers(ref(102),lines,base,head)).toEqual([]);
});
it("fails closed on a mismatched base in the queue ref",()=>{expect(parseMergeGroupPrNumbers(ref(102,prior),[line(head,base,102)],base,head)).toEqual([]);});
const dirs:string[]=[];afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
it("reads actual single/multi synthetic Git history without walking source issue subjects",()=>{
 const cwd=mkdtempSync(join(tmpdir(),"wsx-merge-candidate-"));dirs.push(cwd);
 const git=(args:string[],input?:string)=>execFileSync("git",args,{cwd,input,encoding:"utf8",env:{...process.env,GIT_AUTHOR_NAME:"Fixture",GIT_AUTHOR_EMAIL:"fixture@example.test",GIT_COMMITTER_NAME:"Fixture",GIT_COMMITTER_EMAIL:"fixture@example.test"}}).trim();
 git(["init","--quiet"]);const tree=git(["mktree"],"");
 const commit=(message:string,parents:string[]=[])=>git(["commit-tree",tree,...parents.flatMap(p=>["-p",p]),"-m",message]);
 const b=commit("base"),s1=commit("fix(source): issue only (#6107)",[b]);
 const one=commit("Merge pull request #6123 from boardx/one",[b,s1]);
 expect(readMergeGroupPrNumbers(ref(6123,b),b,one,cwd)).toEqual([6123]);
 const s2=commit("fix(other): source issue (#9999)",[b]);
 const two=commit("Merge pull request #6124 from boardx/two",[one,s2]);
 expect(readMergeGroupPrNumbers(ref(6124,b),b,two,cwd)).toEqual([6123,6124]);
 const unknown=commit("unrecognized queue step (#7777)",[one,s2]);
 expect(readMergeGroupPrNumbers(ref(7777,b),b,unknown,cwd)).toEqual([]);
 expect(readMergeGroupPrNumbers(ref(6124,b),source,two,cwd)).toEqual([]);
});
