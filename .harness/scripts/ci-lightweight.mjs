/** Lightweight merge evidence is deliberately distinct from hourly full regression. */
import {appendFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {changedPaths} from './ci-change-scope.mjs';
const sha=value=>/^[a-f0-9]{40}$/.test(value??'')&&!/^0+$/.test(value);
export const LIGHTWEIGHT_PRODUCERS=['verify-control-plane','verify-affected','verify-full-compile','merge-gate','backend-required'];
const apiUnits=[
 {prefixes:['auth','usage','agent-runtime','agent-run','recording'],config:'vitest.usage-unit.config.ts'},
 {prefixes:['chat'],config:'vitest.chat-share-unit.config.ts'},
 {prefixes:['whiteboard'],config:'vitest.whiteboard-unit.config.ts'},
 {prefixes:['identity','org-admin'],config:'vitest.identity-display-unit.config.ts'},
 {prefixes:['project'],config:'vitest.workbench-unit.config.ts'},
];
const baseline=['packages/contracts/tests/deployment.test.ts','packages/contracts/tests/whiteboard-operation.test.ts','packages/contracts/src/research-trust.test.ts'];
function identity(sourceSha,baseSha){if(!sha(sourceSha)||!sha(baseSha)||sourceSha===baseSha)throw Error('LIGHTWEIGHT_SOURCE_IDENTITY_REQUIRED');}
export function lightweightPlan(paths,{sourceSha,baseSha,exists=existsSync}={}){
 identity(sourceSha,baseSha);
 if(!Array.isArray(paths)||!paths.length||paths.some(p=>typeof p!=='string'||!p||p.startsWith('/')||p.split('/').some(s=>!s||s==='.'||s==='..')||/[\x00-\x1f\\]/.test(p)))throw Error('LIGHTWEIGHT_DIFF_REQUIRED');
 if(baseline.some(p=>!exists(p)))throw Error('LIGHTWEIGHT_BASELINE_MISSING');
 const unitFiles=new Set(baseline),apiUnitConfigs=new Set(),deferredPaths=[];
 for(const path of [...new Set(paths)].sort()){
  for(const mapping of apiUnits)if(mapping.prefixes.some(prefix=>path.startsWith(`apps/api/src/domain/${prefix}/`))){if(!exists(`apps/api/${mapping.config}`))throw Error('LIGHTWEIGHT_API_CONFIG_MISSING');apiUnitConfigs.add(mapping.config);}
  const known=/^packages\/contracts\/(?:src|tests)\/.+\.(?:ts|tsx)$/.test(path)||/^\.harness\/scripts\/(?:ci-[\w-]+|hourly-regression-issues|lib\/(?:ci-check-policy|ci-hourly-reachability|pr-queue|pr-green|merge-queue)|vm\/cn-(?:main-source-admission|frozen-release-(?:cli|identity)))(?:\.test)?\.(?:mjs|ts)$/.test(path);
  const candidates=known?[path.replace(/\.(?:mjs|tsx?)$/,'.test.ts'),path.replace('/src/','/tests/').replace(/\.(?:mjs|tsx?)$/,'.test.ts'),...(path.endsWith('.test.ts')?[path]:[])]:[];
  const selected=[...new Set(candidates)].filter(p=>p.endsWith('.test.ts')&&!p.endsWith('.test.test.ts')&&exists(p));
  selected.forEach(p=>unitFiles.add(p));
  if(!selected.length)deferredPaths.push(path);
 }
 if(unitFiles.size>40)throw Error('LIGHTWEIGHT_UNIT_SELECTION_LIMIT');
 const body={schemaVersion:1,mode:'lightweight',sourceSha,baseSha,fullRegression:false,unitFiles:[...unitFiles].sort(),apiUnitConfigs:[...apiUnitConfigs].sort(),deferredPaths};
 return {...body,planDigest:createHash('sha256').update(JSON.stringify(body)).digest('hex')};
}
export function requireLightweightResults(needs,{sourceSha,baseSha}={}){
 identity(sourceSha,baseSha);
 if(!needs||Object.keys(needs).sort().join()!==[...LIGHTWEIGHT_PRODUCERS].sort().join()||LIGHTWEIGHT_PRODUCERS.some(name=>needs[name]?.result!=='success'))throw Error('LIGHTWEIGHT_PRODUCERS_REJECTED');
 return {mode:'lightweight',sourceSha,baseSha,fullRegression:false};
}
export function requireFrozenDevelop({event,ref,sha:sourceSha,head,repository}){
 if(!['schedule','workflow_dispatch'].includes(event)||ref!=='refs/heads/develop'||!sha(sourceSha)||head!==sourceSha||repository!=='boardx/workspacex')throw Error('FROZEN_DEVELOP_REQUIRED');
 return sourceSha;
}
function summary(value){console.log(JSON.stringify(value,null,2));if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`### Verification scope\n\n\`\`\`json\n${JSON.stringify(value,null,2)}\n\`\`\`\n\nLightweight checks do not certify full regression. Broad suites execute hourly/manual.\n`);}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const command=process.argv[2],head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  if(command==='frozen-develop'){
   const frozen=requireFrozenDevelop({event:process.env.GITHUB_EVENT_NAME,ref:process.env.GITHUB_REF,sha:process.env.GITHUB_SHA,head,repository:process.env.GITHUB_REPOSITORY});
   if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`sha=${frozen}\nfrozen_at=${new Date().toISOString()}\n`);console.log(`Frozen full-regression source: ${frozen}`);
  }else{
   if(!['pull_request','merge_group'].includes(process.env.GITHUB_EVENT_NAME)||head!==process.env.GITHUB_SHA||process.env.GITHUB_REPOSITORY!=='boardx/workspacex'||!['GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'].every(k=>/^[1-9]\d*$/.test(process.env[k]??'')))throw Error('LIGHTWEIGHT_CONTEXT_REQUIRED');
   if(process.env.GITHUB_EVENT_NAME==='merge_group'&&!/^refs\/heads\/gh-readonly-queue\/develop\/pr-\d+-[a-f0-9]{7,40}$/.test(process.env.GITHUB_REF??'')||process.env.GITHUB_EVENT_NAME==='pull_request'&&!/^refs\/pull\/\d+\/merge$/.test(process.env.GITHUB_REF??''))throw Error('LIGHTWEIGHT_REF_REQUIRED');
   const runIdentity={repository:process.env.GITHUB_REPOSITORY,runId:process.env.GITHUB_RUN_ID,runAttempt:process.env.GITHUB_RUN_ATTEMPT};
   const context={sourceSha:head,baseSha:process.env.CI_SCOPE_BASE_SHA};
   if(command==='queue'){
    const verdict=requireLightweightResults(JSON.parse(process.env.CI_QUEUE_NEEDS??'null'),context);summary({...verdict,...runIdentity});
    if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'mode=lightweight\n');
   }else if(command==='units'){
    const plan=lightweightPlan(changedPaths(),context),directory=resolve(process.env.RUNNER_TEMP??'.harness/state','lightweight');mkdirSync(directory,{recursive:true});
    writeFileSync(resolve(directory,'plan.json'),JSON.stringify({...plan,...runIdentity},null,2));summary({...plan,...runIdentity});
    const report=resolve(directory,'report.json');
    const result=spawnSync('pnpm',['exec','vitest','run',...plan.unitFiles,'--bail=1','--reporter=default','--reporter=json',`--outputFile=${report}`],{stdio:'inherit',timeout:8*60_000,env:{...process.env,GH_TOKEN:undefined,GITHUB_TOKEN:undefined}});
    if(result.error||result.status!==0)throw Error('LIGHTWEIGHT_UNIT_FAILED');
    const actual=JSON.parse(readFileSync(report,'utf8'));
    const files=actual.testResults?.map(x=>resolve(x.name)).sort();
    if(actual.success!==true||!(actual.numPassedTests>0)||JSON.stringify(files)!==JSON.stringify(plan.unitFiles.map(p=>resolve(p)).sort())||actual.testResults.some(x=>x.status!=='passed'||!x.assertionResults?.some(t=>t.status==='passed')))throw Error('LIGHTWEIGHT_UNIT_REPORT_INCOMPLETE');
    for(const config of plan.apiUnitConfigs){
     const output=resolve(directory,`${config}.json`);
     const result=spawnSync('pnpm',['--filter','@repo/api','exec','vitest','run','--config',config,'--bail=1','--reporter=default','--reporter=json',`--outputFile=${output}`],{stdio:'inherit',timeout:4*60_000,env:{...process.env,GH_TOKEN:undefined,GITHUB_TOKEN:undefined}});
     if(result.error||result.status!==0)throw Error('LIGHTWEIGHT_API_UNIT_FAILED');
     const report=JSON.parse(readFileSync(output,'utf8'));if(report.success!==true||!(report.numPassedTests>0)||!report.testResults?.length||report.testResults.some(x=>x.status!=='passed'))throw Error('LIGHTWEIGHT_API_REPORT_INCOMPLETE');
    }
   }else throw Error('UNKNOWN_LIGHTWEIGHT_COMMAND');
  }
 }catch(error){console.error(error.message);process.exitCode=1;}
}
