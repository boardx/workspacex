import {test} from 'node:test';
import { SOURCE_VERIFICATION_PROFILES } from '../ci-devapp-integration-gate.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,verify} from 'node:crypto';
import {dispatchAndWait,terminal,identity,authorizeParent,requireCandidateCI,waitCandidateCI} from './devapp-exact-evidence.mjs';
import {CANDIDATE_SOURCE_VERIFICATION_PROFILES,CANDIDATE_INTEGRATION_WORKFLOWS,validateCoordination,signedDevapp,authorizeCandidate,boundedEnvelope,DEVAPP_EVIDENCE_MAX_BYTES,trustedGitHubCli} from './devapp-runtime-identity.mjs';
const source='a'.repeat(40),attempt='gha-10-2',ref='refs/heads/main-cn',requestId='12345678-1234-1234-1234-123456789abc',title=`devapp-exact:${attempt}:${requestId}`;
const run=()=>({id:12,run_attempt:1,head_sha:source,path:'.github/workflows/real-model-chat-evidence.yml',display_title:title,event:'workflow_dispatch',repository:{full_name:'boardx/workspacex'},head_repository:{full_name:'boardx/workspacex'},status:'completed',conclusion:'success',created_at:'2026-10-01T00:01:00Z'});
const parent=()=>({...run(),id:10,run_attempt:2,path:'.github/workflows/devapp-exact-source.yml',status:'in_progress',head_branch:'main-cn'});
const jobs=()=>[{name:'deploy',run_id:10,head_sha:source,status:'in_progress',started_at:'2026-10-01T00:00:00Z'}];
const raw=()=>({run:run(),coordination:{source,attempt,requestId,parentId:10,parentAttempt:2,runId:12,runAttempt:1}});
const target={source,path:run().path,title};
function ciRead(p){
 if(p.includes('/contents/.github/workflows/harness-verify.yml?ref='))return {type:'file',path:'.github/workflows/harness-verify.yml',encoding:'base64',content:Buffer.from('jobs:\n  verify-control-plane:\n  verify-affected:\n  verify-full-compile:\n').toString('base64')};
 if(p.includes('/contents/.harness/config/ci-check-policy.json?ref='))return {type:'file',path:'.harness/config/ci-check-policy.json',encoding:'base64',content:Buffer.from('{}').toString('base64')};
 const backend=p.includes('backend-gates.yml')||/\/22(?:\/|$)/.test(p),acceptance=p.includes('harness-acceptance.yml')||/\/23(?:\/|$)/.test(p),id=backend?22:acceptance?23:21,workflow=backend?'backend-gates.yml':acceptance?'harness-acceptance.yml':'harness-verify.yml';
 if(!p.includes('/workflows/')&&!/\/(21|22|23)(?:\/|$)/.test(p))return undefined;
 const r={...run(),id,head_branch:'develop',event:'push',path:'.github/workflows/'+workflow};
 if(p.includes('/runs?'))return {total_count:1,workflow_runs:[r]};
 if(p.includes('/jobs?')){const names=backend?['gates-fast','gates-test (1)','gates-test (2)','gates-runtime','e2e-core-loop','native-document-chain','native-runtime-lane']:acceptance?['verify-full-compile','full-regression-core','e2e-full']:['verify-control-plane','verify-affected'];return {total_count:names.length,jobs:names.map(name=>({name,run_id:id,head_sha:source,status:'completed',conclusion:'success'}))};}
 return r;
}
test('validates bounded exact identities and rejects mutable/unsafe inputs',()=>{assert.deepEqual(identity(source,attempt,ref),{source,attempt,ref});for(const args of [['main',attempt,ref],[source,'gha-1-1'.repeat(20),ref],[source,attempt,'refs/heads/a..b'],[source,attempt,'main-cn']])assert.throws(()=>identity(...args));});
for(const [field,value] of [['head_sha','b'.repeat(40)],['path','.github/workflows/backend-gates.yml'],['run_attempt',0],['conclusion','failure'],['event','push']])test('rejects terminal identity '+field,()=>assert.throws(()=>terminal({...run(),[field]:value},target)));
test('queue/running is not accepted as terminal',()=>assert.equal(terminal({...run(),status:'in_progress',conclusion:null},target),false));
test('dispatch reads exact ref then waits and re-reads terminal attempt',async()=>{
 const calls=[];const api=async(method,path,body)=>{calls.push([method,path,body]);if(path.startsWith('git/ref/'))return {object:{sha:source}};if(path.endsWith('/dispatches'))return {};if(path.includes('/runs?'))return {total_count:1,workflow_runs:[run()]};if(path==='actions/runs/12')return run();return {path:run().path,state:'active'};};
 assert.equal((await dispatchAndWait({api,source,attempt,ref,workflow:'real-model-chat-evidence.yml',requestId})).id,12);
 assert.equal(calls.filter(c=>c[1]==='actions/runs/12').length,2);assert.equal(calls.find(c=>c[0]==='POST')[2].inputs.expected_source_sha,source);assert.equal(calls.find(c=>c[0]==='POST')[2].ref,'main-cn');
});
for(const kind of ['stale-ref','dispatch-failed','failed-terminal','rerun','ambiguous','deadline'])test('cannot accept '+kind,async()=>{
 let reads=0,now=0;const api=async(method,path)=>{
  if(path.startsWith('git/ref/'))return {object:{sha:kind==='stale-ref'?'b'.repeat(40):source}};
  if(method==='POST'){if(kind==='dispatch-failed')throw Error('provider secret');return {};}
  if(path.includes('/runs?'))return {total_count:kind==='ambiguous'?2:1,workflow_runs:kind==='ambiguous'?[run(),run()]:[run()]};
  if(path==='actions/runs/12'){reads++;return {...run(),run_attempt:kind==='rerun'?reads:1,...(kind==='failed-terminal'?{conclusion:'failure'}:{}),...(kind==='deadline'?{status:'in_progress'}:{})};}
  return {path:run().path,state:'active'};
 };
 await assert.rejects(dispatchAndWait({api,source,attempt,ref,workflow:'real-model-chat-evidence.yml',requestId,clock:()=>now,sleep:async()=>{now+=100;},budgetMs:50}));
});
test('child requires the live same-source parent and current attempt',()=>{assert.equal(authorizeParent(parent(),jobs(),{source,parentId:10,parentAttempt:2}),true);for(const p of [{...parent(),head_sha:'b'.repeat(40)},{...parent(),run_attempt:1},{...parent(),status:'completed'}])assert.throws(()=>authorizeParent(p,jobs(),{source,parentId:10,parentAttempt:2}));});
test('signer rejects historical, rerun and mismatched parent/browser coordination',()=>{assert.equal(validateCoordination(raw(),source,attempt,parent(),jobs()),true);for(const mutate of [r=>r.coordination.attempt='gha-9-1',r=>r.coordination.parentAttempt=1,r=>r.coordination.runAttempt=2,r=>r.run.created_at='2026-09-30T00:00:00Z',r=>r.run.display_title='manual']){const r=raw();mutate(r);assert.throws(()=>validateCoordination(r,source,attempt,parent(),jobs()));}});
test('signs only after independent terminal re-read; no key request on rejected run',()=>{
 const keys=generateKeyPairSync('ed25519'),reads=[];const ports={collect:()=>raw(),read:p=>{reads.push(p);return keys.privateKey;},clock:()=>Date.parse('2026-10-01T00:05:00Z'),readApi:p=>ciRead(p)??(p.includes('/git/ref/')?{object:{sha:source}}:p.includes('/compare/')?{status:'identical'}:p.includes('/jobs?')?{total_count:1,jobs:jobs()}:p.endsWith('/10')?parent():run())};
 const out=signedDevapp(source,attempt,12,ports);assert.equal(verify(null,Buffer.from(out.payload,'base64'),keys.publicKey,Buffer.from(out.signature,'base64')),true);assert.deepEqual(reads,['/etc/workspacex-devapp/evidence-signing.pem']);
 reads.length=0;assert.throws(()=>signedDevapp(source,attempt,12,{...ports,readApi:p=>p.endsWith('/12')?{...run(),run_attempt:2}:ports.readApi(p)}));assert.deepEqual(reads,[]);
});
test('installed single-source CI gate requires harness plus backend and every matrix shard',async()=>{
 const api=async(_m,p)=>ciRead('repos/boardx/workspacex/'+p);
 assert.deepEqual(await requireCandidateCI(api,source),{'harness-verify.yml':21,'harness-acceptance.yml':23,'backend-gates.yml':22});
 for(const failure of ['harness-source','acceptance-failed','acceptance-missing-core','backend-failed','backend-shard-skipped','backend-missing-native']){
  await assert.rejects(requireCandidateCI(async(_m,p)=>{const result=ciRead('repos/boardx/workspacex/'+p);
   if(failure==='harness-source'&&p.includes('/21/')&&result.jobs)result.jobs[0].head_sha='b'.repeat(40);
   if(failure==='acceptance-failed'&&p.includes('harness-acceptance.yml'))result.workflow_runs[0].conclusion='failure';
   if(failure==='acceptance-missing-core'&&p.includes('/23/')&&result.jobs)result.jobs=result.jobs.filter(j=>j.name!=='full-regression-core');
   if(failure==='backend-failed'&&p.includes('backend-gates.yml'))result.workflow_runs[0].conclusion='failure';
   if(failure==='backend-shard-skipped'&&p.includes('/22/')&&result.jobs)result.jobs.find(j=>j.name==='gates-test (2)').conclusion='skipped';
   if(failure==='backend-missing-native'&&p.includes('/22/')&&result.jobs)result.jobs=result.jobs.filter(j=>j.name!=='native-runtime-lane');
   return result;},source));
 }
});
test('workflows keep the cloud mutex, child isolation and fixed installed root mode',()=>{
 const backend=readFileSync(new URL('../../../.github/workflows/devapp-exact-source.yml',import.meta.url),'utf8');
 assert.match(backend,/group: workspacex-devapp-deploy/);assert.match(backend,/runs-on: ubuntu-latest/);assert.match(backend,/devapp-exact-evidence.mjs coordinate/);
 const child=readFileSync(new URL('../../../.github/workflows/devapp-exact-executor.yml',import.meta.url),'utf8');assert.doesNotMatch(child,/group: workspacex-devapp-deploy/);assert.match(child,/workspacex-deploy --devapp-evidence/);assert.doesNotMatch(child,/sudo.*(?:node|checkout)/);
 const deploy=readFileSync(new URL('./deploy.sh',import.meta.url),'utf8');assert.ok(deploy.indexOf('--devapp-evidence')<deploy.indexOf('APP_DIR=${'));assert.match(deploy,/exec \/usr\/bin\/node "\$helper" sign-devapp/);
});

