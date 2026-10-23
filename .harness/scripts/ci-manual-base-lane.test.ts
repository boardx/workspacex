import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { evaluateIf } from './lib/ci-job-conditions.mjs';
const w=parse(readFileSync('.github/workflows/harness-verify.yml','utf8'));
function admitted(name:string,eventName:string,inputs:Record<string,unknown>){
 const expression=(w.jobs[name].if??'').replaceAll('needs.doc-smoke-scope.outputs.full', "'true'").replace(/inputs\.([a-z0-9_]+)/g,(_:string,key:string)=>typeof inputs[key]==='string'?`'${inputs[key]}'`:String(inputs[key]??false));
 return evaluateIf(expression,{id:eventName,eventName,ref:'refs/heads/develop',baseBranch:'develop',label:eventName});
}
describe('explicit manual base validation avoids unrelated runners without false full acceptance',()=>{
 it('defaults to the complete existing workflow',()=>{
  expect(w.on.workflow_dispatch.inputs.verification_lane).toMatchObject({type:'choice',default:'all',options:['all','base']});
 });
 it.each([false,true])('base selection runs only the complete base job even if full flag is %s',run_e2e_full=>{
  const inputs={verification_lane:'base',run_e2e_full,run_chat_path_coverage:true,run_chat_task_workbench:true};
  const actual=Object.keys(w.jobs).filter(name=>admitted(name,'workflow_dispatch',inputs)===true);
  expect(actual).toEqual(['full-regression-core']);
  expect(JSON.stringify(w.jobs['full-regression-core'])).toContain('TURBO_FORCE=true pnpm run verify:base');
 });
 it('cannot reduce automatic PR, push or merge-group coverage through a manual-only selector',()=>{
  for(const event of ['pull_request','push','merge_group'])for(const name of Object.keys(w.jobs)){
   expect(admitted(name,event,{verification_lane:'base',run_e2e_full:true})).toEqual(admitted(name,event,{verification_lane:'all',run_e2e_full:true}));
  }
 });
 it('complete manual verification retains all full-regression producers and aggregate',()=>{
  for(const name of ['directory-smoke','fullstack-smoke','board-smoke','full-regression-core','chat-read','self-service-profile','e2e-full'])expect(admitted(name,'workflow_dispatch',{verification_lane:'all',run_e2e_full:true})).toBe(true);
 });
});
