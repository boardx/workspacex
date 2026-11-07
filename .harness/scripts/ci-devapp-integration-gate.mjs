/** Read-only admission of the exact develop integration run before Devapp writes. */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createLookupApi,createPollState,pollApi,pollPause,pollDelay,POLL_QUOTA } from './ci-lane-dedup.mjs';
import {CURRENT_POLICY} from './lib/ci-check-policy.mjs';

export const SOURCE_VERIFICATION_PROFILES = {
  legacy_push: [
    {workflowPath: '.github/workflows/harness-verify.yml', checks: ['verify-control-plane', 'verify-affected', 'verify-full-compile', 'full-regression-core', 'e2e-full']},
    {workflowPath: '.github/workflows/backend-gates.yml', checks: ['gates-fast', 'gates-runtime', 'e2e-core-loop']},
  ],
  push: [
    {workflowPath: '.github/workflows/harness-verify.yml', checks: ['verify-control-plane', 'verify-affected']},
    {workflowPath: '.github/workflows/harness-acceptance.yml', checks: ['verify-full-compile', 'full-regression-core', 'e2e-full']},
    {workflowPath: '.github/workflows/backend-gates.yml', checks: ['gates-fast', 'gates-runtime', 'e2e-core-loop']},
  ],
  merge_group: [
    {workflowPath: '.github/workflows/harness-verify.yml', checks: ['verify-control-plane', 'verify-affected', 'verify-full-compile']},
    {workflowPath: '.github/workflows/harness-acceptance.yml', checks: ['full-regression-core', 'e2e-full', 'queue-ready']},
    {workflowPath: '.github/workflows/backend-gates.yml', checks: ['gates-fast', 'gates-runtime', 'e2e-core-loop']},
  ],
};
export const SOURCE_VERIFICATION_EVENT = CURRENT_POLICY.sourceVerificationEvent ?? 'push';
export const INTEGRATION_WORKFLOWS = SOURCE_VERIFICATION_PROFILES[SOURCE_VERIFICATION_EVENT];
export const INTEGRATION_CHECKS = SOURCE_VERIFICATION_PROFILES.push[1].checks;
const WORKFLOW = '.github/workflows/harness-acceptance.yml';
export const sourceBranchMatches = (branch,event) => event === 'push' ? branch === 'develop' : event === 'merge_group' && /^gh-readonly-queue\/develop\/pr-[1-9]\d*-[a-f0-9]{7,40}$/.test(branch ?? '');
// Numeric tags are emitted only by the image-release producer. Resolve the original
// build attempt and require successful exact-source admission plus all five builds.
// A later deploy-only retry may authorize the same bytes; it cannot mint new bytes.
export async function resolveVerifiedTagSource(api, tag) {
  const match = /^([1-9]\d*)-([1-9]\d*)$/.exec(tag ?? '');
  if (!match || !match.slice(1).every(x=>Number.isSafeInteger(Number(x)))) throw Error('DEVAPP_TAG_SOURCE_UNVERIFIED');
  const runId=Number(match[1]), buildAttempt=Number(match[2]);
  const workflow=await api('/actions/workflows/image-release.yml');
  const current=await api(`/actions/runs/${runId}`);
  const original=await api(`/actions/runs/${runId}/attempts/${buildAttempt}`);
  const valid = run => run.id===runId && run.workflow_id===workflow.id && run.path==='.github/workflows/image-release.yml' && run.head_branch==='develop' && ['push','workflow_dispatch'].includes(run.event) && /^[a-f0-9]{40}$/.test(run.head_sha ?? '');
  if (!Number.isSafeInteger(workflow.id) || workflow.path!=='.github/workflows/image-release.yml' || workflow.state!=='active' || !valid(current) || !valid(original) || current.head_sha!==original.head_sha || original.run_attempt!==buildAttempt || !Number.isSafeInteger(current.run_attempt) || current.run_attempt<buildAttempt || current.status!=='completed' || current.conclusion!=='success') throw Error('DEVAPP_TAG_PRODUCER_UNVERIFIED');
  const response=await api(`/actions/runs/${runId}/attempts/${buildAttempt}/jobs?per_page=100`);
  if (!Array.isArray(response.jobs) || response.total_count!==response.jobs.length || response.total_count>100) throw Error('DEVAPP_TAG_JOBS_UNVERIFIED');
  for (const name of ['plan','admission','manifest','build (api)','build (web)','build (agent)','build (sandbox)','build (postgres)']) {
    const rows=response.jobs.filter(j=>j.name===name);
    if(rows.length!==1 || rows[0].run_id!==runId || rows[0].head_sha!==current.head_sha || rows[0].run_attempt!==buildAttempt || rows[0].status!=='completed' || rows[0].conclusion!=='success') throw Error('DEVAPP_TAG_JOBS_UNVERIFIED');
  }
  if (current.run_attempt!==buildAttempt) {
    const retry=await api(`/actions/runs/${runId}/attempts/${current.run_attempt}/jobs?per_page=100`);
    if (!Array.isArray(retry.jobs) || retry.total_count!==retry.jobs.length || retry.total_count>100) throw Error('DEVAPP_TAG_RETRY_UNVERIFIED');
    for (const job of retry.jobs) {
      if(job.run_id!==runId || job.run_attempt!==current.run_attempt || job.head_sha!==current.head_sha || job.status!=='completed' || !['success','skipped'].includes(job.conclusion)) throw Error('DEVAPP_TAG_RETRY_UNVERIFIED');
    }
    const deploy=retry.jobs.filter(j=>j.name==='deploy');
    if(deploy.length!==1 || deploy[0].conclusion!=='success') throw Error('DEVAPP_TAG_RETRY_UNVERIFIED');
  }
  const after=await api(`/actions/runs/${runId}`);
  if(after.run_attempt!==current.run_attempt || after.status!=='completed' || after.conclusion!=='success' || after.head_sha!==current.head_sha) throw Error('INTEGRATION_ATTEMPT_CHANGED');
  return {sha:original.head_sha,runId,attempt:current.run_attempt};
}
export function assertReleaseSource({event, ref, sha, tag, verifiedTag}) {
  if (!['push', 'workflow_dispatch'].includes(event) || ref !== 'refs/heads/develop' || !/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('DEVELOP_SOURCE_REQUIRED');
  // Existing tags need their own trusted source manifest, never today's branch green.
  if (event === 'workflow_dispatch' && tag && (!verifiedTag || !/^[a-f0-9]{40}$/.test(verifiedTag.sha ?? ''))) throw new Error('DEVAPP_TAG_SOURCE_UNVERIFIED');
}
export function integrationVerdict(run, jobs, { sha, workflowId, since, workflowPath = WORKFLOW, checks = INTEGRATION_CHECKS, event = 'push', allowRunning = false }) {
  if (!run) return { state: 'pending', reason: 'integration_run_not_created' };
  if (run.head_sha !== sha || run.event !== event || !sourceBranchMatches(run.head_branch,event) || run.workflow_id !== workflowId || run.path !== workflowPath || !Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1 || !Number.isFinite(Date.parse(run.created_at)) || Date.parse(run.created_at) < since) throw new Error('INTEGRATION_IDENTITY_MISMATCH');
  if (!Array.isArray(jobs)) throw new Error('INVALID_INTEGRATION_JOBS');
  for (const name of checks) {
    const matches = jobs.filter(job => job.name === name);
    if (matches.length > 1) throw new Error('AMBIGUOUS_INTEGRATION_CHECK');
    const job = matches[0];
    if (job && (job.run_id !== run.id || job.run_attempt !== run.run_attempt || job.head_sha !== sha)) throw new Error('INTEGRATION_JOB_IDENTITY_MISMATCH');
    if (job?.status === 'completed' && job.conclusion !== 'success') return { state: 'failure', reason: name };
    if (run.status === 'completed' && (!job || job.status !== 'completed')) return { state: 'failure', reason: `missing_${name}` };
  }
  if (allowRunning && run.status === 'in_progress' && run.conclusion === null && checks.every(name => jobs.some(j=>j.name===name && j.status==='completed' && j.conclusion==='success'))) return {state:'success',reason:'selected_source_checks_passed'};
  if (run.status === 'completed') return run.conclusion === 'success'
    ? { state: 'success', reason: 'exact_integration_passed' }
    : { state: 'failure', reason: 'integration_workflow_failed' };
  return { state: 'pending', reason: 'integration_still_running' };
}

export async function inspectIntegration(api, { sha, since, workflowPath = WORKFLOW, checks = INTEGRATION_CHECKS, event = 'push', allowRunning = false }, state) {
  const workflow = state?.workflow ?? await api(`/actions/workflows/${workflowPath.split('/').at(-1)}`);
  if (!Number.isSafeInteger(workflow.id) || workflow.path !== workflowPath || workflow.state !== 'active') throw new Error('INVALID_INTEGRATION_WORKFLOW');
  if(state)state.workflow=workflow;
  const latest=async(fresh=false)=>{
  const response = await api(`/actions/workflows/${workflow.id}/runs?head_sha=${sha}&event=${event}&per_page=100`,{fresh});
  if (!Array.isArray(response.workflow_runs) || !Number.isInteger(response.total_count) || response.total_count > 100) throw new Error('INVALID_INTEGRATION_RUN_LIST');
  const runs = response.workflow_runs.filter(run => run.event === event && sourceBranchMatches(run.head_branch,event) && run.head_sha === sha && Date.parse(run.created_at) >= since);
  if (runs.some(run => !Number.isSafeInteger(run.id))) throw new Error('INVALID_INTEGRATION_RUN_ID');
  return runs.sort((a,b)=>b.id-a.id)[0];
  };
  const run = await latest(state?.accepted===true);
  if(state){if(state.run?.id!==run?.id||state.run?.run_attempt!==run?.run_attempt){delete state.jobs;delete state.jobsAttempt;}state.run=run;}
  if (!run) return { state: 'pending', reason: 'integration_run_not_created' };
  // Attempt-scoped jobs prevent old green attempts from authorizing a failed rerun.
  const jobs = state?.jobsAttempt===run.run_attempt ? state.jobs : await api(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  if (!Array.isArray(jobs.jobs) || !Number.isInteger(jobs.total_count) || jobs.total_count > 100) throw new Error('INVALID_INTEGRATION_JOB_LIST');
  const identity = { sha, workflowId: workflow.id, since, workflowPath, checks, event, allowRunning };
  const verdict = integrationVerdict(run, jobs.jobs, identity);
  if(state&&checks.every(name=>jobs.jobs.some(j=>j.name===name&&j.status==='completed'&&j.conclusion==='success'))){state.jobs=jobs;state.jobsAttempt=run.run_attempt;}
  if(verdict.state==='pending')return verdict;
  if(state){
   const active=await api(`/actions/workflows/${workflowPath.split('/').at(-1)}`,{fresh:true});
   if(active.id!==workflow.id||active.path!==workflowPath||active.state!=='active')throw Error('INVALID_INTEGRATION_WORKFLOW');
   const newest=await latest(true);
   if(newest?.id!==run.id||newest.run_attempt!==run.run_attempt){state.run=newest;state.accepted=false;delete state.jobs;delete state.jobsAttempt;return {state:'pending',reason:'integration_producer_changed'};}
  }else if(verdict.state!=='success')return verdict;
  const current = await api(`/actions/runs/${run.id}`,{fresh:true});
  if (current.id !== run.id || current.run_attempt !== run.run_attempt) throw new Error('INTEGRATION_ATTEMPT_CHANGED');
  return integrationVerdict(current, jobs.jobs, identity);
}

export async function waitForIntegration({ apiFactory, sha, since, clock = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), budgetMs = 55 * 60_000, mode = SOURCE_VERIFICATION_EVENT, onlyCompile = false, onlyControlPlane = false }) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || !Number.isFinite(since) || budgetMs < 1 || budgetMs > 55 * 60_000) throw new Error('INVALID_INTEGRATION_ADMISSION');
  if (!Object.hasOwn(SOURCE_VERIFICATION_PROFILES,mode)) throw new Error('INVALID_SOURCE_EVENT');
  const specs = onlyCompile || onlyControlPlane ? [{workflowPath:'.github/workflows/harness-verify.yml',checks:[onlyControlPlane?'verify-control-plane':'verify-full-compile'],allowRunning:true}] : SOURCE_VERIFICATION_PROFILES[mode];
  return waitForIntegrationSpecs({apiFactory,sha,since,clock,sleep,budgetMs,event:mode==='legacy_push'?'push':mode,specs});
}
export async function waitForIntegrationSpecs({apiFactory,sha,since,clock=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),budgetMs=55*60_000,event,specs}){
 if(!/^[a-f0-9]{40}$/.test(sha??'')||!Number.isFinite(since)||budgetMs<1||budgetMs>55*60_000||!['push','merge_group'].includes(event)||!Array.isArray(specs)||!specs.length||specs.length>3||specs.some(s=>!Array.isArray(s.checks)||!s.checks.length))throw Error('INVALID_INTEGRATION_ADMISSION');
  const deadline = clock() + budgetMs,pollState=createPollState(clock),states=specs.map(()=>({}));
  pollState.deadline=deadline;
  let previous,round=0;
  while(clock()<deadline){
   try{
    const wasAccepted=states.map(s=>s.accepted===true);
    const verdicts=[];
    for(let i=0;i<specs.length;i++){
     const verdict=states[i].accepted?{state:'success'}:await inspectIntegration(pollApi(apiFactory,pollState),{sha,since,event,...specs[i]},states[i]);
     if(verdict.state==='failure')throw Error(`INTEGRATION_REJECTED:${verdict.reason}`);
     states[i].accepted=verdict.state==='success';verdicts.push(verdict);
    }
    if(verdicts.every(v=>v.state==='success')){
     for(let i=0;i<specs.length;i++)if(wasAccepted[i]){
      const verdict=await inspectIntegration(pollApi(apiFactory,pollState),{sha,since,event,...specs[i]},states[i]);
      if(verdict.state==='failure')throw Error(`INTEGRATION_REJECTED:${verdict.reason}`);
      states[i].accepted=verdict.state==='success';
     }
     if(clock()<deadline&&states.every(s=>s.accepted)){console.log(`Exact-source lookup complete: requests=${pollState.requests} charged=${pollState.charged}`);return {state:'success',reason:'exact_integration_passed'};}
    }
    const pending=verdicts.find(v=>v.state!=='success')??(states.some(s=>!s.accepted)?{reason:'integration_producer_changed'}:undefined);
    if(pending&&pending.reason!==previous){console.log(`Waiting for exact-source integration: ${pending?.reason}`);previous=pending?.reason;}
   }catch(error){
    if(error.diagnostic)console.error(JSON.stringify(error.diagnostic));
    if(!error.rateLimited){console.error(`Exact-source lookup stopped: requests=${pollState.requests} charged=${pollState.charged}`);if(error.reason==='lookup_wait_deadline_exceeded'||clock()>=deadline)throw Error('INTEGRATION_ADMISSION_TIMEOUT');throw error;}
    console.log(`Exact-source lookup backpressure: ${error.reason}; requests=${pollState.requests} charged=${pollState.charged} retry_ms=${error.retryAfterMs}`);
    await pollPause(pollState,deadline,sleep,error.retryAfterMs);continue;
   }
   if(pollState.finalProbeScheduled){
    console.log(`Exact-source lookup final probe pending; retaining deadline: requests=${pollState.requests} charged=${pollState.charged}`);
    await pollPause(pollState,deadline,sleep,deadline-clock());continue;
   }
   const remaining=deadline-clock(),pendingCount=states.filter(s=>!s.accepted).length;
   const terminalReserve=specs.length*5,nextCost=pendingCount*2;
   const available=POLL_QUOTA.responses-pollState.charged-terminalReserve;
   let delay=pollDelay(round++);
   if(Math.ceil(remaining/240000)*nextCost>available){
    const shaped=available>0?Math.ceil(remaining*nextCost/available):remaining;
    const lastProbe=Math.max(0,remaining-Math.min(60000,remaining/2));
    delay=Math.max(delay,Math.min(shaped,lastProbe));
    if(delay>=lastProbe)pollState.finalProbeScheduled=true;
    console.log(`Exact-source lookup quota pacing: pending=${pendingCount} charged=${pollState.charged} terminal_reserve=${terminalReserve} delay_ms=${delay}`);
   }
   await pollPause(pollState,deadline,sleep,delay);
  }
  console.error(`Exact-source lookup deadline: requests=${pollState.requests} charged=${pollState.charged}`);
  throw new Error('INTEGRATION_ADMISSION_TIMEOUT');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const apiFactory = ({pollState}={}) => createLookupApi({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN,pollState });
    const verifiedTag = process.env.GITHUB_EVENT_NAME==='workflow_dispatch' && process.env.CI_RELEASE_TAG ? await resolveVerifiedTagSource(apiFactory(),process.env.CI_RELEASE_TAG) : undefined;
    assertReleaseSource({event:process.env.GITHUB_EVENT_NAME,ref:process.env.GITHUB_REF,sha:process.env.GITHUB_SHA,tag:process.env.CI_RELEASE_TAG,verifiedTag});
    const own = await apiFactory()(`/actions/runs/${process.env.GITHUB_RUN_ID}`);
    if (own.head_sha !== process.env.GITHUB_SHA || own.event !== process.env.GITHUB_EVENT_NAME || own.head_branch !== 'develop' || !Number.isFinite(Date.parse(own.created_at))) throw new Error('INVALID_DEPLOYMENT_RUN');
    if (!verifiedTag) await waitForIntegration({ apiFactory, sha: process.env.GITHUB_SHA, since: SOURCE_VERIFICATION_EVENT === 'push' && process.env.GITHUB_EVENT_NAME === 'push' ? Date.parse(own.created_at) - 60_000 : 0 });
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Devapp admission: exact image source SHA ${verifiedTag?.sha ?? process.env.GITHUB_SHA}, current integration attempt passed.\n`);
    console.log('Exact-source integration admission passed');
  } catch (error) {
    // Only our fixed failure codes are logged; never provider bodies or credentials.
    const code = /^([A-Z_]+)(?::[a-z_-]+)?$/.test(error.message ?? '') ? error.message : 'INTEGRATION_ADMISSION_UNAVAILABLE';
    console.error(code); process.exitCode = 1;
  }
}