test('root rejects inactive parents, changed desired ref or foreign ancestry before deployment',()=>{
 const api=p=>ciRead(p)??(p.includes('/jobs?')?{total_count:1,jobs:jobs()}:p.includes('/git/ref/')?{object:{sha:source}}:p.includes('/compare/')?{status:'identical'}:parent());
 assert.equal(authorizeCandidate(source,10,2,api),true);
 for(const kind of ['inactive','desired','ancestry'])assert.throws(()=>authorizeCandidate(source,10,2,p=>kind==='inactive'&&p.endsWith('/10')?{...parent(),status:'completed'}:kind==='desired'&&p.includes('/git/ref/')?{object:{sha:'b'.repeat(40)}}:kind==='ancestry'&&p.includes('/compare/')?{status:'diverged'}:api(p)));
});
test('cancelled coordinator cancels only its identified owned child and joins terminal state',async()=>{
 let reads=0,cancelled=false;const api=async(method,p)=>{if(p.startsWith('git/ref/'))return {object:{sha:source}};if(p.endsWith('/dispatches'))return {};if(p.endsWith('/cancel')){cancelled=true;return {};}if(p.includes('/runs?'))return {total_count:1,workflow_runs:[run()]};if(p==='actions/runs/12'){reads++;return {...run(),status:cancelled?'completed':'in_progress',conclusion:cancelled?'cancelled':null};}return {path:run().path,state:'active'};};
 await assert.rejects(dispatchAndWait({api,source,attempt,ref,workflow:'real-model-chat-evidence.yml',requestId,isCancelled:()=>reads>0,sleep:async()=>{}}));assert.equal(cancelled,true);
});

