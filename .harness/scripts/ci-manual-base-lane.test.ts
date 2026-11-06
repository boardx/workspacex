import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { evaluateIf } from './lib/ci-job-conditions.mjs';
const w=parse(readFileSync('.github/workflows/harness-acceptance.yml','utf8'));
function admitted(name:string,eventName:string,inputs:Record<string,unknown>){
 const expression=(w.jobs[name].if??'').replaceAll('needs.doc-smoke-scope.outputs.mode',"'full'").replaceAll('needs.doc-smoke-scope.outputs.full', "'true'").replace(/inputs\.([a-z0-9_]+)/g,(_:string,key:string)=>typeof inputs[key]==='string'?`'${inputs[key]}'`:String(inputs[key]??false));
 return evaluateIf(expression,{id:eventName,eventName,ref:'refs/heads/develop',baseBranch:'develop',label:eventName});
}
describe('explicit manual base validation avoids unrelated runners without false full acceptance',()=>{
 it('defaults to the complete existing workflow',()=>{
  expect(w.on.workflow_dispatch.inputs.verification_lane).toMatchObject({type:'choice',default:'all',options:['all','base','chat-refresh']});
 });
 it.each([false,true])('base selection runs only the complete base job even if full flag is %s',run_e2e_full=>{
  const inputs={verification_lane:'base',run_e2e_full,run_chat_path_coverage:true,run_chat_task_workbench:true};
  const actual=Object.keys(w.jobs).filter(name=>admitted(name,'workflow_dispatch',inputs)===true);
  expect(actual).toEqual(['doc-smoke-scope','base-compile','base-api-plan','base-api-shards','base-api-exclusive','web-test-plan','web-test-shards','base-package-tests','base-control-plane','full-regression-core']);
  expect(JSON.stringify(w.jobs['base-package-tests'])).toContain("--filter='!@repo/api' --filter='!web'");
 });
 it('manual chat refresh starts exactly one observer even when other optional flags are true',()=>{
  const inputs={verification_lane:'chat-refresh',run_e2e_full:true,run_chat_path_coverage:true,run_chat_task_workbench:true};
  expect(Object.keys(w.jobs).filter(name=>admitted(name,'workflow_dispatch',inputs)===true)).toEqual(['chat-refresh-diagnostic']);
  const job=w.jobs['chat-refresh-diagnostic'];
  expect(job['runs-on']).toBe('ubuntu-latest');expect(job.needs).toBeUndefined();expect(job.environment).toBeUndefined();
  const step=job.steps.find((s:{run?:string})=>s.run?.includes('with-test-isolation.ts'));
  expect(step.run).toContain('chat-refresh-production-build.ts');
  const build=readFileSync('apps/web/e2e/support/chat-refresh-production-build.ts','utf8');
  expect(build).toContain('...playwrightArgs');expect(build).not.toContain("'--workers=2'");expect(build).not.toContain("'--grep'");expect(step.run).toContain('--workers=2');expect(step.run).toContain('--grep');expect(step.run).toContain('--max-failures=1');expect(build).toContain('600000');
  expect(step.env.WSX_CHAT_REFRESH_DIAGNOSTICS).toBe('1');expect(step.env.WSX_CHAT_REFRESH_PRODUCTION_WEB).toBe('1');
 });
 it('manual skipped jobs cannot overwrite automatic required check display names',()=>{
  const display=(name:string,event:string,lane:string,shard=1)=>String(w.jobs[name].name??name).replace(/\$\{\{([^}]+)\}\}/g,(_:string,expression:string)=>{
   const code=expression.replaceAll('github.event_name',JSON.stringify(event)).replaceAll('inputs.verification_lane',JSON.stringify(lane)).replaceAll('matrix.shard',String(shard));
   return String(Function('"use strict";return ('+code+')')());
  });
  for(const name of Object.keys(w.jobs).filter(name=>name!=='chat-refresh-diagnostic')){
   const expected=name+(['base-api-shards','web-test-shards','chat-test-shards'].includes(name)?' (1)':'');
   for(const event of ['pull_request','push','merge_group'])for(const lane of ['all','base','chat-refresh'])expect(display(name,event,lane)).toBe(expected);
   for(const lane of ['all','base'])expect(display(name,'workflow_dispatch',lane)).toBe(expected);
   expect(display(name,'workflow_dispatch','chat-refresh')).toBe('diagnostic-skipped-'+expected);
  }
 });
 it('cannot reduce automatic PR, push or merge-group coverage through a manual-only selector',()=>{
  for(const event of ['pull_request','push','merge_group'])for(const name of Object.keys(w.jobs)){
   for(const selection of ['base','chat-refresh'])expect(admitted(name,event,{verification_lane:selection,run_e2e_full:true})).toEqual(admitted(name,event,{verification_lane:'all',run_e2e_full:true}));
  }
 });
 it('complete manual verification retains all full-regression producers and aggregate',()=>{
  for(const name of ['directory-smoke','fullstack-smoke','board-smoke','full-regression-core','chat-read','self-service-profile','e2e-full'])expect(admitted(name,'workflow_dispatch',{verification_lane:'all',run_e2e_full:true})).toBe(true);
 });
});

it('standard chat shard preserves all original arguments and uses one bounded production build',()=>{const j=w.jobs['chat-test-shards'],step=j.steps.find((s:{name?:string})=>s.name==='Execute actual isolated shard');expect(step.env.WSX_CHAT_REFRESH_PRODUCTION_WEB).toBe('1');expect(step.env.WSX_CHAT_REFRESH_DIAGNOSTICS).toBeUndefined();expect(step['timeout-minutes']).toBe(50);expect(j['timeout-minutes']).toBe(60);expect(step.run).toContain('chat-refresh-production-build.ts --config playwright.chat-read.config.ts --project=chat-read --max-failures=1 --shard=${{ matrix.shard }}/${{ needs.chat-test-plan.outputs.count }} --reporter=json');expect(step.run).not.toContain('--grep');expect(step.env.WORKSPACEX_WEB_TEST_MAX_WORKERS).toBe('2');expect(j.steps.some((s:{if?:string,run?:string})=>s.if==='always()'&&s.run?.includes('chat-refresh-owned-process.cjs'))).toBe(true);});
