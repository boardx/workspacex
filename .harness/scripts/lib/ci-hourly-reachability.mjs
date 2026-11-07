/** Static hourly registration, distinct from per-merge coverage and executed evidence. */
import {evaluateIf} from './ci-job-conditions.mjs';
const literal=value=>typeof value==='string'?`'${value.replaceAll("'","''")}'`:String(value??'null');
export function scheduledJobLabels(workflows,policy){
 const labels=new Set(),file=policy?.fullRegression?.workflowPath?.split('/').at(-1),root=workflows.get(file);
 if(policy?.version!==5||!root?.on?.schedule?.some(x=>x.cron===policy.fullRegression.cron))return labels;
 function visit(name,workflow,inputs={},stack=[]){
  if(stack.includes(name))throw Error('HOURLY_REGISTRATION_CYCLE');
  const jobs=workflow.jobs??{},states=new Map(),outputs=new Map();
  for(let pass=0;pass<Object.keys(jobs).length+1;pass++)for(const [id,job]of Object.entries(jobs)){
   if(states.has(id))continue;const needs=[job.needs??[]].flat();if(needs.some(n=>!states.has(n)))continue;
   const condition=String(job.if??'').replace(/(?:github\.event\.)?inputs\.([\w-]+)/g,(_,key)=>literal(inputs[key])).replace(/needs\.([\w-]+)\.outputs\.([\w-]+)/g,(whole,n,key)=>{
    if(n==='doc-smoke-scope'&&key==='mode')return "'full'";
    return outputs.get(n)?.[key]===undefined?whole:literal(outputs.get(n)[key]);
   });
   const active=evaluateIf(condition,{eventName:'schedule',ref:'refs/heads/develop',baseBranch:'develop',regressionMode:'full'},{needsResults:states})===true&&(needs.every(n=>states.get(n)==='success')||/\balways\s*\(/.test(condition));
   states.set(id,active?'success':'skipped');if(!active)continue;labels.add(`${name}#${id}`);
   const known={};for(const key of Object.keys(job.outputs??{}))if((job.steps??[]).some(s=>typeof s.run==='string'&&new RegExp(`echo ["']?${key}=(true|false)["']? >>`).test(s.run)))known[key]=(job.steps.find(s=>typeof s.run==='string'&&s.run.includes(`${key}=`)).run.includes(`${key}=true`)?'true':'false');outputs.set(id,known);
   if(job.uses){const child=/^\.\/\.github\/workflows\/([^/]+\.ya?ml)$/.exec(job.uses)?.[1],called=workflows.get(child);if(!called||!Object.hasOwn(called.on??{},'workflow_call'))continue;
    const defaults=Object.fromEntries(Object.entries(called.on.workflow_call?.inputs??{}).map(([key,value])=>[key,value.default]));visit(child,called,{...defaults,...job.with},[...stack,name]);
   }
  }
 }
 visit(file,root);return labels;
}