test('final signed UTF8 envelope including newline has a shared exact 16MiB bound',()=>{
 const key=generateKeyPairSync('ed25519').privateKey;assert.equal(DEVAPP_EVIDENCE_MAX_BYTES,16777216);
 const base=boundedEnvelope(Buffer.alloc(0),key),overhead=Buffer.byteLength(JSON.stringify(base)+'\n');
 const size=3*Math.floor((DEVAPP_EVIDENCE_MAX_BYTES-overhead)/4);
 const value=boundedEnvelope(Buffer.alloc(size),key);assert.ok(Buffer.byteLength(JSON.stringify(value)+'\n')<=DEVAPP_EVIDENCE_MAX_BYTES);
 assert.throws(()=>boundedEnvelope(Buffer.alloc(size+3),key),/CONTROLLED_EVIDENCE_TOO_LARGE/);
});

test('root deploy admission independently rejects red backend CI even with a live parent',()=>{
 const api=p=>{const value=ciRead(p);if(value){if(p.includes('/22/')&&value.jobs)value.jobs[0].conclusion='failure';return value;}return p.includes('/jobs?')?{total_count:1,jobs:jobs()}:p.includes('/git/ref/')?{object:{sha:source}}:p.includes('/compare/')?{status:'identical'}:parent();};
 assert.throws(()=>authorizeCandidate(source,10,2,api));
});

