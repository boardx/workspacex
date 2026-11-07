import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {auditLightweightGraph} from './ci-lightweight-graph.mjs';
const core=()=>parse(readFileSync('.github/workflows/harness-verify.yml','utf8'));
const only=(w:any)=>new Map([['harness-verify.yml',w]]);
it('audits the actual current lightweight DAG',()=>expect(auditLightweightGraph(only(core())).mode).toBe('lightweight'));
it.each(['matrix','api','harness','browser','smoke','waiter'])('blocks an older pending PR reintroducing %s work into a candidate',kind=>{
 const w=core();const bad:any={'runs-on':'ubuntu-latest','timeout-minutes':10,steps:[{run:'echo check'}]};
 if(kind==='matrix')bad.strategy={matrix:{shard:[1,2,3,4,5,6,7,8]}};
 if(kind==='api')bad.steps=[{run:'pnpm --filter api exec vitest run --shard=1/8'}];
 if(kind==='harness')bad.steps=[{run:'pnpm exec vitest run --dir .harness'}];
 if(kind==='browser')bad.steps=[{run:'pnpm --filter web exec playwright test'}];
 if(kind==='smoke')bad.steps=[{run:'node .harness/scripts/ci-fullstack-runtime.mjs core-loop -- pnpm run verify:core-loop'}];
 if(kind==='waiter')bad.steps=[{run:'node .harness/scripts/ci-queue-ready.mjs --compile'}];
 w.jobs.older=bad;expect(()=>auditLightweightGraph(only(w))).toThrow();
});
it('inspects path-filtered PR workflows and follows reusable automatic jobs',()=>{
 const other={on:{pull_request:{branches:['develop'],paths:['apps/api/**']}},jobs:{suite:{uses:'./.github/workflows/full.yml'}}};
 const full={on:{workflow_call:{}},jobs:{tests:{steps:[{run:'pnpm --filter api exec vitest run'}]}}};
 expect(()=>auditLightweightGraph(new Map([['harness-verify.yml',core()],['other.yml',other],['full.yml',full]]))).toThrow();
});
it('rejects aggregate skip/failure escape hatches and runner-holding candidate observers',()=>{
 for(const change of [(w:any)=>w.jobs['queue-ready'].if='always()', (w:any)=>w.jobs['queue-ready'].if='success()', (w:any)=>w.jobs['verify-affected']['continue-on-error']=true,(w:any)=>w.jobs['queue-ready'].needs.pop()]){const w=core();change(w);expect(()=>auditLightweightGraph(only(w))).toThrow();}
 const monitor={on:{workflow_run:{workflows:['harness-verify'],types:['in_progress']}},jobs:{watch:{'timeout-minutes':180,steps:[{run:'node .harness/scripts/ci-fail-fast.mjs'}]}}};
 expect(()=>auditLightweightGraph(new Map([['harness-verify.yml',core()],['monitor.yml',monitor]]))).toThrow();
});
import {CURRENT_POLICY} from './lib/ci-check-policy.mjs';
it('rejects candidate policy downgrade when the exact target base already requires v5',()=>{
 const old=JSON.parse(readFileSync('.harness/scripts/fixtures/ci-check-policy-v4.json','utf8'));
 expect(()=>auditLightweightGraph(only(core()),{basePolicy:CURRENT_POLICY,candidatePolicy:old})).toThrow('POLICY_DOWNGRADE');
});
