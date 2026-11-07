import {describe,it,expect} from "vitest";
import {reconstructedSquash,type ProofGit} from "./squash-integration-proof";
const p={source:"a".repeat(40),squash:"b".repeat(40),parent:"c".repeat(40)};
const head="d".repeat(40),witness="e".repeat(40),blob="f".repeat(40),tree="1".repeat(40);
const path="phases/phase-99-demo/sprints/sprint-01/evidence/F01.verify.log";
const valid:ProofGit=cmd=>{
 if(cmd.startsWith("rev-list"))return{code:0,out:p.squash+" "+p.parent};
 if(cmd.includes("^{tree}")||cmd.startsWith("merge-tree"))return{code:0,out:tree};
 if(cmd.startsWith("rev-parse"))return{code:0,out:blob};
 return{code:0,out:""};
};
describe("bounded squash predicate diagnostics preserve rejection",()=>{
 it("names missing source without accepting or exposing raw stderr",()=>{
  const notes:string[]=[];
  const git:ProofGit=cmd=>cmd==="cat-file -e "+p.source+"^{commit}"?{code:1,out:"PRIVATE-CREDENTIAL"}:valid(cmd);
  expect(reconstructedSquash(git,head,witness,path,blob,[p],x=>notes.push(x))).toBe(false);
  expect(notes).toEqual(["SQUASH_PROOF_REJECTED MISSING_SOURCE"]);
 });
 it("distinguishes failed merge exit, unexpected output and different complete tree",()=>{
  for(const [result,reason] of [[{code:1,out:tree},"MERGE_TREE_EXIT"],[{code:0,out:tree+"\nPRIVATE"},"MERGE_TREE_OUTPUT"],
   [{code:0,out:"2".repeat(40)},"COMPLETE_TREE_MISMATCH"]] as const){
   const notes:string[]=[];
   expect(reconstructedSquash(cmd=>cmd.startsWith("merge-tree")?result:valid(cmd),head,witness,path,blob,[p],x=>notes.push(x))).toBe(false);
   expect(notes).toEqual(["SQUASH_PROOF_REJECTED "+reason]);
  }
 });
 it("emits exact immutable identity on successful complete-tree proof",()=>{
  const notes:string[]=[];expect(reconstructedSquash(valid,head,witness,path,blob,[p],x=>notes.push(x))).toBe(true);
  expect(notes).toEqual(["SQUASH_PROOF_MATCH "+p.source+" "+p.squash+" "+tree]);
 });
});
