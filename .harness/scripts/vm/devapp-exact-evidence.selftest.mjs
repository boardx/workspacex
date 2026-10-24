import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,verify} from 'node:crypto';
import {dispatchAndWait,terminal,identity,authorizeParent,requireCandidateCI} from './devapp-exact-evidence.mjs';
import {validateCoordination,signedDevapp,authorizeCandidate,boundedEnvelope,DEVAPP_EVIDENCE_MAX_BYTES,trustedGitHubCli} from './devapp-runtime-identity.mjs';
const source='a'.repeat(40),attempt='gha-10-2',ref='refs/heads/main-cn',requestId='12345678-1234-1234-1234-123456789abc',title=`devapp-exact:${attempt}:${requestId}`;
const run=()=>({id:12,run_attempt:1,head_sha:source,path:'.github/workflows/real-model-chat-evidence.yml',display_title:title,event:'workflow_dispatch',repository:{full_name:'boardx/workspacex'},head_repository:{full_name:'boardx/workspacex'},status:'completed',conclusion:'success',created_at:'2026-10-01T00:01:00Z'});
const parent=()=>({...run(),id:10,run_attempt:2,path:'.github/workflows/devapp-exact-source.yml',status:'in_progress',head_branch:'main-cn'});
const jobs=()=>[{name:'deploy',run_id:10,head_sha:source,status:'in_progress',started_at:'2026-10-01T00:00:00Z'}];
const raw=()=>({run:run(),coordination:{source,attempt,requestId,parentId:10,parentAttempt:2,runId:12,runAttempt:1}});
const target={source,path:run().path,title};
function ciRead(p){
 const backend=p.includes('backend-gates.yml')||/\/22(?:\/|$)/.test(p),id=backend?22:21,workflow=backend?'backend-gates.yml':'harness-verify.yml';
 if(!p.includes('/workflows/')&&!/\/(21|22)(?:\/|$)/.test(p))return undefined;
 const r={...run(),id,head_branch:'main',event:'push',path:'.github/workflows/'+workflow};
 if(p.includes('/runs?'))return {total_count:1,workflow_runs:[r]};
 if(p.includes('/jobs?')){const names=backend?['gates-fast','gates-test (1)','gates-test (2)','gates-runtime','e2e-core-loop','native-document-chain','native-runtime-lane']:['verify-control-plane','verify-affected','verify-full-compile','full-regression-core','e2e-full'];return {total_count:names.length,jobs:names.map(name=>({name,run_id:id,head_sha:source,status:'completed',conclusion:'success'}))};}
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
 assert.deepEqual(await requireCandidateCI(api,source),{'harness-verify.yml':21,'backend-gates.yml':22});
 for(const failure of ['harness-source','backend-failed','backend-shard-skipped','backend-missing-native']){
  await assert.rejects(requireCandidateCI(async(_m,p)=>{const result=ciRead('repos/boardx/workspacex/'+p);
   if(failure==='harness-source'&&p.includes('/21/')&&result.jobs)result.jobs[0].head_sha='b'.repeat(40);
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
  parent.kill(signal);assert.equal(await completion,3);assert.equal(output,'');assert.equal(fs.existsSync(owned),false);assert.throws(()=>process.kill(childPid,0));
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
