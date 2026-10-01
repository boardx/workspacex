import { describe, expect, it } from "vitest";
import { validateDispatchIdentity, validateGitHubEvidence, validateTagGovernance, releaseTag, frozenTagBinding, validateFrozenTag, validateAdmissionDeployment, latestStatusContexts } from "./cn-frozen-release-identity.mjs";
const source="a".repeat(40),baseline="b".repeat(40),attempt="gha-123-1",repo="boardx/workspacex",sha256="c".repeat(64);
const identity={repository:repo,runId:123,runAttempt:1,releaseSourceSha:source,workflowSha:source,workflowRef:`${repo}/.github/workflows/promote-cn-production.yml@refs/tags/${releaseTag(source,attempt)}`,githubSha:source,githubRef:`refs/tags/${releaseTag(source,attempt)}`,expectedMainCnSha:baseline,attemptId:attempt};
const snapshot={schemaVersion:1,releaseSourceSha:source,attemptId:attempt,receiptSha256:sha256,manifestSha256:sha256,baselineSha256:sha256,images:Object.fromEntries(["api","web","agent","sandbox"].map(k=>[k,"sha256:"+sha256])),devapp:{status:"passed",sourceSha:source,runtimeSourceShas:Object.fromEntries(["api","web","agent","sandbox"].map(k=>[k,source])),browserAccepted:true,evidenceSha256:sha256,workflowRunId:55}};
const checks=["verify-control-plane","verify-affected","verify-full-compile","merge-gate","backend-required"].map(name=>({name,head_sha:source,status:"completed",conclusion:"success",app:{slug:"github-actions"}}));
const facts={checks,contexts:[],devappRun:{id:55,run_attempt:1,path:".github/workflows/real-model-chat-evidence.yml",head_sha:source,status:"completed",conclusion:"success",repository:{full_name:repo},head_repository:{full_name:repo}}};
describe("frozen candidate and native GitHub deployment identity",()=>{
 it("holds prepared A on a tag when main becomes B",()=>{expect(validateDispatchIdentity(identity).releaseSourceSha).toBe(source);validateGitHubEvidence(identity,snapshot,facts)});
 for(const patch of [{githubSha:baseline},{workflowSha:baseline},{githubRef:"refs/heads/main"},{workflowRef:`${repo}/.github/workflows/other.yml@${identity.githubRef}`},{repository:"fork/workspacex"},{attemptId:"other"}])it("rejects swapped ref/source/workflow/repo/attempt "+JSON.stringify(patch),()=>expect(()=>validateDispatchIdentity({...identity,...patch})).toThrow());
 it("requires exact root receipt/image/Devapp closure",()=>{
  for(const patch of [{releaseSourceSha:baseline},{attemptId:"other"},{receiptSha256:"present-only"},{images:{}},{devapp:{...snapshot.devapp,runtimeSourceShas:{...snapshot.devapp.runtimeSourceShas,api:baseline}}},{devapp:{...snapshot.devapp,browserAccepted:false}}])expect(()=>validateGitHubEvidence(identity,{...snapshot,...patch},facts)).toThrow();
 });
 it("does not use latest-main CI or a different Devapp run",()=>{
  for(const patch of [{checks:checks.map(c=>({...c,head_sha:baseline}))},{checks:checks.slice(1)},{checks:checks.map(c=>({...c,conclusion:"skipped"}))},{checks:[...checks,{name:"other",head_sha:source,status:"completed",conclusion:"failure",app:{slug:"github-actions"}}]},{devappRun:{...facts.devappRun,head_sha:baseline}},{devappRun:{...facts.devappRun,id:56}},{devappRun:{...facts.devappRun,conclusion:"failure"}},{devappRun:{...facts.devappRun,head_repository:{full_name:"fork/workspacex"}}}])expect(()=>validateGitHubEvidence(identity,snapshot,{...facts,...patch})).toThrow();
 });
 it("annotated tag freezes actual receipt bytes and images, not presence",()=>{
 const binding=validateGitHubEvidence(identity,snapshot,facts),tag=releaseTag(source,attempt),object={tag,object:{type:"commit",sha:source},message:JSON.stringify(frozenTagBinding(binding))};
 validateFrozenTag(object,tag,binding);
 for(const patch of [{object:{type:"commit",sha:baseline}},{message:JSON.stringify({...frozenTagBinding(binding),receiptSha256:"d".repeat(64)})},{tag:"other"}])expect(()=>validateFrozenTag({...object,...patch},tag,binding)).toThrow();
 });
 it("native admission success must belong to same candidate and actual run",()=>{
 const d={id:1,sha:source,ref:releaseTag(source,attempt),environment:"production-cn-promotion",creator:{login:"github-actions[bot]"}};
 const statuses=()=>[{created_at:"2026-10-01T00:00:00Z",state:"success",log_url:`https://github.com/${repo}/actions/runs/123/job/4`}];
 expect(validateAdmissionDeployment({...identity,releaseTag:d.ref},[d],statuses,"123")).toBe(1);
 for(const patch of [{sha:baseline},{ref:"main"},{environment:"production-cn"},{creator:{login:"someone"}}])expect(()=>validateAdmissionDeployment({...identity,releaseTag:d.ref},[{...d,...patch}],statuses,"123")).toThrow();
 expect(()=>validateAdmissionDeployment({...identity,releaseTag:d.ref},[d],statuses,"12")).toThrow();
 expect(()=>validateAdmissionDeployment({...identity,releaseTag:d.ref},[d],()=>[...statuses(),{created_at:"2026-10-01T00:01:00Z",state:"failure",log_url:`https://github.com/${repo}/actions/runs/123/job/4`}],"123")).toThrow();
 expect(()=>validateAdmissionDeployment({...identity,releaseTag:d.ref},[d],()=>[{created_at:"2026-10-01T00:00:00Z",state:"pending",log_url:`https://github.com/${repo}/actions/runs/123/job/4`}],"123")).toThrow();
 });
 it("selects true latest status across all pages without hiding current failure",()=>{
 const status=(id:number,state:string,created_at:string,context="custom")=>({id,state,context,created_at,url:`https://api.github.com/repos/${repo}/statuses/${source}`});
 const old=status(1,"failure","2026-10-01T00:00:00Z"),latest=status(2,"success","2026-10-01T00:01:00Z");
 expect(latestStatusContexts([old,latest],source,repo)).toEqual([latest]);
 const boundary=[old,...Array.from({length:99},(_,i)=>status(i+3,"success","2026-10-01T00:00:00Z",`other-${i}`)),latest];
 expect(latestStatusContexts(boundary,source,repo).find((x:{context:string})=>x.context==="custom")).toEqual(latest);
 validateGitHubEvidence(identity,snapshot,{...facts,contexts:latestStatusContexts([old,latest],source,repo)});
 for(const state of ["failure","unknown"])expect(()=>validateGitHubEvidence(identity,snapshot,{...facts,contexts:latestStatusContexts([status(1,"success","2026-10-01T00:00:00Z"),status(2,state,"2026-10-01T00:01:00Z")],source,repo)})).toThrow();
 expect(()=>latestStatusContexts([latest,{...latest,id:3,state:"failure"}],source,repo)).toThrow();
 expect(()=>latestStatusContexts([{...latest,url:`https://api.github.com/repos/${repo}/statuses/${baseline}`}],source,repo)).toThrow();
 });
 const policy={expectedTagAppId:1,promotion:{protection_rules:[{type:"required_reviewers",reviewers:[{type:"User",reviewer:{id:1}}]}],deployment_branch_policy:{custom_branch_policies:true,protected_branches:false}},promotionPolicies:[{type:"branch",name:"main"},{type:"tag",name:"cn-prepared-*"}],activation:{protection_rules:[],deployment_branch_policy:{custom_branch_policies:true,protected_branches:false}},activationPolicies:[{type:"branch",name:"main"},{type:"branch",name:"main-cn"},{type:"tag",name:"cn-prepared-*"}],tagRules:[{target:"tag",enforcement:"active",conditions:{ref_name:{include:["refs/tags/cn-prepared-*"],exclude:[]}},bypass_actors:[{actor_type:"Integration",actor_id:1,bypass_mode:"always"}],rules:[{type:"creation"}]},{target:"tag",enforcement:"active",conditions:{ref_name:{include:["refs/tags/cn-prepared-*"],exclude:[]}},bypass_actors:[],rules:[{type:"update"},{type:"deletion"}]}]};
 it("requires exact tag policies and restricted immutable creation",()=>{validateTagGovernance(policy);for(const patch of [{promotionPolicies:[...policy.promotionPolicies,{type:"tag",name:"*"}]},{tagRules:[]},{tagRules:[{...policy.tagRules[0],rules:[{type:"creation"},{type:"update"}]}]},{tagRules:[{...policy.tagRules[0],bypass_actors:[{actor_type:"RepositoryRole",actor_id:5,bypass_mode:"always"}]}]}])expect(()=>validateTagGovernance({...policy,...patch})).toThrow()});
});