// Real OS children and private files; GitHub/ZIP bytes remain synthetic fixtures.
for(const signal of ['SIGTERM','SIGINT','SIGHUP'])test('real signing supervisor joins and erases private evidence on '+signal,async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path'),cp=await import('node:child_process');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'devapp-sign-supervisor-')),owned=path.join(directory,'owned'),ready=path.join(directory,'ready');fs.mkdirSync(owned);
 const moduleUrl=new URL('./devapp-runtime-identity.mjs',import.meta.url).href;
 const worker=`const fs=require('fs');fs.writeFileSync(process.argv[1]+'/evidence.zip','private synthetic evidence');fs.writeFileSync(process.argv[2],String(process.pid));setInterval(()=>{},1000);`;
 const code=`import {runSigningWorker} from ${JSON.stringify(moduleUrl)};try{const bytes=await runSigningWorker({file:process.execPath,args:['-e',${JSON.stringify(worker)},${JSON.stringify(owned)},${JSON.stringify(ready)}],directory:${JSON.stringify(owned)},token:'synthetic-token'});process.stdout.write(bytes);}catch{process.exitCode=3;}`;
 const parent=cp.spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});let output='';parent.stdout.on('data',b=>output+=b);const completion=new Promise(resolve=>parent.once('close',resolve));
 try{
  const deadline=Date.now()+5000;while(!fs.existsSync(ready)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));assert.ok(fs.existsSync(ready));const childPid=Number(fs.readFileSync(ready,'utf8'));
  parent.kill(signal);assert.equal(await completion,3);assert.equal(output,'');assert.equal(fs.existsSync(owned),false);
  // A process exit/stdio close can precede the kernel's final PID removal.
  // Observe termination rather than assuming kill(pid, 0) must fail immediately.
  const reapedBy=Date.now()+1000;
  let gone=false;
  while(Date.now()<reapedBy){
   try{process.kill(childPid,0);}catch(error){if(error.code==='ESRCH'){gone=true;break;}throw error;}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.ok(gone,'signing worker must be reaped after supervisor termination');
 }finally{if(parent.exitCode===null)parent.kill('SIGKILL');fs.rmSync(directory,{recursive:true,force:true});}
});

