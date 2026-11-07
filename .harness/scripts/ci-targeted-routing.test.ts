import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {evaluateIf} from './lib/ci-job-conditions.mjs';
import {requireRoute,UI_PRODUCERS} from './ci-targeted-routing.mjs';
import {PARALLEL_BASE_PRODUCERS} from './ci-base-api.mjs';
import {FULL_REGRESSION_LANES} from './ci-full-regression.mjs';
function needs(kind:string,mode:string,event='pull_request'){
 const full=kind==='base'?PARALLEL_BASE_PRODUCERS:FULL_REGRESSION_LANES;
 const active=mode==='full'?full:[...(kind==='base'?['base-compile','base-control-plane']:['full-regression-core']),...UI_PRODUCERS];
 if(kind==='base'&&mode==='targeted-ui'){
  const jobs=parse(readFileSync('.github/workflows/harness-acceptance.yml','utf8')).jobs;
  const probe={eventName:event,ref:'refs/heads/develop',baseBranch:'develop',regressionMode:mode};
  for(const producer of ['base-api-plan','base-api-shards','base-api-exclusive']){
   const activation=evaluateIf(jobs[producer].if,probe,{needsResults:new Map([['doc-smoke-scope','success'],['base-api-plan','success'],['base-api-shards','success']])});
   expect([true,false]).toContain(activation);if(activation===true)active.push(producer);
  }
 }
 return {...Object.fromEntries([...full,...UI_PRODUCERS].map(name=>[name,{result:active.includes(name)?'success':'skipped',outputs:{verdict:'success'}}])),
  'doc-smoke-scope':{result:'success',outputs:{mode,plan_digest:'a'.repeat(64)}}};
}
it.each(['base','e2e'])('requires complete %s outcomes for either verified route',kind=>{
 for(const event of ['pull_request','merge_group','workflow_dispatch'])for(const mode of ['full','targeted-ui']){
  const good=needs(kind,mode,event);expect(requireRoute(kind,good,event).mode).toBe(mode);
  for(const name of Object.keys(good)){
   for(const result of ['failure','cancelled',undefined])expect(()=>requireRoute(kind,{...good,[name]:{...good[name],result}},event)).toThrow();
   if(good[name].result==='success')expect(()=>requireRoute(kind,{...good,[name]:{...good[name],result:'skipped'}},event)).toThrow();
  }
  expect(()=>requireRoute(kind,{...good,extra:{result:'success'}},event)).toThrow();
  const bad=structuredClone(good);bad['doc-smoke-scope'].outputs.mode='candidate-ui';expect(()=>requireRoute(kind,bad,event)).toThrow();
 }
});
it('retains full browser actual verdict requirements',()=>{const good=needs('e2e','full');good['fullstack-smoke'].outputs.verdict='failure';expect(()=>requireRoute('e2e',good,'pull_request')).toThrow();});
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
it('actual CLI retains full prerequisites and cannot accept UI merely from green job results',()=>{
 const directory=mkdtempSync(resolve(tmpdir(),'routed-acceptance-'));
 try{
  const run=(mode:string)=>spawnSync(process.execPath,['.harness/scripts/ci-targeted-routing.mjs','base'],{encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:'pull_request',CI_ROUTED_NEEDS:JSON.stringify(needs('base',mode)),GITHUB_OUTPUT:undefined,GITHUB_STEP_SUMMARY:undefined,GITHUB_REPOSITORY:'fixture/forbidden',GH_TOKEN:'',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'1',GITHUB_RUN_ATTEMPT:'1',RUNNER_TEMP:directory}});
  expect(run('full').status).toBe(0);
  const selected=run('targeted-ui');expect(selected.status).not.toBe(0);expect(selected.stderr).toContain('UNTRUSTED_REPOSITORY');
 }finally{rmSync(directory,{recursive:true,force:true});}
});
