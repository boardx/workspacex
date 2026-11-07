import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// The trigger list is authoritative; do not keep a second workflow allowlist.
export function watchedWorkflows(text=readFileSync(new URL('../../.github/workflows/ci-fail-fast.yml',import.meta.url),'utf8')){
 const matches=[...text.matchAll(/^    workflows: (\[[^\r\n]*\])$/gm)];
 if(matches.length!==1)throw Error('INVALID_FAIL_FAST_TRIGGER');
 const names=JSON.parse(matches[0][1]);
 if(!Array.isArray(names)||!names.length||names.some(n=>typeof n!=='string'||!n.length)||new Set(names).size!==names.length)throw Error('INVALID_FAIL_FAST_TRIGGER');
 return names;
}
function identity(event,repository,allowed){
 const run=event?.workflow_run,repo=event?.repository;
 if(event?.action!=='in_progress'||!allowed.includes(run?.name)||repo?.full_name!==repository||!Number.isSafeInteger(repo?.id)||repo.id<=0||run?.repository?.id!==repo.id||run.repository.full_name!==repository
  ||!Number.isSafeInteger(run.id)||run.id<=0||!Number.isSafeInteger(run.run_attempt)||run.run_attempt<=0||!Number.isSafeInteger(run.workflow_id)||run.workflow_id<=0||!/^[a-f0-9]{40}$/.test(run.head_sha??'')
  ||!['pull_request','merge_group','push','workflow_dispatch'].includes(run.event))throw Error('INVALID_FAIL_FAST_IDENTITY');
 if(run.event==='push'&&run.head_branch!=='develop'||run.event==='merge_group'&&!run.head_branch?.startsWith('gh-readonly-queue/develop/'))throw Error('OUTSIDE_DEVELOP_VALIDATION');
 return {...run,repoId:repo.id,repository};
}
function current(run,target){
 if(run?.id!==target.id||run.workflow_id!==target.workflow_id||run.head_sha!==target.head_sha||run.name!==target.name||run.event!==target.event||run.repository?.id!==target.repoId||run.repository.full_name!==target.repository)throw Error('FAIL_FAST_TARGET_CHANGED');
 if(run.run_attempt!==target.run_attempt)return 'superseded';
 if(run.status==='completed')return 'completed';
 if(!['queued','in_progress','waiting','pending','requested'].includes(run.status))throw Error('INVALID_FAIL_FAST_RUN_STATUS');
 return 'running';
}
export async function supervise({event,repository,allowed=watchedWorkflows(),read,write,wait=ms=>new Promise(done=>setTimeout(done,ms)),now=()=>performance.now(),pollMs=30000,maxMs=175*60000}){
 const target=identity(event,repository,allowed),path=`repos/${repository}/actions/runs/${target.id}`,deadline=now()+maxMs;
 while(now()<deadline){
  const state=current(await read(path),target);
  if(state!=='running')return {status:state,runId:target.id,attempt:target.run_attempt};
  const failed=[];
  for(let page=1;;page++){
   if(now()>=deadline)throw Error('FAIL_FAST_MONITOR_TIMEOUT');
   if(page>100)throw Error('FAIL_FAST_JOB_LIMIT');
   const result=await read(`${path}/attempts/${target.run_attempt}/jobs?per_page=100&page=${page}`);
   if(!Array.isArray(result?.jobs))throw Error('INVALID_FAIL_FAST_JOBS');
   for(const job of result.jobs){
    if(job.run_id!==target.id||job.run_attempt!==undefined&&job.run_attempt!==target.run_attempt)throw Error('FAIL_FAST_JOB_IDENTITY_MISMATCH');
    // This manually requested scorecard intentionally measures failures; it is not a regression gate.
    const optionalScorecard=target.name==='harness-acceptance'&&target.event==='workflow_dispatch'&&job.name==='chat-task-workbench';
    if(!optionalScorecard&&job.status==='completed'&&['failure','timed_out','startup_failure','action_required'].includes(job.conclusion))failed.push({id:job.id,conclusion:job.conclusion});
   }
   if(result.jobs.length<100)break;
  }
  if(failed.length){
   // Revalidate just before the write; never intentionally cancel a newer rerun.
   const before=current(await read(path,{fresh:true}),target);
   if(before!=='running')return {status:before,runId:target.id,attempt:target.run_attempt};
   if(now()>=deadline)throw Error('FAIL_FAST_MONITOR_TIMEOUT');
   const response=await write(`${path}/cancel`);
   if(response.status===409){
    const raced=current(await read(path,{fresh:true}),target);
    if(raced==='running')throw Error('FAIL_FAST_CANCEL_REJECTED');
    return {status:raced,runId:target.id,attempt:target.run_attempt};
   }
   if(response.status!==202)throw Error(`FAIL_FAST_CANCEL_HTTP_${response.status}`);
   return {status:'cancel_requested',runId:target.id,attempt:target.run_attempt,failedJobs:failed};
  }
  await wait(pollMs);
 }
 throw Error('FAIL_FAST_MONITOR_TIMEOUT');
}
export function createGitHubApi({token,fetchImpl=fetch}){
 if(!token)throw Error('FAIL_FAST_TOKEN_REQUIRED');
 const cache=new Map();
 const request=async(path,method='GET',fresh=false)=>{
  const previous=cache.get(path),headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  if(method==='GET'&&!fresh&&previous)headers['If-None-Match']=previous.etag;
  if(method==='GET'&&fresh)headers['Cache-Control']='no-cache';
  const response=await fetchImpl(`https://api.github.com/${path}`,{method,headers,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(method==='POST'){cache.delete(path.replace(/\/cancel$/,''));return {status:response.status};}
  if(response.status===304){
   if(!previous||fresh)throw Error('FAIL_FAST_UNEXPECTED_304');
   return structuredClone(previous.data);
  }
  if(!response.ok)throw Error(`FAIL_FAST_READ_HTTP_${response.status}`);
  const data=await response.json(),etag=response.headers.get('etag');
  if(etag)cache.set(path,{etag,data:structuredClone(data)});else cache.delete(path);
  return data;
 };
 return {read:(path,{fresh=false}={})=>request(path,'GET',fresh),write:path=>request(path,'POST')};
}
async function main(){
 if(process.env.GITHUB_EVENT_NAME!=='workflow_run'||!process.env.GH_TOKEN)throw Error('TRUSTED_WORKFLOW_RUN_REQUIRED');
 const api=createGitHubApi({token:process.env.GH_TOKEN});
 const result=await supervise({event:JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')),repository:process.env.GITHUB_REPOSITORY,...api});
 // Success means supervision completed; it never certifies the target tests passed.
 process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