test('root GH reader accepts only fixed root-protected binary trees and real paths',()=>{
 const regular={uid:0,mode:0o100755,isDirectory:()=>false,isSymbolicLink:()=>false,isFile:()=>true},directory={uid:0,mode:0o40755,isDirectory:()=>true,isSymbolicLink:()=>false,isFile:()=>false};
 const ports={existsSync:p=>p==='/usr/local/bin/gh',realpathSync:p=>p,lstatSync:p=>p==='/usr/local/bin/gh'?regular:directory};
 assert.equal(trustedGitHubCli(ports),'/usr/local/bin/gh');
 for(const mutation of [{...ports,lstatSync:p=>p==='/usr/local'?{...directory,uid:1001}:ports.lstatSync(p)},{...ports,lstatSync:p=>p==='/usr/local/bin/gh'?{...regular,mode:0o100777}:ports.lstatSync(p)},{...ports,existsSync:()=>false}])assert.throws(()=>trustedGitHubCli(mutation));
});

test('installed root CI rejects an omitted matrix shard even if loaded shards are green',()=>{
 const api=p=>{const value=ciRead(p);if(value){if(p.includes('/22/')&&value.jobs)value.jobs.pop();return value;}return p.includes('/jobs?')?{total_count:1,jobs:jobs()}:parent();};
 assert.throws(()=>authorizeCandidate(source,10,2,api));
});

test('a ref moving after dispatch fails immediately instead of waiting for an invisible wrong-SHA child',async()=>{
 let refs=0;const api=async(method,p)=>p.startsWith('git/ref/')?{object:{sha:++refs===1?source:'b'.repeat(40)}}:method==='POST'?{}:{path:run().path,state:'active'};
 await assert.rejects(dispatchAndWait({api,source,attempt,ref,workflow:'real-model-chat-evidence.yml',requestId}));assert.equal(refs,2);
});

function waitingCI(kind){
 let turn=0,now=0,writes=0,sleeps=0,cancelled=false,reads=0;
 const api=async(method,p)=>{
  if(method!=='GET'){writes++;throw Error('unexpected write');}
  if(p.startsWith('git/ref/')){reads++;return {object:{sha:kind==='drift'&&reads>1?'b'.repeat(40):source}};}
  const value=ciRead('repos/boardx/workspacex/'+p);
  if(kind==='api-error')throw Error('API failure');
  if(value.workflow_runs){
   if(kind==='missing'&&turn===0)return {total_count:0,workflow_runs:[]};
   if(kind==='truncated')value.total_count++;
   if(kind==='identity')value.workflow_runs[0].repository.full_name='foreign/repo';
   if((turn===0||['timeout','cancel','drift'].includes(kind))&&p.includes('harness-verify'))Object.assign(value.workflow_runs[0],{status:'in_progress',conclusion:null});
   if(kind==='failure'&&p.includes('backend-gates'))value.workflow_runs[0].conclusion='failure';
  }
  return value;
 };
 return {api,source,attempt,ref,clock:()=>now,budgetMs:60001,isCancelled:()=>cancelled,
  sleep:async ms=>{assert.ok(ms<=30000);sleeps++;now+=ms;turn++;if(kind==='cancel')cancelled=true;},
  result:()=>({writes,sleeps,now})};
}
for(const kind of ['pending','missing'])test('CI wait '+kind+' becomes green before allowing dispatch continuation',async()=>{
 const ports=waitingCI(kind);let continued=false;await waitCandidateCI(ports);continued=true;
 assert.equal(continued,true);assert.deepEqual(ports.result(),{writes:0,sleeps:1,now:30000});
});
for(const kind of ['failure','identity','truncated','api-error','timeout','cancel','drift'])test('CI wait rejects '+kind+' without dispatch or other write',async()=>{
 const ports=waitingCI(kind);let continued=false;await assert.rejects(waitCandidateCI(ports).then(()=>{continued=true;}));
 assert.equal(continued,false);assert.equal(ports.result().writes,0);
 if(['failure','identity','truncated','api-error'].includes(kind))assert.equal(ports.result().sleeps,0);
});
test('CI waiting budget cannot exceed 95 minutes',async()=>{await assert.rejects(waitCandidateCI({...waitingCI('pending'),budgetMs:95*60000+1}));});

