/** Publish a truthful negative queue check before fail-fast cancels its aggregates. */
import {readFileSync} from 'node:fs';
export function criticalQueueJobs(text=readFileSync(new URL('../../.github/workflows/harness-acceptance.yml',import.meta.url),'utf8')){
 const blocks=new Map([...text.matchAll(/^  ([a-z][\w-]*):\n([\s\S]*?)(?=^  [a-z][\w-]*:|$(?![\s\S]))/gm)].map(m=>[m[1],m[2]]));
 const seen=new Set();
 function visit(name){
  if(seen.has(name))return;
  const block=blocks.get(name);if(!block)throw Error('QUEUE_REJECTION_GRAPH_INVALID');
  seen.add(name);
  const needs=[...block.matchAll(/^    needs: (.+)$/gm)];
  if(needs.length>1)throw Error('QUEUE_REJECTION_GRAPH_INVALID');
  if(needs.length){
   const value=needs[0][1];
   const deps=value.startsWith('[')?value.slice(1,-1).split(',').map(x=>x.trim()):[value.trim()];
   if(deps.some(x=>!/^[a-z][\w-]*$/.test(x)))throw Error('QUEUE_REJECTION_GRAPH_INVALID');
   deps.forEach(visit);
  }
 }
 visit('queue-ready');return seen;
}
export async function rejectQueueCandidate({target,failed,read,write,revalidate}){
 if(target.event!=='merge_group'||target.name!=='harness-acceptance')return;
 if(target.repository!=='boardx/workspacex'||!/^gh-readonly-queue\/develop\/pr-[1-9]\d*-[a-f0-9]{7,40}$/.test(target.head_branch??'')||!/^[a-f0-9]{40}$/.test(target.head_sha??''))throw Error('QUEUE_REJECTION_IDENTITY_INVALID');
 const prefix=`repos/${target.repository}`,critical=criticalQueueJobs(),proof=[];
 const workflow=await read(`${prefix}/actions/workflows/${target.workflow_id}`,{fresh:true});
 if(workflow?.id!==target.workflow_id||workflow.path!=='.github/workflows/harness-acceptance.yml'||workflow.state!=='active')throw Error('QUEUE_REJECTION_WORKFLOW_INVALID');
 for(const original of failed){
  const job=await read(`${prefix}/actions/jobs/${original.id}`,{fresh:true});
  const name=job.name?.replace(/ \([1-9]\d*\)$/,'');
  if(!critical.has(name))continue;
  if(job.id!==original.id||job.run_id!==target.id||job.run_attempt!==target.run_attempt||job.head_sha!==target.head_sha||job.status!=='completed'||!['failure','timed_out','startup_failure','action_required'].includes(job.conclusion))throw Error('QUEUE_REJECTION_JOB_CHANGED');
  proof.push(job);
 }
 if(!proof.length)throw Error('QUEUE_REJECTION_NO_CRITICAL_FAILURE');
 const external_id=`queue-reject:${target.id}:${target.run_attempt}:${target.head_sha}`;
 const existing=await read(`${prefix}/commits/${target.head_sha}/check-runs?check_name=queue-ready&filter=all&per_page=100`,{fresh:true});
 if(!Array.isArray(existing?.check_runs)||existing.total_count!==existing.check_runs.length||existing.total_count>100)throw Error('QUEUE_REJECTION_CHECKS_UNAVAILABLE');
 const prior=existing.check_runs.filter(c=>c.external_id===external_id);
 const runs=await read(`${prefix}/actions/workflows/${target.workflow_id}/runs?head_sha=${target.head_sha}&event=merge_group&per_page=100`,{fresh:true});
 if(!Array.isArray(runs?.workflow_runs)||runs.total_count!==runs.workflow_runs.length||runs.total_count>100||Math.max(...runs.workflow_runs.map(r=>r.id))!==target.id)throw Error('QUEUE_REJECTION_RUN_SUPERSEDED');
 const ref=await read(`${prefix}/git/ref/heads/${target.head_branch}`,{fresh:true});
 if(ref?.object?.sha!==target.head_sha)throw Error('QUEUE_REJECTION_REF_CHANGED');
 if(!await revalidate())throw Error('QUEUE_REJECTION_ATTEMPT_CHANGED');
 if(prior.length){
  if(prior.length!==1||prior[0].app?.slug!=='github-actions'||prior[0].name!=='queue-ready'||prior[0].head_sha!==target.head_sha||prior[0].status!=='completed'||prior[0].conclusion!=='failure')throw Error('QUEUE_REJECTION_CHECK_CONFLICT');
  return;
 }
 const response=await write(`${prefix}/check-runs`,{name:'queue-ready',head_sha:target.head_sha,external_id,status:'completed',conclusion:'failure',details_url:`https://github.com/${target.repository}/actions/runs/${target.id}/attempts/${target.run_attempt}`,output:{title:'Queue candidate failed actual acceptance',summary:proof.map(j=>`Failed ${j.name}: https://github.com/${target.repository}/actions/runs/${target.id}/job/${j.id}`).join('\n')}});
 if(response.status!==201)throw Error(`QUEUE_REJECTION_PUBLICATION_HTTP_${response.status}`);
}
