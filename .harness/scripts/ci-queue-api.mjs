/** Queue API consumer: acceptance owns execution, backend verifies immutable evidence. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {shardPlan} from './ci-api-shards.mjs';
import {bundle} from './ci-base-api.mjs';
import {createLookupApi} from './ci-lane-dedup.mjs';
import {integrationVerdict} from './ci-devapp-integration-gate.mjs';
const workflowPath='.github/workflows/harness-acceptance.yml';
export async function waitForProducer({apiFactory,sha,count,clock=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),budgetMs=35*60_000}) {
 if(!/^[a-f0-9]{40}$/.test(sha??'')||!Number.isInteger(count)||count<1||count>32||budgetMs<1||budgetMs>35*60_000)throw Error('INVALID_QUEUE_API_CONTEXT');
 const checks=['base-api-plan',...Array.from({length:count},(_,i)=>`base-api-shards (${i+1})`),'base-api-exclusive'];
 const deadline=clock()+budgetMs;
 while(clock()<deadline){
  const api=apiFactory();
  const workflow=await api('/actions/workflows/harness-acceptance.yml');
  if(!Number.isSafeInteger(workflow.id)||workflow.path!==workflowPath||workflow.state!=='active')throw Error('INVALID_API_WORKFLOW');
  const response=await api(`/actions/workflows/${workflow.id}/runs?head_sha=${sha}&event=merge_group&per_page=100`);
  if(!Array.isArray(response.workflow_runs)||response.total_count!==response.workflow_runs.length||response.total_count>100)throw Error('INVALID_API_RUN_LIST');
  const run=[...response.workflow_runs].sort((a,b)=>b.id-a.id)[0];
  if(run){
   const jobs=await api(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
   if(!Array.isArray(jobs.jobs)||jobs.total_count!==jobs.jobs.length||jobs.total_count>100)throw Error('INVALID_API_JOB_LIST');
   const options={sha,workflowId:workflow.id,since:0,workflowPath,event:'merge_group',checks,allowRunning:true};
   const verdict=integrationVerdict(run,jobs.jobs,options);
   if(verdict.state==='failure')throw Error(`QUEUE_API_REJECTED:${verdict.reason}`);
   if(verdict.state==='success'){
    const current=await api(`/actions/runs/${run.id}`);
    if(current.id!==run.id||current.run_attempt!==run.run_attempt||integrationVerdict(current,jobs.jobs,options).state!=='success')throw Error('API_ATTEMPT_CHANGED');
    return current;
   }
  }
  await sleep(Math.min(15000,Math.max(0,deadline-clock())));
 }
 throw Error('QUEUE_API_TIMEOUT');
}
export function exactArtifacts(rows,plan,run){
 return ['coverage',...plan.shards.map(i=>`shard-${i}`),'exclusive'].map(part=>{
  const matches=rows.filter(row=>row.name===`base-api-${part}-${run.id}-${run.run_attempt}`);
  if(matches.length!==1||matches[0].expired)throw Error('MISSING_OR_AMBIGUOUS_API_ARTIFACT');
  return matches[0];
 });
}
export function assertDiscovery(actual,expected){
 const normalize=value=>({...value,partitions:value.partitions?.map(rows=>[...rows].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))),exclusive:value.exclusive&&[...value.exclusive].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))});
 if(!isDeepStrictEqual(normalize(actual),normalize(expected)))throw Error('QUEUE_API_DISCOVERY_MISMATCH');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const env=process.env;
  if(env.GITHUB_EVENT_NAME!=='merge_group'||!/^refs\/heads\/gh-readonly-queue\/develop\/pr-/.test(env.GITHUB_REF??''))throw Error('QUEUE_API_CONTEXT_REQUIRED');
  const apiFactory=()=>createLookupApi({repository:env.GITHUB_REPOSITORY,token:env.GH_TOKEN});
  const plan=shardPlan(JSON.parse(readFileSync('.harness/api-test-shards.json','utf8')));
  const run=await waitForProducer({apiFactory,sha:env.GITHUB_SHA,count:plan.count});
  const directory=join(env.RUNNER_TEMP,'queue-api'),discovery=join(env.RUNNER_TEMP,'queue-api-discovery');
  mkdirSync(directory,{recursive:true});
  const pages=JSON.parse(execFileSync('gh',['api',`repos/${env.GITHUB_REPOSITORY}/actions/runs/${run.id}/artifacts`,'--paginate','--slurp'],{encoding:'utf8',timeout:120000}));
  const artifacts=exactArtifacts(pages.flatMap(page=>page.artifacts),plan,run);
  for(const row of artifacts)execFileSync('gh',['run','download',String(run.id),'--repo',env.GITHUB_REPOSITORY,'--name',row.name,'--dir',directory],{stdio:'inherit',timeout:120000});
  const producerEnv={...env,GITHUB_RUN_ID:String(run.id),GITHUB_RUN_ATTEMPT:String(run.run_attempt)};
  const logs=bundle(directory,plan,producerEnv);
  execFileSync(process.execPath,['.harness/scripts/ci-base-api.mjs','discover',discovery],{stdio:'inherit',timeout:120000});
  assertDiscovery(JSON.parse(readFileSync(join(directory,'coverage','coverage.json'))),JSON.parse(readFileSync(join(discovery,'coverage.json'))));
  // A rerun or cancellation during download must invalidate the proof.
  const after=await apiFactory()(`/actions/runs/${run.id}`);
  if(after.id!==run.id||after.run_attempt!==run.run_attempt||after.head_sha!==env.GITHUB_SHA||!['in_progress','completed'].includes(after.status)||(after.status==='completed'&&after.conclusion!=='success'))throw Error('API_PRODUCER_CHANGED');
  const latest=await apiFactory()(`/actions/workflows/${run.workflow_id}/runs?head_sha=${env.GITHUB_SHA}&event=merge_group&per_page=100`);
  if(!Array.isArray(latest.workflow_runs)||latest.total_count!==latest.workflow_runs.length||latest.total_count>100||[...latest.workflow_runs].sort((a,b)=>b.id-a.id)[0]?.id!==run.id)throw Error('API_PRODUCER_SUPERSEDED');
  writeFileSync(join(env.RUNNER_TEMP,'queue-api-tests.log'),logs);
  console.log(`Verified complete API evidence: ${env.GITHUB_SHA} producer ${run.id}/${run.run_attempt}`);
 }catch(error){console.error(error.message);process.exitCode=1;}
}