test('CI wait validates pending identity, jobs and terminal evidence instead of swallowing generic errors',async()=>{
 for(const kind of ['bad-status','bad-conclusion','failed-job','missing-completed-job','truncated-jobs','wrong-job-source','rerun']){
  const ports=waitingCI('pending'),read=ports.api;
  ports.api=async(m,p)=>{
   const value=await read(m,p);
   if(value.workflow_runs?.length&&p.includes('harness-verify')){
    if(kind==='bad-status')value.workflow_runs[0].status='unexpected';
    if(kind==='bad-conclusion')value.workflow_runs[0].conclusion='failure';
   }
   if(value.jobs){
    if(kind==='failed-job')value.jobs[0].conclusion='failure';
    if(kind==='missing-completed-job'&&p.includes('/22/')){value.jobs.pop();value.total_count--;}
    if(kind==='truncated-jobs')value.total_count++;
    if(kind==='wrong-job-source')value.jobs[0].head_sha='b'.repeat(40);
   }
   if(kind==='rerun'&&p==='actions/runs/21')value.run_attempt++;
   return value;
  };
  await assert.rejects(waitCandidateCI(ports),kind);assert.equal(ports.result().sleeps,0,kind);assert.equal(ports.result().writes,0,kind);
 }
});
test('strict root admission continues to reject missing or pending CI without waiting',async()=>{
 for(const kind of ['pending','missing'])await assert.rejects(requireCandidateCI(waitingCI(kind).api,source));
});
for(const signal of ['SIGTERM','SIGINT','SIGHUP'])test('real '+signal+' interrupts CI wait sleep without writes or continuation',async()=>{
 const {spawn}=await import('node:child_process');
 const script=`
 import {waitCandidateCI} from ${JSON.stringify(new URL('./devapp-exact-evidence.mjs',import.meta.url).href)};
 import {setTimeout as delay} from 'node:timers/promises';
 const controller=new AbortController();
 for(const s of ['SIGTERM','SIGINT','SIGHUP'])process.on(s,()=>controller.abort());
 const api=async(method,path)=>{if(method!=='GET'){console.log('WRITE');throw Error('write');}return path.startsWith('git/ref/')?{object:{sha:${JSON.stringify(source)}}}:{total_count:0,workflow_runs:[]};};
 try{await waitCandidateCI({api,source:${JSON.stringify(source)},attempt:${JSON.stringify(attempt)},ref:${JSON.stringify(ref)},signal:controller.signal,sleep:async ms=>{console.log('READY');await delay(ms,undefined,{signal:controller.signal});}});console.log('CONTINUED');}
 catch{console.log('STOPPED');process.exitCode=1;}
 `;
 const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='',sent=false;
 const timer=setTimeout(()=>child.kill('SIGKILL'),3000);
 child.stdout.on('data',chunk=>{stdout+=chunk;if(!sent&&stdout.includes('READY')){sent=true;child.kill(signal);}});child.stderr.on('data',chunk=>{stderr+=chunk;});
 const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,s)=>resolve({code,signal:s}));});clearTimeout(timer);
 assert.deepEqual(result,{code:1,signal:null},stderr);assert.match(stdout,/STOPPED/);assert.doesNotMatch(stdout,/WRITE|CONTINUED/);
 const cli=readFileSync(new URL('./devapp-exact-evidence.mjs',import.meta.url),'utf8');assert.match(cli,/\['request','coordinate','wait-candidate-ci'\]\.includes/);assert.match(cli,/controller\.abort\(\)/);
});

