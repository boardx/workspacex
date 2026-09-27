import {execFileSync,spawnSync} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {assertBoardCiResults} from './board-ci-result.mjs';
import {validateJourneyArtifact} from './board-journey-policy.mjs';
import {validateSecurityArtifact} from './board-security-policy.mjs';
import {validateBoardObservationArtifact,validateRuntimeBinding} from './board-observation-policy.mjs';
import {validateBoardSoakArtifact} from './board-soak-policy.mjs';
import {boardPerformancePolicy,validateBoardPerformanceArtifact} from './board-performance-policy.mjs';
const root=resolve(import.meta.dirname,'../../..'),lane=process.argv[2],separator=process.argv.indexOf('--'),command=process.argv.slice(separator+1);
const counts={journeys:6,security:1,visual:3,storage:4,performance:3,'collaboration-50':1,'meeting-room':1};
if(!Object.hasOwn(counts,lane)||separator!==3||!command.length||!process.env.WORKSPACEX_ISOLATION_ID)throw Error('ISOLATED_CI_LANE_REQUIRED');
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim(),sha=git('rev-parse','HEAD');
if(git('status','--porcelain','--untracked-files=all'))throw Error('DIRTY_WORKTREE');
// This per-run key is private to the producer and verifier. It is never persisted
// or uploaded. HMAC integrity does not imply independent human approval.
const signed=['collaboration-50','meeting-room'].includes(lane),key=signed?randomBytes(48).toString('hex'):undefined;
if(key&&process.env.GITHUB_ACTIONS==='true')process.stdout.write(`::add-mask::${key}\n`);
const directory=resolve(root,'apps/web/test-results/board-ci',lane,randomUUID()),output=join(directory,'browser');mkdirSync(output,{recursive:true});
const context={runtimeMarker:randomUUID(),startedAt:new Date().toISOString(),endedAt:''};
const reportPath=join(directory,'soak-report.json'),jsonPath=join(directory,'playwright.json');
const result=spawnSync(command[0],[...command.slice(1),'--output',output,'--reporter='+join(root,'apps/web/scripts/board-ci-reporter.mjs'),'--trace=off'],{cwd:root,stdio:'inherit',env:{...process.env,BOARD_ACCEPTANCE_SHA:sha,BOARD_ACCEPTANCE_RUNTIME_MARKER:context.runtimeMarker,BOARD_ACCEPTANCE_RUNTIME_STARTED_AT:context.startedAt,BOARD_SOAK_REPORT_PATH:reportPath,PLAYWRIGHT_JSON_OUTPUT_FILE:jsonPath,...(key?{BOARD_ACCEPTANCE_LEDGER_KEY:key}:{})}});
context.endedAt=new Date().toISOString();
const summary={version:1,lane,sha,...context,status:'failed',approved:false,score:null,failures:[],pending:[]};
try{
 if(result.status!==0)throw Error('REAL_PRODUCER_FAILED');
 assertBoardCiResults(JSON.parse(readFileSync(jsonPath,'utf8')),counts[lane]);
 const paths=[];const walk=dir=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const p=join(dir,entry.name);if(entry.isDirectory())walk(p);else paths.push(p);}};walk(output);
 const read=name=>paths.filter(p=>p.endsWith(`/${name}`)).map(p=>JSON.parse(readFileSync(p,'utf8')));
 const single=name=>{const reports=read(name);if(reports.length!==1)throw Error('MISSING_OR_DUPLICATE_REPORT');return reports[0];};
 let checks=[];
 if(lane==='journeys')checks=[await validateJourneyArtifact({version:1,kind:'board-journey-bundle',reports:read('journey-result.json')},sha,context)];
 else if(lane==='security')checks=[validateSecurityArtifact(single('security-result.json'),sha,context)];
 else if(lane==='visual'){
  const report={version:1,kind:'board-visual-accessibility-bundle',reports:read('visual-accessibility.json')};
  checks=[await validateBoardObservationArtifact(report,'visual',sha,context),await validateBoardObservationArtifact(report,'accessibility',sha,context)];
 }else if(lane==='meeting-room')checks=[await validateBoardObservationArtifact(single('meeting-room-ledger.json'),lane,sha,context,key)];
 else if(lane==='collaboration-50'){
  const report=JSON.parse(readFileSync(reportPath,'utf8'));checks=[await validateBoardSoakArtifact(report,sha,key),{valid:true,failures:validateRuntimeBinding(report.runtimeIdentity,sha,context)}];
 }else if(lane==='performance')checks=[1000,5000,10000].map(size=>{const report=single(`performance-${size}.json`),check=validateBoardPerformanceArtifact(report,boardPerformancePolicy(root),sha,size);check.failures.push(...validateRuntimeBinding(report.runtimeIdentity,sha,context));if(check.budgetStatus!=='engineering-targets')check.failures.push('UNBUDGETED_SCALE');for(const ref of [report.trace,...report.loadTraces??[]]){const bytes=readFileSync(ref.path);if(createHash('sha256').update(bytes).digest('hex')!==ref.sha256||!JSON.parse(bytes.toString()).traceEvents?.length)check.failures.push('INVALID_TRACE_BYTES');}return check;});
 else summary.pending=['real-account-vendor-exports','complete-storage-lifecycle-matrix'];
 for(const check of checks){summary.failures.push(...check.failures);summary.pending.push(...check.pending??[]);if(!check.valid&&!check.failures.length)summary.failures.push('INVALID_EVIDENCE');}
 if(summary.failures.length)throw Error('EVIDENCE_VALIDATION_FAILED');
 if(git('rev-parse','HEAD')!==sha||git('status','--porcelain','--untracked-files=all'))throw Error('SOURCE_CHANGED_DURING_CI');
 summary.status='engineering-checks-passed';
}catch(error){summary.failures.push(error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'CI_LANE_FAILED');process.exitCode=1;}
finally{writeFileSync(join(directory,'result.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600});process.stdout.write(JSON.stringify(summary)+'\n');}
