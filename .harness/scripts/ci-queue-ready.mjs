/** Queue readiness on PR is not E2E acceptance; actual queue aggregate is strict. */
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {CURRENT_POLICY} from './lib/ci-check-policy.mjs';
import {createLookupApi} from './ci-lane-dedup.mjs';
import {waitForIntegration} from './ci-devapp-integration-gate.mjs';
export function requireQueueResults(results){
 const required=['e2e-full','full-regression-core'];
 if(!results||Object.keys(results).sort().join()!==required.sort().join()||required.some(k=>results[k]?.result!=='success'))throw Error('QUEUE_ACCEPTANCE_INCOMPLETE');
}
export function requireQueueProtection(rules,required=CURRENT_POLICY.requiredChecks){
 if(!Array.isArray(rules))throw Error('QUEUE_RULES_UNAVAILABLE');
 const queues=rules.filter(r=>r.type==='merge_queue');
 if(queues.length!==1||queues[0].parameters?.grouping_strategy!=='ALLGREEN'||queues[0].parameters?.merge_method!=='MERGE'||queues[0].parameters?.max_entries_to_merge!==1)throw Error('QUEUE_PROTECTION_REQUIRED');
 const checks=rules.filter(r=>r.type==='required_status_checks').flatMap(r=>r.parameters?.required_status_checks??[]).map(c=>c.context);
 if(required.some(name=>!checks.includes(name)))throw Error('QUEUE_CHECKS_REQUIRED');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  let message;
  if(process.argv.includes('--pr')){
   if(process.env.GITHUB_EVENT_NAME!=='pull_request'||process.env.GITHUB_REPOSITORY!=='boardx/workspacex')throw Error('PR_CONTEXT_REQUIRED');
   const response=await fetch('https://api.github.com/repos/boardx/workspacex/rules/branches/develop',{headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error('QUEUE_RULES_UNAVAILABLE');
   const body=await response.text();if(body.length>262144)throw Error('QUEUE_RULES_UNAVAILABLE');
   requireQueueProtection(JSON.parse(body));
   message='PR queue routing ready. Full acceptance has NOT run here; it must pass on merge_group before merge.';
  }else if(process.argv.includes('--compile')){
   if(process.env.GITHUB_EVENT_NAME!=='merge_group'||!/^refs\/heads\/gh-readonly-queue\/develop\/pr-/.test(process.env.GITHUB_REF??''))throw Error('QUEUE_CONTEXT_REQUIRED');
   const apiFactory=()=>createLookupApi({repository:process.env.GITHUB_REPOSITORY,token:process.env.GH_TOKEN});
   await waitForIntegration({apiFactory,sha:process.env.GITHUB_SHA,since:0,mode:'merge_group',onlyCompile:true});
   message='Exact candidate compilation passed on the automatic producer; no second build is executed.';
  }else{
   if(process.env.GITHUB_EVENT_NAME!=='merge_group')throw Error('QUEUE_CONTEXT_REQUIRED');
   requireQueueResults(JSON.parse(process.env.CI_QUEUE_NEEDS??'null'));
   message='Actual queue full acceptance passed.';
  }
  console.log(message);
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`${message}\n`);
 }catch(error){console.error(error.message);process.exitCode=1;}
}