for(const kind of ['pending-jobs','missing-pending-jobs'])test('CI wait handles actual '+kind+' then requires the complete successful set',async()=>{
 const ports=waitingCI('pending'),read=ports.api;let turn=0;const sleep=ports.sleep;
 ports.sleep=async ms=>{turn++;await sleep(ms);};
 ports.api=async(m,p)=>{const value=await read(m,p);if(turn===0&&p.includes('/21/')&&value.jobs){
  if(kind==='pending-jobs')Object.assign(value.jobs[0],{status:'queued',conclusion:null});
  else{value.jobs=[];value.total_count=0;}
 }return value;};
 await waitCandidateCI(ports);assert.equal(ports.result().sleeps,1);assert.equal(ports.result().writes,0);
});
test('CI green cannot continue if desired ref drifts during the final gate read',async()=>{
 const ports=waitingCI('pending'),read=ports.api;let checked=false;
 ports.api=async(m,p)=>{const value=await read(m,p);if(value.workflow_runs)for(const r of value.workflow_runs)Object.assign(r,{status:'completed',conclusion:'success'});if(p==='actions/runs/22')checked=true;if(checked&&p.startsWith('git/ref/'))value.object.sha='b'.repeat(40);return value;};
 await assert.rejects(waitCandidateCI(ports));assert.equal(ports.result().writes,0);assert.equal(ports.result().sleeps,0);
});

test('CI wait rejects malformed non-develop run identities before treating develop run as missing',async()=>{
 for(const change of [{repository:{full_name:'foreign/repo'}},{head_repository:{full_name:'foreign/repo'}},{path:'.github/workflows/foreign.yml'},{id:0},{run_attempt:0}]){
  const ports=waitingCI('pending'),read=ports.api;
  ports.api=async(m,p)=>{const value=await read(m,p);if(value.workflow_runs)for(const r of value.workflow_runs)Object.assign(r,{head_branch:'main'},change);return value;};
  await assert.rejects(waitCandidateCI(ports));assert.equal(ports.result().sleeps,0);assert.equal(ports.result().writes,0);
 }
});
test('CI wait permits legitimate non-develop history while waiting for exact develop CI',async()=>{
 const ports=waitingCI('pending'),read=ports.api;let turn=0;const sleep=ports.sleep;
 ports.sleep=async ms=>{turn++;await sleep(ms);};
 ports.api=async(m,p)=>{const value=await read(m,p);if(value.workflow_runs){
  if(turn===0)for(const r of value.workflow_runs)Object.assign(r,{head_branch:'main',status:'completed',conclusion:'failure'});
  else{value.workflow_runs.push({...value.workflow_runs[0],id:1,head_branch:'main',status:'completed',conclusion:'failure'});value.total_count++;}
 }return value;};
 await waitCandidateCI(ports);assert.equal(ports.result().sleeps,1);assert.equal(ports.result().writes,0);
});

test('candidate CI accepts only develop producer and rejects main-only or foreign evidence',async()=>{
 for(const branch of ['main','main-us','feature/foreign'])await assert.rejects(requireCandidateCI(async(_m,p)=>{const value=ciRead('repos/boardx/workspacex/'+p);if(value.workflow_runs)for(const r of value.workflow_runs)r.head_branch=branch;return value;},source));
});
test('develop CI never borrows an old green attempt when the newest run fails or reruns',async()=>{
 for(const mode of ['new-failed-run','changed-attempt'])await assert.rejects(requireCandidateCI(async(_m,p)=>{
  const value=ciRead('repos/boardx/workspacex/'+p);
  if(mode==='new-failed-run'&&value.workflow_runs){value.workflow_runs.push({...value.workflow_runs[0],id:value.workflow_runs[0].id+100,conclusion:'failure'});value.total_count++;}
  if(mode==='changed-attempt'&&p==='actions/runs/21')value.run_attempt++;
  return value;
 },source));
});


