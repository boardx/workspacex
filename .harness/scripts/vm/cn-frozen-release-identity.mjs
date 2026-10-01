// Frozen-source promotion contract. GitHub observations are obtained by the CLI;
// host observations come only from the root-protected complete receipt verifier.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { validateMainSourceAdmission, collectMainSourceAdmission } from './cn-main-source-admission.mjs';
const sha = /^[a-f0-9]{40}$/, digest = /^[a-f0-9]{64}$/, attempt = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const services=['api','web','agent','sandbox'];
const fail = code => { throw new Error(code); };
export function releaseTag(source,id) {
 if(!sha.test(source??'')||!attempt.test(id??''))fail('FROZEN_RELEASE_INPUT');
 return `cn-prepared-${source}-${id}`;
}
export function validateDispatchIdentity(v) {
 const tag=releaseTag(v.releaseSourceSha,v.attemptId);
 if(v.repository!=='boardx/workspacex'||!Number.isSafeInteger(v.runId)||v.runId<=0||!Number.isSafeInteger(v.runAttempt)||v.runAttempt<=0||!sha.test(v.expectedMainCnSha??'')||v.githubSha!==v.releaseSourceSha||v.workflowSha!==v.releaseSourceSha||v.githubRef!==`refs/tags/${tag}`||v.workflowRef!==`${v.repository}/.github/workflows/promote-cn-production.yml@${v.githubRef}`)fail('FROZEN_RELEASE_DISPATCH_IDENTITY');
 return {repository:v.repository,runId:v.runId,runAttempt:v.runAttempt,workflowSha:v.workflowSha,workflowRef:v.workflowRef,releaseSourceSha:v.releaseSourceSha,releaseTag:tag,expectedMainCnSha:v.expectedMainCnSha,attemptId:v.attemptId};
}
export function validateGitHubEvidence(identity,snapshot,facts) {
 if(snapshot.schemaVersion!==1||snapshot.releaseSourceSha!==identity.releaseSourceSha||snapshot.attemptId!==identity.attemptId||!digest.test(snapshot.receiptSha256??'')||!digest.test(snapshot.manifestSha256??'')||!digest.test(snapshot.baselineSha256??'')||!digest.test(snapshot.governanceReceiptSha256??'')||services.some(k=>!/^sha256:[a-f0-9]{64}$/.test(snapshot.images?.[k]??'')))fail('FROZEN_RELEASE_PREPARED_BINDING');
 const d=snapshot.devapp,r=facts.devappRun;
 if(d?.status!=='passed'||d.sourceSha!==identity.releaseSourceSha||d.browserAccepted!==true||!digest.test(d.evidenceSha256??'')||!Number.isSafeInteger(d.workflowRunId)||d.workflowRunId<=0||services.some(k=>d.runtimeSourceShas?.[k]!==identity.releaseSourceSha))fail('FROZEN_RELEASE_DEVAPP_RECEIPT');
 if(d.workflowRunAttempt!==undefined&&r?.run_attempt!==d.workflowRunAttempt)fail('FROZEN_RELEASE_DEVAPP_GITHUB_ATTEMPT');
 if(r?.id!==d.workflowRunId||r.head_sha!==identity.releaseSourceSha||r.status!=='completed'||r.conclusion!=='success'||r.path!=='.github/workflows/real-model-chat-evidence.yml'||r.repository?.full_name!==identity.repository||r.head_repository?.full_name!==identity.repository)fail('FROZEN_RELEASE_DEVAPP_GITHUB_RUN');
 if(!Array.isArray(facts.checks)||!Array.isArray(facts.contexts)||facts.checks.some(c=>c.head_sha!==identity.releaseSourceSha||c.app?.slug!=='github-actions'))fail('FROZEN_RELEASE_CI_SOURCE');
 const mainSourceEvidenceSha256=hash(validateMainSourceAdmission(identity.releaseSourceSha,identity.repository,{...facts.mainAdmission,sourceChecks:facts.checks,sourceStatuses:facts.contexts}));
 return { ...identity, mainSourceEvidenceSha256, receiptSha256:snapshot.receiptSha256,governanceReceiptSha256:snapshot.governanceReceiptSha256,manifestSha256:snapshot.manifestSha256,baselineSha256:snapshot.baselineSha256,images:snapshot.images,devappEvidenceSha256:d.evidenceSha256,devappWorkflowRunId:d.workflowRunId };
}
export function validateTagGovernance(v) {
 const env=(e,policies,branches,review)=>{
  const names=policies.map(p=>`${p.type}:${p.name}`).sort(),expected=[...branches.map(n=>`branch:${n}`),'tag:cn-prepared-*'].sort();
  const reviewer=e.protection_rules?.find(r=>r.type==='required_reviewers');
  if(e.deployment_branch_policy?.custom_branch_policies!==true||e.deployment_branch_policy?.protected_branches!==false||JSON.stringify(names)!==JSON.stringify(expected)||!!reviewer!==review||(review&&!(reviewer.reviewers?.length>0)))fail('FROZEN_RELEASE_ENVIRONMENT_POLICY');
 };
 env(v.promotion,v.promotionPolicies,['main'],true);env(v.activation,v.activationPolicies,['main','main-cn'],false);
 const rules=v.tagRules.filter(r=>r.target==='tag'&&r.enforcement==='active'&&JSON.stringify(r.conditions?.ref_name?.include)===JSON.stringify(['refs/tags/cn-prepared-*'])&&r.conditions?.ref_name?.exclude?.length===0);
 if(rules.some(r=>!Array.isArray(r.bypass_actors)))fail('FROZEN_RELEASE_TAG_RULES_VISIBILITY');
 const immutable=rules.filter(r=>r.bypass_actors.length===0).flatMap(r=>r.rules??[]).map(r=>r.type);
 if(rules.some(r=>r.rules?.some(x=>['update','deletion'].includes(x.type))&&(r.bypass_actors??[]).length)||!immutable.includes('update')||!immutable.includes('deletion'))fail('FROZEN_RELEASE_TAG_RULES');
}
export function validateAdmissionDeployment(identity,deployments,readStatuses,run,jobs,appId) {
 const repo=identity.repository;
 if(run?.id!==identity.runId||run.run_attempt!==identity.runAttempt||run.head_sha!==identity.releaseSourceSha||run.path!=='.github/workflows/promote-cn-production.yml'||run.event!=='workflow_dispatch'||run.repository?.full_name!==repo||run.head_repository?.full_name!==repo||!Array.isArray(jobs))fail('FROZEN_RELEASE_NATIVE_RUN_IDENTITY');
 const actors=[run.actor,run.triggering_actor];
 if(actors.some(a=>!Number.isSafeInteger(a?.id)||a.id<=0||typeof a.login!=='string'||!a.login))fail('FROZEN_RELEASE_NATIVE_ACTOR_IDENTITY');
 const isActor=a=>actors.some(v=>a?.id===v.id&&a.login===v.login);
 const admitted=jobs.filter(j=>j.name==='admit'&&j.run_id===identity.runId&&j.run_attempt===identity.runAttempt&&j.head_sha===identity.releaseSourceSha&&j.status==='completed'&&j.conclusion==='success');
 if(admitted.length!==1||!Number.isSafeInteger(admitted[0].id)||admitted[0].id<=0||admitted[0].html_url!==`https://github.com/${repo}/actions/runs/${identity.runId}/job/${admitted[0].id}`)fail('FROZEN_RELEASE_NATIVE_ADMIT_JOB');
 for(const deployment of deployments) {
  if(deployment.sha!==identity.releaseSourceSha||(deployment.ref!==identity.releaseTag&&deployment.ref!==`refs/tags/${identity.releaseTag}`)||deployment.environment!=='production-cn-promotion'||!isActor(deployment.creator)||deployment.performed_via_github_app?.id!==appId||deployment.performed_via_github_app?.slug!=='github-actions')continue;
  const statuses=readStatuses(deployment.id);
  if(!Array.isArray(statuses)||!statuses.length||statuses.some(s=>!Number.isFinite(Date.parse(s.created_at))))fail('FROZEN_RELEASE_NATIVE_STATUS_IDENTITY');
  const latestTime=Math.max(...statuses.map(s=>Date.parse(s.created_at))),latest=statuses.filter(s=>Date.parse(s.created_at)===latestTime);
  if(latest.length!==1)fail('FROZEN_RELEASE_NATIVE_STATUS_AMBIGUOUS');
  const status=latest[0];
  if(status.state==='success'&&isActor(status.creator)&&status.log_url===admitted[0].html_url)return deployment.id;
 }
 fail('FROZEN_RELEASE_NATIVE_ADMISSION');
}

