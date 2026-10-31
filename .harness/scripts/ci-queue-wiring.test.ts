import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {describe,expect,it} from 'vitest';
import {CURRENT_POLICY} from './lib/ci-check-policy.mjs';
import {evaluateIf} from './lib/ci-job-conditions.mjs';

const files=['harness-verify','backend-gates','harness-acceptance'];
const load=()=>Object.fromEntries(files.map(name=>[name,parse(readFileSync(`.github/workflows/${name}.yml`,'utf8'))]));
const probe={id:'merge_group',eventName:'merge_group',ref:'refs/heads/gh-readonly-queue/develop/pr-1-abc',baseBranch:'develop',label:'queue'};
function defects(workflows:Record<string,any>){
 const errors:string[]=[];
 for(const required of CURRENT_POLICY.requiredChecks){
  const producers=Object.entries(workflows).filter(([,w])=>Object.hasOwn(w.jobs,required));
  if(producers.length!==1){errors.push(`${required}:producer`);continue;}
  const [file,w]=producers[0]!;
  if(!w.on.merge_group?.branches?.includes('develop')||w.on.merge_group.paths||w.on.merge_group['paths-ignore'])errors.push(`${required}:trigger`);
  const visited=new Set<string>();
  function check(name:string){
   if(visited.has(name))return;visited.add(name);
   const job=w.jobs[name];
   if(!job){errors.push(`${file}/${name}:missing`);return;}
   if(evaluateIf(job.if??'',probe)!==true)errors.push(`${file}/${name}:condition`);
   const needs=typeof job.needs==='string'?[job.needs]:job.needs??[];
   for(const dependency of needs)check(dependency);
   for(const step of job.steps??[]){
    if(step.uses?.startsWith('actions/checkout@')&&/pull_request|head_ref/.test(step.with?.ref??''))errors.push(`${file}/${name}:checkout`);
   }
  }
  check(required);
 }
 return errors;
}
describe('every required queue check has exactly one reachable candidate producer',()=>{
 it('includes each aggregate dependency and keeps the candidate checkout',()=>expect(defects(load())).toEqual([]));
 it.each(['trigger','filter','condition','dependency','checkout','duplicate'] as const)('rejects %s drift rather than letting queue checks disappear',mode=>{
  const w=load();
  if(mode==='trigger')delete w['harness-verify'].on.merge_group;
  if(mode==='filter')w['harness-verify'].on.merge_group.paths=['docs/**'];
  if(mode==='condition')w['backend-gates'].jobs['gates-runtime'].if="github.event_name == 'pull_request'";
  if(mode==='dependency')delete w['backend-gates'].jobs['api-test-plan'];
  if(mode==='checkout')w['harness-verify'].jobs['verify-full-compile'].steps[0].with={ref:'${{ github.event.pull_request.head.sha }}'};
  if(mode==='duplicate')w['backend-gates'].jobs['verify-affected']=structuredClone(w['harness-verify'].jobs['verify-affected']);
  expect(defects(w).length).toBeGreaterThan(0);
 });
});