function queueCIRead(p,mutation=''){
 const result=ciRead('repos/boardx/workspacex/'+p);
 if(p.includes('contents/')){result.content=Buffer.from(JSON.stringify({sourceVerificationEvent:mutation==='bad-mode'?'pull_request':'merge_group'})).toString('base64');return result;}
 const runs=result.workflow_runs??(result.jobs?[]:[result]);
 for(const r of runs){r.event=mutation==='wrong-event'?'push':'merge_group';r.head_branch=mutation==='wrong-branch'?'gh-readonly-queue/main/pr-1-'+source:'gh-readonly-queue/develop/pr-1-'+source;if(mutation==='wrong-source')r.head_sha='b'.repeat(40);}
 if(result.jobs){
  const backend=p.includes('/22/'),acceptance=p.includes('/23/');
  const checks=CANDIDATE_SOURCE_VERIFICATION_PROFILES.merge_group[backend?2:acceptance?1:0].checks;
  const names=backend?[...checks,'gates-test (1)','gates-test (2)','native-document-chain','native-runtime-lane']:checks;
  result.jobs=names.map(name=>({name,run_id:backend?22:acceptance?23:21,head_sha:source,status:'completed',conclusion:'success'}));result.total_count=result.jobs.length;
  if(mutation==='missing')result.jobs.pop();
  if(mutation==='skipped')result.jobs[0].conclusion='skipped';
 }
 if(mutation==='truncated'&&result.workflow_runs)result.total_count++;
 if(mutation==='rerun'&&!result.workflow_runs&&!result.jobs)result.run_attempt++;
 return result;
}
test('source committed queue policy requires exact candidate evidence from all three workflows',async()=>{
 const calls=[];const result=await requireCandidateCI(async(_m,p)=>{calls.push(p);return queueCIRead(p);},source);
 assert.equal(result['harness-acceptance.yml'],23);
 assert.equal(calls[0],`contents/.harness/config/ci-check-policy.json?ref=${source}`);
 assert.ok(calls.filter(p=>p.includes('/runs?')).every(p=>p.includes('event=merge_group')));
});
for(const mutation of ['bad-mode','wrong-event','wrong-branch','wrong-source','missing','skipped','truncated','rerun'])test('queue source rejects '+mutation,async()=>{
 await assert.rejects(requireCandidateCI(async(_m,p)=>queueCIRead(p,mutation),source));
});

test('standalone installed source profiles match shared integration policy',()=>assert.deepEqual(CANDIDATE_SOURCE_VERIFICATION_PROFILES,SOURCE_VERIFICATION_PROFILES));

test('exact source workflow distinguishes pre-split push evidence',async()=>{
 const result=await requireCandidateCI(async(_m,p)=>{
  const value=ciRead('repos/boardx/workspacex/'+p);
  if(p.includes('contents/.github/workflows/'))value.content=Buffer.from('jobs:\n  verify-control-plane:\n  verify-affected:\n  verify-full-compile:\n  full-regression-core:\n  e2e-full:\n').toString('base64');
  if(p.includes('/21/')&&value.jobs){for(const name of ['verify-full-compile','full-regression-core','e2e-full'])value.jobs.push({...value.jobs[0],name});value.total_count=value.jobs.length;}
  return value;
 },source);
 assert.deepEqual(Object.keys(result),['harness-verify.yml','backend-gates.yml']);
});
for(const kind of ['unavailable','malformed','partial'])test('source workflow discovery rejects '+kind,async()=>{
 await assert.rejects(requireCandidateCI(async(_m,p)=>{
  if(p.includes('contents/.github/workflows/')){
   if(kind==='unavailable')throw Error('unavailable');
   return {type:'file',path:'.github/workflows/harness-verify.yml',encoding:'base64',content:Buffer.from(kind==='partial'?'  verify-control-plane:\n  verify-affected:\n  verify-full-compile:\n  e2e-full:\n':'bad yaml').toString('base64')};
  }
  return ciRead('repos/boardx/workspacex/'+p);
 },source));
});
