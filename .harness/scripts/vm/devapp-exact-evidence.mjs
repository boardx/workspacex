/** Cloud coordinator. A queued child is never acceptance; each terminal attempt is re-read. */
import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {identity,authorizeParent,candidateCIGate} from './devapp-runtime-identity.mjs';
export {identity,authorizeParent};
const repository='boardx/workspacex';
const reject=()=>{throw Error('DEVAPP_EXACT_EVIDENCE_REJECTED');};
export function terminal(run,{source,path,title}){
 if(run.head_sha!==source||run.path!==path||run.display_title!==title||run.event!=='workflow_dispatch'||run.repository?.full_name!==repository||run.head_repository?.full_name!==repository||!Number.isSafeInteger(run.id)||run.id<1||!Number.isSafeInteger(run.run_attempt)||run.run_attempt<1)reject();
 if(run.status!=='completed')return false;
 if(run.conclusion!=='success')reject();
 return true;
}
export async function dispatchAndWait({api,source,attempt,ref,workflow,inputs={},clock=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),budgetMs=45*60000,requestId=randomUUID(),isCancelled=()=>false}){
 identity(source,attempt,ref);if(!['devapp-exact-source.yml','devapp-exact-executor.yml','real-model-chat-evidence.yml'].includes(workflow)||!/^[a-f0-9-]{36}$/.test(requestId))reject();
 const path='.github/workflows/'+workflow,title=`devapp-exact:${attempt}:${requestId}`;
 const current=await api('GET',`git/ref/${ref.slice(5)}`);if(current.object?.sha!==source)reject();
 const descriptor=await api('GET','actions/workflows/'+workflow);if(descriptor.path!==path||descriptor.state!=='active')reject();
 await api('POST','actions/workflows/'+workflow+'/dispatches',{ref:ref.replace(/^refs\/(heads|tags)\//,''),inputs:{...inputs,expected_source_sha:source,evidence_attempt:attempt,evidence_request_id:requestId}});
 const deadline=clock()+budgetMs;let owned;
 try{
 while(clock()<deadline){
  if(isCancelled())reject();
  if((await api('GET',`git/ref/${ref.slice(5)}`)).object?.sha!==source)reject();
  const list=await api('GET',`actions/workflows/${workflow}/runs?event=workflow_dispatch&head_sha=${source}&per_page=100`);
  if(!Array.isArray(list.workflow_runs)||!Number.isInteger(list.total_count)||list.total_count!==(list.workflow_runs??list.jobs).length||list.total_count>100)reject();
  const matches=list.workflow_runs.filter(r=>r.display_title===title);if(matches.length>1)reject();
  if(matches.length){
   const run=await api('GET','actions/runs/'+matches[0].id);
   terminal({...run,status:'in_progress'}, {source,path,title});owned=run.id;
   if(terminal(run,{source,path,title})){
    const again=await api('GET','actions/runs/'+run.id);if(again.run_attempt!==run.run_attempt||!terminal(again,{source,path,title}))reject();
    if(clock()>=deadline||isCancelled())reject();return again;
   }
  }
  await sleep(Math.min(30000,Math.max(0,deadline-clock())));
 }
 reject();
 }catch(error){
  // Best-effort cancellation/join is additional to the independent host lock
  // and root parent revalidation; it does not claim cloud SIGKILL cleanup.
  if(owned){
   try{
    const current=await api('GET','actions/runs/'+owned);terminal({...current,status:'in_progress'},{source,path,title});
    if(current.status!=='completed')await api('POST',`actions/runs/${owned}/cancel`,{});
    const end=clock()+60000;
    while(clock()<end){const state=await api('GET','actions/runs/'+owned);if(state.status==='completed')break;await sleep(1000);}
   }catch{}
  }
  throw error;
 }
}
/** Existing backend deploy admission remains the authority. Child must belong to
 * its live exact-source parent, never a different trusted-main run. */
export function githubApi(token){
 return async(method,endpoint,body)=>{
  try{
   const args=['api','--method',method,`repos/${repository}/${endpoint}`];if(body)args.push('--input','-');
   const raw=execFileSync('/usr/bin/gh',args,{input:body?JSON.stringify(body):undefined,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:process.env.HOME,GH_TOKEN:token}});
   return raw.trim()?JSON.parse(raw):{};
  }catch{reject();}
 };
}
export async function requireCandidateCI(api,source){
 const gate=candidateCIGate(source);let step=gate.next();
 while(!step.done)step=gate.next(await api('GET',step.value.replace('repos/boardx/workspacex/','')));
 return step.value;
}
async function main(){
 const api=githubApi(process.env.GH_TOKEN);
 const source=process.argv[2]==='request'?process.env.RELEASE_SHA:process.env.GITHUB_SHA,attempt=process.env.EVIDENCE_ATTEMPT||`gha-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`,ref=process.argv[2]==='request'?(process.env.CANDIDATE_REF||'refs/heads/main-cn'):process.env.GITHUB_REF;
 identity(source,attempt,ref);
 if(process.env.GITHUB_REPOSITORY!==repository)reject();
 let cancelled=false;const cancel=()=>{cancelled=true;};
 if(['request','coordinate'].includes(process.argv[2]))for(const s of ['SIGTERM','SIGINT','SIGHUP'])process.on(s,cancel);
 if(process.argv[2]==='request'){
  const requestId=randomUUID();
  const result=await dispatchAndWait({api,source,attempt,ref,workflow:'devapp-exact-source.yml',budgetMs:85*60000,requestId,isCancelled:()=>cancelled});
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`devapp_run_id=${result.id}\ndevapp_run_attempt=${result.run_attempt}\nevidence_request_id=${requestId}\n`);return;
 }
 if(process.argv[2]==='candidate-ci'){await requireCandidateCI(api,source);return;}
 if(process.argv[2]==='authorize-child'){
  if(process.env.GITHUB_EVENT_NAME!=='workflow_dispatch'||process.env.EXPECTED_SOURCE_SHA!==source)reject();
  const id=process.env.PARENT_RUN_ID,a=process.env.PARENT_RUN_ATTEMPT;if(!/^[0-9]+$/.test(id??'')||!/^[0-9]+$/.test(a??''))reject();
  const parent=await api('GET','actions/runs/'+id),jobs=await api('GET',`actions/runs/${id}/attempts/${a}/jobs?per_page=100`);
  if(!Array.isArray(jobs.jobs)||!Number.isInteger(jobs.total_count)||jobs.total_count!==jobs.jobs.length||jobs.total_count>100)reject();authorizeParent(parent,jobs.jobs,{source,parentId:id,parentAttempt:a});return;
 }
 if(process.argv[2]!=='coordinate'||!['push','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME))reject();
 const common={api,source,attempt,ref,isCancelled:()=>cancelled};
 const inputs={parent_run_id:process.env.GITHUB_RUN_ID,parent_run_attempt:process.env.GITHUB_RUN_ATTEMPT};
 await dispatchAndWait({...common,workflow:'devapp-exact-executor.yml',inputs:{...inputs,mode:'deploy'},budgetMs:25*60000});
 const browser=await dispatchAndWait({...common,workflow:'real-model-chat-evidence.yml',inputs:{...inputs,prompt:'生成一个 pdf，总结你可以做的事情',run_timeout_ms:'900000',expect_kind:'file'}});
 const signed=await dispatchAndWait({...common,workflow:'devapp-exact-executor.yml',inputs:{...inputs,mode:'sign',browser_run_id:String(browser.id)},budgetMs:10*60000});
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`signed_run_id=${signed.id}\nbrowser_run_id=${browser.id}\n`);
 console.log(`DEVAPP_EXACT_EVIDENCE_ACCEPTED source=${source} browserRun=${browser.id} signedRun=${signed.id} attempt=${attempt}`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('DEVAPP_EXACT_EVIDENCE_NOT_READY');process.exitCode=1;});
