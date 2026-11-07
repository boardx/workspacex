/** Guard merge-time resource policy against older queued branches restoring full suites. */
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {parse} from './vendor/yaml-2.9.0/parser.mjs';
import {CURRENT_POLICY} from './lib/ci-check-policy.mjs';
import {evaluateIf} from './lib/ci-job-conditions.mjs';
const probes=['pull_request','merge_group'];
const heavy=/(?:playwright\s+(?:test|install)|ci-fullstack-runtime|verify:(?:core-loop|fullstack|prototype-audit|design-loop)|verify:harness|turbo\s+run\s+test|vitest\s+run\s+--(?:dir|shard)|run-affected-tests|ci-queue-(?:api|ready|compile)|docker\s+(?:compose|build)|self-host-upgrade-drill|probe-native-cwd)/;
const admit=(w,event)=>{
 const on=w.on;if(!on)return false;
 if(Array.isArray(on))return on.includes(event);if(typeof on==='string')return on===event;
 if(!Object.hasOwn(on,event))return false;
 const branches=on[event]?.branches;return !branches||branches.some(b=>b==='develop'||b==='**'||b==='*');
};
function possible(condition,event){return evaluateIf(condition,{eventName:event,ref:event==='merge_group'?'refs/heads/gh-readonly-queue/develop/pr-1-'+'a'.repeat(40):'refs/pull/1/merge',baseBranch:'develop'})!==false;}
export function auditLightweightGraph(workflows,{basePolicy,candidatePolicy=CURRENT_POLICY}={}){
 if(basePolicy?.version>=5&&candidatePolicy?.version<5)throw Error('LIGHTWEIGHT_POLICY_DOWNGRADE');
 if(candidatePolicy?.version!==5)throw Error('LIGHTWEIGHT_POLICY_REQUIRED');
 const core=workflows.get('harness-verify.yml');
 if(CURRENT_POLICY.version!==5||!core||!probes.every(event=>admit(core,event)))throw Error('LIGHTWEIGHT_REQUIRED_WORKFLOW_MISSING');
 const required=CURRENT_POLICY.requiredChecks;
 for(const name of required){const j=core.jobs?.[name];if(!j||j.name||j['continue-on-error']||j.steps?.some(s=>s['continue-on-error'])||!probes.every(event=>possible(j.if,event)))throw Error(`LIGHTWEIGHT_REQUIRED_JOB:${name}`);}
 const queue=core.jobs['queue-ready'];if(queue.if!=="always() && (github.event_name == 'merge_group' || !cancelled())"||JSON.stringify(queue.needs)!==JSON.stringify(CURRENT_POLICY.aggregates['queue-ready']))throw Error('LIGHTWEIGHT_FAILURE_CONVERGENCE');
 const inspected=new Set();
 function inspect(file,w,event,stack=[]){
  if(stack.includes(file))throw Error('LIGHTWEIGHT_REUSABLE_CYCLE');
  for(const [name,j]of Object.entries(w.jobs??{})){
   if(!possible(j.if,event))continue;
   const label=`${file}#${name}:${event}`;if(inspected.has(label))continue;inspected.add(label);
   if(j.strategy?.matrix)throw Error(`LIGHTWEIGHT_MATRIX_REINTRODUCED:${label}`);
   if(j.uses){const target=/^\.\/\.github\/workflows\/([^/]+\.ya?ml)$/.exec(j.uses)?.[1];if(!target||!workflows.has(target))throw Error(`LIGHTWEIGHT_UNREVIEWED_REUSABLE:${label}`);inspect(target,workflows.get(target),event,[...stack,file]);}
   for(const s of j.steps??[]){if(!possible(s.if,event))continue;const command=s.run??'';
    if(heavy.test(command)||/vitest\s+run/.test(command)&&!/(?:\S+\.(?:test|spec)\.[cm]?[jt]sx?|--config\s+vitest\.[\w-]+-unit\.config\.ts)/.test(command))throw Error(`LIGHTWEIGHT_HEAVY_COMMAND_REINTRODUCED:${label}`);
   }
  }
 }
 for(const [file,w]of workflows){
  if(w.on?.workflow_run?.types?.includes('in_progress')&&w.on.workflow_run.workflows?.some(name=>['harness-verify','backend-gates','harness-acceptance'].includes(name)))throw Error('LIGHTWEIGHT_RUNNER_HOLDING_SUPERVISOR');
  for(const event of probes)if(admit(w,event))inspect(file,w,event);
 }
 return {mode:'lightweight',inspectedJobs:inspected.size,fullRegression:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const directory=resolve('.github/workflows'),workflows=new Map(readdirSync(directory).filter(f=>/\.ya?ml$/.test(f)).map(file=>[file,parse(readFileSync(resolve(directory,file),'utf8'))]));const base=process.env.CI_SCOPE_BASE_SHA;let basePolicy;
 if(base!==undefined){if(!/^[a-f0-9]{40}$/.test(base)||/^0+$/.test(base))throw Error('LIGHTWEIGHT_BASE_POLICY_REQUIRED');basePolicy=JSON.parse(execFileSync('git',['show',`${base}:.harness/config/ci-check-policy.json`],{encoding:'utf8'}));}
 else if(process.env.GITHUB_ACTIONS==='true')throw Error('LIGHTWEIGHT_BASE_POLICY_REQUIRED');
 console.log(JSON.stringify(auditLightweightGraph(workflows,{basePolicy})));}catch(error){console.error(error.message);process.exitCode=1;}
}
