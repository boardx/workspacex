// Release source admission is distinct from PR merge admission (#4972).
// Historical PR policy and merge-time reconstruction remain the original single source.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { classifyChecks } from '../lib/pr-queue.ts';
import { reconstructMergeTimeChecks, commitStatusToObservation } from '../lib/pr-green.ts';
import { parse as parseYaml } from 'yaml';
import { parsePolicy } from '../lib/ci-check-policy.mjs';
import { shardPlan } from '../ci-api-shards.mjs';
const shardHelperSha256=createHash('sha256').update(readFileSync(new URL('../ci-api-shards.mjs',import.meta.url))).digest('hex');
const sha=/^[a-f0-9]{40}$/;
const fail=code=>{throw new Error(code)};

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const rawEvidenceHash=facts=>createHash('sha256').update(JSON.stringify(canonical({...facts,prChecks:facts.prChecks.slice().sort((a,b)=>a.id-b.id),prStatuses:facts.prStatuses.slice().sort((a,b)=>a.id-b.id),sourceChecks:facts.sourceChecks.slice().sort((a,b)=>a.id-b.id),sourceStatuses:facts.sourceStatuses.slice().sort((a,b)=>a.id-b.id),associatedPrs:facts.associatedPrs.slice().sort((a,b)=>a.number-b.number)}))).digest('hex');
const ready=(checks,policy)=>{const v=classifyChecks(checks,policy);return !v.blocked.length&&!v.changes.length&&!v.waitingCi.length};
export function validateMainSourceAdmission(source,repository,facts) {
 if(!sha.test(source)||repository!=='boardx/workspacex'||facts?.sourceCommit?.sha!==source||facts.mainContainsSource!==true)fail('MAIN_SOURCE_IDENTITY');
 const prs=facts.associatedPrs?.filter(p=>p.merged===true&&p.merge_commit_sha===source&&p.base?.ref==='main'&&p.base?.repo?.full_name===repository&&p.head?.repo?.full_name===repository);
 if(prs?.length!==1)fail('MAIN_SOURCE_PR_AMBIGUOUS');
 const pr=prs[0],parents=facts.sourceCommit.parents?.map(p=>p.sha),head=pr.head?.sha;
 if(!sha.test(head)||!Number.isSafeInteger(pr.number)||pr.number<=0||!Number.isFinite(Date.parse(pr.merged_at))||pr.merged_by?.login==='github-merge-queue')fail('MAIN_SOURCE_PR_IDENTITY');
 if(!Array.isArray(parents)||![1,2].includes(parents.length)||parents.some(p=>!sha.test(p))||(parents.length===2&&parents[1]!==head)||facts.mergeTree!==facts.sourceCommit.tree?.sha||!sha.test(facts.mergeTree))fail('MAIN_SOURCE_TREE');
 const policy=parsePolicy(facts.mergeParentPolicy);
 const historical=facts.prChecks;
 if(!Array.isArray(historical)||historical.some(c=>c.head_sha!==head||c.app?.slug!=='github-actions'||!Number.isSafeInteger(c.id)||c.id<=0||!Number.isFinite(Date.parse(c.started_at))||(c.completed_at!==null&&!Number.isFinite(Date.parse(c.completed_at)))))fail('MAIN_SOURCE_PR_CHECK_IDENTITY');
 if(!Array.isArray(facts.prStatuses)||facts.prStatuses.some(s=>s.url!==`https://api.github.com/repos/${repository}/statuses/${head}`||!Number.isSafeInteger(s.id)||s.id<=0||!Number.isFinite(Date.parse(s.created_at))))fail('MAIN_SOURCE_PR_STATUS_IDENTITY');
 const observations=historical.map(c=>({id:c.id,name:c.name,status:c.status,conclusion:c.conclusion,startedAt:c.started_at,completedAt:c.completed_at}));
 observations.push(...facts.prStatuses.map(s=>commitStatusToObservation({id:s.id,context:s.context,state:s.state,createdAt:s.created_at})));
 if(!ready(reconstructMergeTimeChecks(observations,pr.merged_at),policy))fail('MAIN_SOURCE_MERGE_CI');
 if(!Array.isArray(facts.sourceChecks)||facts.sourceChecks.some(c=>c.head_sha!==source||c.app?.slug!=='github-actions'||!Number.isSafeInteger(c.id)||c.id<=0))fail('MAIN_SOURCE_RUNTIME_CHECK_IDENTITY');
 if(!Array.isArray(facts.sourceStatuses)||facts.sourceStatuses.some(s=>s.url!==`https://api.github.com/repos/${repository}/statuses/${source}`))fail('MAIN_SOURCE_RUNTIME_STATUS_IDENTITY');
 // Same classifier semantics; only the release runtime obligations differ from a PR.
 const checks=facts.sourceChecks.map(c=>({name:c.name,status:c.status,conclusion:c.conclusion}));
 checks.push(...facts.sourceStatuses.map(s=>commitStatusToObservation({context:s.context,state:s.state,createdAt:s.created_at})));
 const deployNeeds=facts.deploymentWorkflow?.jobs?.deploy?.needs;
 if(!Array.isArray(deployNeeds)||!deployNeeds.length||deployNeeds.some(n=>typeof n!=='string'||!facts.deploymentWorkflow.jobs[n]))fail('MAIN_SOURCE_DEPLOY_OBLIGATIONS');
 const runtimePolicy=parsePolicy(facts.sourcePolicy);
 const obligations=[...new Set([...runtimePolicy.requiredChecks.filter(n=>n!=='merge-gate'&&!runtimePolicy.aggregates[n]),...Object.values(runtimePolicy.aggregates).flat(),...deployNeeds])];
 let dynamicShardPlan=null;
 const runtimeChecks=obligations.flatMap(name=>{const job=facts.deploymentWorkflow.jobs[name],matrix=job?.strategy?.matrix;if(!matrix)return [job?.name??name];const keys=Object.keys(matrix);if(keys.length!==1||keys[0]!=='shard'||job.name)fail('MAIN_SOURCE_MATRIX_OBLIGATIONS');let shards=matrix.shard;
  if(typeof shards==='string') {
   const planJob=facts.deploymentWorkflow.jobs['api-test-plan'];
   if(name!=='gates-test'||shards!=='${{ fromJSON(needs.api-test-plan.outputs.shards) }}'||job.needs!=='api-test-plan'||planJob?.outputs?.shards!=='${{ steps.plan.outputs.shards }}'||planJob?.outputs?.count!=='${{ steps.plan.outputs.count }}'||planJob.steps?.length!==2||planJob.steps[0].uses!=='actions/checkout@v5'||planJob.steps[0].with!==undefined||planJob.env!==undefined||planJob.steps.some(s=>s.env!==undefined)||planJob.steps?.filter(s=>s.id==='plan').length!==1||planJob.steps.find(s=>s.id==='plan').run!=='node .harness/scripts/ci-api-shards.mjs --plan'||facts.sourceShardHelperSha256!==shardHelperSha256)fail('MAIN_SOURCE_DYNAMIC_SHARD_CLOSURE');
   dynamicShardPlan=shardPlan(facts.sourceShardPolicy);shards=dynamicShardPlan.shards;
  }
  if(!Array.isArray(shards)||!shards.length||new Set(shards).size!==shards.length||shards.some(n=>!Number.isSafeInteger(n)||n<1))fail('MAIN_SOURCE_MATRIX_OBLIGATIONS');return shards.map(n=>`${name} (${n})`)});
 if(dynamicShardPlan)runtimeChecks.push('api-test-plan');
 if(!ready(checks,{...runtimePolicy,requiredChecks:runtimeChecks}))fail('MAIN_SOURCE_RUNTIME_CI');
 return {rawEvidenceSha256:rawEvidenceHash(facts),dynamicShardPlan,sourceShardPolicy:dynamicShardPlan?facts.sourceShardPolicy:null,sourceShardHelperSha256:dynamicShardPlan?facts.sourceShardHelperSha256:null,historicalRuns:historical.filter(c=>Date.parse(c.started_at)<=Date.parse(pr.merged_at)).sort((a,b)=>a.id-b.id).map(c=>({id:c.id,name:c.name,headSha:c.head_sha,status:c.status,conclusion:c.conclusion,startedAt:c.started_at,completedAt:c.completed_at})),historicalStatuses:facts.prStatuses.filter(c=>Date.parse(c.created_at)<=Date.parse(pr.merged_at)).sort((a,b)=>a.id-b.id).map(c=>({id:c.id,context:c.context,state:c.state,createdAt:c.created_at,url:c.url})),runtimeStatuses:facts.sourceStatuses.slice().sort((a,b)=>String(a.context).localeCompare(String(b.context))).map(c=>({id:c.id,context:c.context,state:c.state,createdAt:c.created_at,url:c.url})),policySha256:createHash('sha256').update(JSON.stringify({historical:policy,runtime:runtimePolicy})).digest('hex'),mergeChecks:reconstructMergeTimeChecks(observations,pr.merged_at).sort((a,b)=>a.name.localeCompare(b.name)),runtimeChecks:facts.sourceChecks.filter(c=>runtimeChecks.includes(c.name)).map(c=>({id:c.id,name:c.name,conclusion:c.conclusion})).sort((a,b)=>a.name.localeCompare(b.name)),sourceSha:source,prNumber:pr.number,prHeadSha:head,mergeParentSha:parents[0],mergeTree:facts.mergeTree,mergedAt:pr.merged_at};
}
export function collectMainSourceAdmission(repository,source,{gh,pages,git}) {
 if(repository!=='boardx/workspacex'||!sha.test(source))fail('MAIN_SOURCE_INPUT');
 const prefix=`repos/${repository}`, sourceCommit=gh(`${prefix}/git/commits/${source}`);
 const associated=pages(`${prefix}/commits/${source}/pulls`).filter(p=>p.merge_commit_sha===source&&p.base?.ref==='main');
 if(associated.length!==1)fail('MAIN_SOURCE_PR_AMBIGUOUS');
 const pr=gh(`${prefix}/pulls/${associated[0].number}`),parent=sourceCommit.parents?.[0]?.sha,head=pr.head?.sha;
 if(!sha.test(parent)||!sha.test(head))fail('MAIN_SOURCE_TREE');
 // git is argv-only, supplied by CLI; no shell interpolation or branch mutation.
 for(const s of [source,parent,head])git(['cat-file','-e',`${s}^{commit}`]);
 const mergeTree=git(['merge-tree','--write-tree',parent,head]).trim();
 if(!sha.test(mergeTree))fail('MAIN_SOURCE_TREE');
 const currentMain=gh(`${prefix}/git/ref/heads/main`).object?.sha;
 if(!sha.test(currentMain))fail('MAIN_SOURCE_IDENTITY');
 const comparison=gh(`${prefix}/compare/${source}...${currentMain}`);
 const deploymentWorkflow=parseYaml(git(['show',`${source}:.github/workflows/backend-gates.yml`]));
 const dynamic=Object.values(deploymentWorkflow.jobs??{}).some(j=>typeof j.strategy?.matrix?.shard==='string');
 const shardClosure=dynamic?{sourceShardPolicy:JSON.parse(git(['show',`${source}:.harness/api-test-shards.json`])),sourceShardHelperSha256:createHash('sha256').update(git(['show',`${source}:.harness/scripts/ci-api-shards.mjs`])).digest('hex')}:{};
 return {...shardClosure,sourcePolicy:JSON.parse(git(['show',`${source}:.harness/config/ci-check-policy.json`])),deploymentWorkflow,sourceCommit,associatedPrs:[pr],mergeTree,mainContainsSource:['ahead','identical'].includes(comparison.status),mergeParentPolicy:JSON.parse(git(['show',`${parent}:.harness/config/ci-check-policy.json`])),prChecks:pages(`${prefix}/commits/${head}/check-runs?filter=all`,'check_runs'),prStatuses:pages(`${prefix}/commits/${head}/statuses`),sourceChecks:pages(`${prefix}/commits/${source}/check-runs?filter=latest`,'check_runs'),sourceStatuses:pages(`${prefix}/commits/${source}/statuses`)};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length!==5)fail('MAIN_SOURCE_CLI_INPUT');const [source,repository,file]=process.argv.slice(2);console.log('CN_MAIN_SOURCE_ADMISSION_JSON='+JSON.stringify(validateMainSourceAdmission(source,repository,JSON.parse(readFileSync(file,'utf8')))))}catch(e){console.error(e.message);process.exitCode=1}
}