const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const gh=(endpoint)=>JSON.parse(execFileSync('gh',['api',endpoint],{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024}));
function pages(endpoint,key) {
 const all=[];for(let page=1;page<=100;page++) { const v=gh(`${endpoint}${endpoint.includes('?')?'&':'?'}per_page=100&page=${page}`),rows=key?v[key]:v;if(!Array.isArray(rows))fail('FROZEN_RELEASE_GITHUB_SHAPE');all.push(...rows);if(rows.length<100){if(key&&typeof v.total_count==='number'&&v.total_count!==all.length)fail('FROZEN_RELEASE_GITHUB_PAGINATION');return all;} }
 fail('FROZEN_RELEASE_GITHUB_PAGINATION');
}
export function validateGovernanceReceipt(v,identity,now=Date.now()) {
 if(v?.schemaVersion!==1||v.kind!=="governance"||v.repository!==identity.repository||v.sourceSha!==identity.releaseSourceSha||v.attemptId!==identity.attemptId||!Number.isFinite(Date.parse(v.observedAt))||!Number.isFinite(Date.parse(v.expiresAt))||Date.parse(v.observedAt)>now||Date.parse(v.expiresAt)<=now||Date.parse(v.expiresAt)-Date.parse(v.observedAt)>3600000)fail("FROZEN_RELEASE_GOVERNANCE_RECEIPT");
 validateTagGovernance(v.governance);
}
// A signature authenticates a past observation; it never replaces live policy reads.
const canonical=v=>JSON.stringify(sortObject(v));
function sortObject(v) {
 if(Array.isArray(v))return v.map(sortObject);
 if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sortObject(v[k])]));
 return v;
}
// GitHub serializes the same official timestamp as UTC or an explicit offset.
// Normalize only official object metadata, never signed bytes or arbitrary fields.
function governanceInstant(value) {
 const m=typeof value==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
 if(!m)fail('FROZEN_RELEASE_GOVERNANCE_VERSION');
 const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number);
 const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 const instant=Date.parse(value);
 if(month<1||month>12||day<1||day>days[month-1]||hour>23||minute>59||second>59||!Number.isFinite(instant))fail('FROZEN_RELEASE_GOVERNANCE_VERSION');
 return instant;
}
function governanceMetadata(v) {
 const result={...v};
 for(const key of ['created_at','updated_at'])if(Object.hasOwn(result,key))result[key]=governanceInstant(result[key]);
 return result;
}
export function validateLiveGovernance(signed,live) {
 validateTagGovernance(signed);
 const versioned=(a,b)=>{
  if(!Number.isSafeInteger(a?.id)||a.id<=0||a.id!==b?.id||governanceInstant(a.updated_at)!==governanceInstant(b.updated_at))fail('FROZEN_RELEASE_GOVERNANCE_VERSION');
 };
 for(const key of ['promotion','activation']){versioned(signed[key],live[key]);if(canonical(governanceMetadata(signed[key]))!==canonical(governanceMetadata(live[key])))fail('FROZEN_RELEASE_GOVERNANCE_CHANGED');}
 for(const key of ['promotionPolicies','activationPolicies']){
  const order=rows=>{if(!Array.isArray(rows)||rows.some(r=>!Number.isSafeInteger(r.id)||r.id<=0)||new Set(rows.map(r=>r.id)).size!==rows.length)fail('FROZEN_RELEASE_GOVERNANCE_POLICY_ID');return [...rows].sort((a,b)=>a.id-b.id);};
  if(canonical(order(signed[key]))!==canonical(order(live[key])))fail('FROZEN_RELEASE_GOVERNANCE_CHANGED');
 }
 if(!Array.isArray(live.tagRules)||!Array.isArray(signed.tagRules))fail('FROZEN_RELEASE_GOVERNANCE_RULES');
 const key=r=>`${r.source_type}:${r.source}:${r.id}`;
 const prior=new Map(signed.tagRules.map(r=>[key(r),r]));
 if(prior.size!==signed.tagRules.length||new Set(live.tagRules.map(key)).size!==live.tagRules.length||prior.size!==live.tagRules.length)fail('FROZEN_RELEASE_GOVERNANCE_RULE_SET');
 const completed=live.tagRules.map(r=>{
  const p=prior.get(key(r));versioned(p,r);
  if(!Array.isArray(p.bypass_actors))fail('FROZEN_RELEASE_TAG_RULES_VISIBILITY');
  const a=governanceMetadata(p),b=governanceMetadata(r);delete a.bypass_actors;delete b.bypass_actors;
  if(canonical(a)!==canonical(b)||(Object.hasOwn(r,'bypass_actors')&&canonical(r.bypass_actors)!==canonical(p.bypass_actors)))fail('FROZEN_RELEASE_GOVERNANCE_CHANGED');
  // GitHub documents this one field as hidden from callers without ruleset write access.
  return {...r,bypass_actors:p.bypass_actors};
 });
 validateTagGovernance({...live,tagRules:completed});
}
function governance(repo,snapshot,identity) {
 const prefix=`repos/${repo}`;
 const issuer=gh('apps/github-actions');
 if(issuer.slug!=='github-actions'||!Number.isSafeInteger(issuer.id)||issuer.id<=0)fail('FROZEN_RELEASE_NATIVE_APP_IDENTITY');
 if(snapshot.governance)validateGovernanceReceipt(snapshot.governance,identity);
 const rules=pages(`${prefix}/rulesets?includes_parents=true`).filter(v=>v.target==='tag'&&v.enforcement==='active').map(v=>{if(!Number.isSafeInteger(v.id)||v.id<=0)fail('FROZEN_RELEASE_GOVERNANCE_RULE_OWNER');const path=v.source_type==='Organization'&&v.source==='boardx'?`orgs/boardx/rulesets/${v.id}`:v.source_type==='Repository'&&v.source===repo?`${prefix}/rulesets/${v.id}`:null;if(!path)fail('FROZEN_RELEASE_GOVERNANCE_RULE_OWNER');return gh(path);});
 const v={promotion:gh(`${prefix}/environments/production-cn-promotion`),promotionPolicies:pages(`${prefix}/environments/production-cn-promotion/deployment-branch-policies`,'branch_policies'),activation:gh(`${prefix}/environments/production-cn`),activationPolicies:pages(`${prefix}/environments/production-cn/deployment-branch-policies`,'branch_policies'),tagRules:rules};if(snapshot.governance)validateLiveGovernance(snapshot.governance.governance,v);else validateTagGovernance(v);return issuer.id;
}
export function frozenTagBinding(binding) {
 const {releaseSourceSha,attemptId,receiptSha256,governanceReceiptSha256,mainSourceEvidenceSha256,manifestSha256,baselineSha256,images,devappEvidenceSha256,devappWorkflowRunId}=binding;
 return {schemaVersion:1,releaseSourceSha,attemptId,receiptSha256,governanceReceiptSha256,mainSourceEvidenceSha256,manifestSha256,baselineSha256,images,devappEvidenceSha256,devappWorkflowRunId};
}
export function validateFrozenTag(tagObject,tag,binding) {
 if(tagObject.tag!==tag||tagObject.object?.type!=='commit'||tagObject.object?.sha!==binding.releaseSourceSha||tagObject.message!==JSON.stringify(frozenTagBinding(binding)))fail('FROZEN_RELEASE_TAG_CHANGED');
}
function snapshotFromFile(file) {
 const lines=readFileSync(file,'utf8').split('\n').filter(l=>l.startsWith('CN_PROMOTION_IDENTITY_JSON='));if(lines.length!==1)fail('FROZEN_RELEASE_HOST_IDENTITY_MISSING');return JSON.parse(lines[0].slice('CN_PROMOTION_IDENTITY_JSON='.length));
}
export function latestStatusContexts(statuses,source,repository) {
 const grouped=new Map();
 for(const status of statuses) {
  if(typeof status.context!=='string'||!status.context||!Number.isSafeInteger(status.id)||status.id<=0||!Number.isFinite(Date.parse(status.created_at))||status.url!==`https://api.github.com/repos/${repository}/statuses/${source}`)fail('FROZEN_RELEASE_STATUS_SOURCE');
  const previous=grouped.get(status.context),time=Date.parse(status.created_at);
  if(!previous||time>previous.time)grouped.set(status.context,{time,status,tie:false});
  else if(time===previous.time)previous.tie=true;
 }
 if([...grouped.values()].some(v=>v.tie))fail('FROZEN_RELEASE_STATUS_LATEST_AMBIGUOUS');
 return [...grouped.values()].map(v=>v.status);
}
function observations(identity,snapshot) {
 const prefix=`repos/${identity.repository}`;
 return {mainAdmission:collectMainSourceAdmission(identity.repository,identity.releaseSourceSha,{gh,pages,git:args=>execFileSync('git',args,{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024,env:{...process.env,GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0'}})}),checks:pages(`${prefix}/commits/${identity.releaseSourceSha}/check-runs?filter=latest`,'check_runs'),contexts:latestStatusContexts(pages(`${prefix}/commits/${identity.releaseSourceSha}/statuses`),identity.releaseSourceSha,identity.repository),devappRun:gh(`${prefix}/actions/runs/${snapshot.devapp.workflowRunId}`)};
}
async function main() {
 const [mode,file]=process.argv.slice(2);if(!['freeze-tag','verify-dispatch','verify-admission'].includes(mode)||!file)fail('FROZEN_RELEASE_CLI_INPUT');
 const snapshot=snapshotFromFile(file);
 const identity={repository:process.env.GITHUB_REPOSITORY,workflowSha:process.env.GITHUB_WORKFLOW_SHA,workflowRef:process.env.GITHUB_WORKFLOW_REF,githubSha:process.env.GITHUB_SHA,githubRef:process.env.GITHUB_REF,releaseSourceSha:process.env.REVISION,expectedMainCnSha:process.env.EXPECTED_MAIN_CN,attemptId:process.env.ATTEMPT_ID,runId:Number(process.env.GITHUB_RUN_ID),runAttempt:Number(process.env.GITHUB_RUN_ATTEMPT)};
 if(mode!=='freeze-tag')validateDispatchIdentity(identity);
 else {if(identity.repository!=='boardx/workspacex'||identity.githubRef!=='refs/heads/main'||!sha.test(identity.expectedMainCnSha??''))fail('FROZEN_RELEASE_PREPARE_REF');identity.releaseTag=releaseTag(identity.releaseSourceSha,identity.attemptId);}
 const nativeActionsAppId=governance(identity.repository,snapshot,identity);
 const git=(...args)=>execFileSync('git',args,{encoding:'utf8',timeout:30000}).trim();
 if(git('rev-parse','HEAD')!==identity.releaseSourceSha)fail('FROZEN_RELEASE_CHECKOUT');
 execFileSync('git',['merge-base','--is-ancestor',identity.releaseSourceSha,'origin/main'],{stdio:'ignore',timeout:30000});
 if(identity.expectedMainCnSha!==identity.releaseSourceSha)execFileSync('git',['merge-base','--is-ancestor',identity.expectedMainCnSha,identity.releaseSourceSha],{stdio:'ignore',timeout:30000});
 const current=gh(`repos/${identity.repository}/git/ref/heads/main-cn`).object?.sha;
 if(current!==identity.expectedMainCnSha&&current!==identity.releaseSourceSha)fail('FROZEN_RELEASE_BASELINE');
 const dispatcher=git('show',`${identity.releaseSourceSha}:.github/workflows/promote-cn-production.yml`);
 if(!dispatcher.includes('CN_FROZEN_RELEASE_DISPATCHER_V1'))fail('FROZEN_RELEASE_DISPATCHER_NOT_READY');
 const actualHelper=readFileSync(fileURLToPath(import.meta.url));
 const sourceHelper=execFileSync('git',['show',`${identity.releaseSourceSha}:.harness/scripts/vm/cn-frozen-release-identity.mjs`],{timeout:30000});
 if(!actualHelper.equals(sourceHelper))fail('FROZEN_RELEASE_CONTROLLER_SOURCE_DRIFT');
 const binding=validateGitHubEvidence(identity,snapshot,observations(identity,snapshot));
 const tag=releaseTag(identity.releaseSourceSha,identity.attemptId),prefix=`repos/${identity.repository}`;
 const readTag=ref=>{if(ref.object?.type!=='tag')fail('FROZEN_RELEASE_UNATTESTED_TAG');return gh(`${prefix}/git/tags/${ref.object.sha}`);};
 if(mode==='freeze-tag') {
  // A protected annotated tag binds complete receipt bytes, images and evidence.
  // Existing tag may only be exact replay. Never patch, delete, or force a tag.
  let existing;try {existing=gh(`${prefix}/git/ref/tags/${tag}`);}catch(e){if(!String(e.stderr??'').includes('404'))throw e;}
  if(existing)validateFrozenTag(readTag(existing),tag,binding);
  else {
   const object=JSON.parse(execFileSync('gh',['api','--method','POST',`${prefix}/git/tags`,'-f',`tag=${tag}`,'-f',`message=${JSON.stringify(frozenTagBinding(binding))}`,'-f',`object=${identity.releaseSourceSha}`,'-f','type=commit'],{encoding:'utf8',timeout:30000}));
   validateFrozenTag(object,tag,binding);
   const made=JSON.parse(execFileSync('gh',['api','--method','POST',`${prefix}/git/refs`,'-f',`ref=refs/tags/${tag}`,'-f',`sha=${object.sha}`],{encoding:'utf8',timeout:30000}));
   if(made.object?.type!=='tag'||made.object?.sha!==object.sha)fail('FROZEN_RELEASE_TAG_CREATED_WRONG_SHA');
  }
 } else validateFrozenTag(readTag(gh(`${prefix}/git/ref/tags/${tag}`)),tag,binding);
 if(mode==='verify-admission')validateAdmissionDeployment({...identity,releaseTag:tag},pages(`${prefix}/deployments?sha=${identity.releaseSourceSha}&environment=production-cn-promotion`),id=>pages(`${prefix}/deployments/${id}/statuses`),gh(`${prefix}/actions/runs/${identity.runId}/attempts/${identity.runAttempt}`),pages(`${prefix}/actions/runs/${identity.runId}/attempts/${identity.runAttempt}/jobs`,'jobs'),nativeActionsAppId);
 const result={...binding,releaseTag:tag,requestSha256:hash(binding)};
 if(process.env.EXPECTED_REQUEST_SHA256&&process.env.EXPECTED_REQUEST_SHA256!==result.requestSha256)fail('FROZEN_RELEASE_REQUEST_CHANGED_AFTER_READINESS');
 if(process.env.GITHUB_OUTPUT)writeFileSync(process.env.GITHUB_OUTPUT,`release_tag=${tag}\nrequest_sha256=${result.requestSha256}\n`,{flag:'a'});
 console.log('CN_FROZEN_RELEASE_IDENTITY_JSON='+JSON.stringify(result));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('CN_FROZEN_RELEASE_NOT_READY');process.exitCode=3;});
