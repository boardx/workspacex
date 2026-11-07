/** Stable checks validate the active route; omitted jobs are never recorded as executed. */
import {appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PARALLEL_BASE_PRODUCERS} from './ci-base-api.mjs';
import {FULL_REGRESSION_LANES,failedLanes} from './ci-full-regression.mjs';
import {bundleCurrent} from './ci-targeted-runner.mjs';
export const UI_PRODUCERS=['targeted-ui-unit','targeted-ui-browser'];
export function requireRoute(kind,needs){
 const full=kind==='base'?PARALLEL_BASE_PRODUCERS:kind==='e2e'?FULL_REGRESSION_LANES:null;
 if(!full||!needs||Object.keys(needs).sort().join()!==[...full,'doc-smoke-scope',...UI_PRODUCERS].sort().join())throw Error('INCOMPLETE_ROUTED_DEPENDENCIES');
 const scope=needs['doc-smoke-scope'];
 const {mode,plan_digest:planDigest}=scope?.outputs??{};
 if(scope?.result!=='success'||!['full','targeted-ui'].includes(mode)||!/^[a-f0-9]{64}$/.test(planDigest??''))throw Error('INVALID_ROUTING_PLAN');
 const active=mode==='full'?full:[...(kind==='base'?['base-compile','base-control-plane']:['full-regression-core']),...UI_PRODUCERS];
 const inactive=[...full,...UI_PRODUCERS].filter(name=>!active.includes(name));
 if(active.some(name=>needs[name]?.result!=='success')||inactive.some(name=>needs[name]?.result!=='skipped'))throw Error('ROUTED_PRODUCER_REJECTED');
 if(mode==='full'&&kind==='e2e'&&failedLanes(needs).length)throw Error('FULL_ACTUAL_VERDICT_REJECTED');
 return {mode,planDigest,full:Object.fromEntries(full.map(name=>[name,needs[name]]))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const kind=process.argv[2],route=requireRoute(kind,JSON.parse(process.env.CI_ROUTED_NEEDS??'null'));
 if(route.mode==='targeted-ui')console.log(JSON.stringify(bundleCurrent(resolve(process.env.RUNNER_TEMP,`routed-${kind}`))));
 else execFileSync(process.execPath,[resolve(import.meta.dirname,kind==='base'?'ci-base-api.mjs':'ci-full-regression.mjs'),...(kind==='base'?['prerequisites-parallel']:[])],{stdio:'inherit',env:{...process.env,CI_BASE_NEEDS:JSON.stringify(route.full),CI_LANE_RESULTS:JSON.stringify(route.full)}});
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`mode=${route.mode}\nplan_digest=${route.planDigest}\n`);
 if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`Verified regression route: ${route.mode}; plan ${route.planDigest}. Unselected jobs are not passed tests.\n`);
}
