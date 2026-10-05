import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {createOwnedLifecycleBrowser} from './board-owned-lifecycle-browser.mjs';
process.chdir(fileURLToPath(new URL('../../',import.meta.url)));
const require=createRequire(import.meta.url);const {chromium}=require('playwright-core');const ts=require('typescript');
const source=readFileSync(new URL('./board-indexeddb-quiescent-pause.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {installIndexedDbTransactionObserver,requestIndexedDbQuiescentPause}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const server=createServer((q,r)=>r.end('<html><title>diagnostic</title></html>'));
let owned,primaryFailure,failed=false;
const results=[];
try{
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
owned=await createOwnedLifecycleBrowser(chromium,{testBudgetMs:45000,teardownBudgetMs:5000});
const owner=owned.page,peer=await owned.context.newPage(),origin=`http://127.0.0.1:${server.address().port}`;await owner.addInitScript(installIndexedDbTransactionObserver,'idb-test-tracking');await owner.goto(origin);await peer.goto(origin);await owner.evaluate(()=>{globalThis.tick=setInterval(()=>{globalThis.counter=(globalThis.counter||0)+1;},20);});
await owner.evaluate(async()=>{globalThis.db=await new Promise((resolve,reject)=>{const r=indexedDB.open('diagnostic');r.onupgradeneeded=()=>r.result.createObjectStore('s');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise(r=>{const tx=db.transaction('s','readwrite');tx.objectStore('s').put('initial','k');tx.oncomplete=r;});});
await peer.evaluate(async()=>{globalThis.db=await new Promise((resolve,reject)=>{const r=indexedDB.open('diagnostic');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});});
const cdp=await owned.context.newCDPSession(owner);await cdp.send('Debugger.enable');let paused;cdp.on('Debugger.paused',()=>paused?.());
const measure=async(expression)=>{const start=Date.now();const pending=peer.evaluate(expression);let done=false;pending.then(()=>done=true,()=>done=true);await new Promise(r=>setTimeout(r,1500));const during=done;await cdp.send('Debugger.resume');const value=await pending;return {completedWhilePaused:during,totalMs:Date.now()-start,value};};
const pauseIdleOwner=async()=>{const observed=new Promise(resolve=>paused=resolve);await cdp.send('Debugger.pause');await observed;};
await pauseIdleOwner();
results.push({case:'idle-owner-paused-peer-renderer',...await measure(()=>({ok:true,time:performance.now()}))});
await pauseIdleOwner();
results.push({case:'idle-owner-paused-peer-idb-readwrite',...await measure(()=>new Promise((resolve,reject)=>{const tx=db.transaction('s','readwrite');tx.objectStore('s').put('peer','k');tx.oncomplete=()=>resolve('committed');tx.onabort=()=>reject(tx.error);} ))});
const binding='diagnosticQuiescence';await cdp.send('Runtime.addBinding',{name:binding});const bindings=[];cdp.on('Runtime.bindingCalled',event=>{if(event.name===binding)bindings.push(JSON.parse(event.payload));});
const missing=await cdp.send('Runtime.evaluate',{expression:`(${requestIndexedDbQuiescentPause.toString()})({key:'missing',binding:${JSON.stringify(binding)}})`});results.push({case:'missing-instrumentation-fail-closed',exception:missing.exceptionDetails?.exception?.description});
await owner.evaluate(()=>{globalThis.tx=db.transaction('s','readwrite');globalThis.txComplete=false;tx.addEventListener('complete',()=>{globalThis.txComplete=true;});let count=0;const keep=()=>{tx.objectStore('s').get('k').onsuccess=()=>{if(++count<3000)keep();};};keep();});
const beforeRequest=await owner.evaluate(()=>({active:globalThis['idb-test-tracking'].active,transactionComplete:globalThis.txComplete}));const pausedAt=new Promise(resolve=>paused=resolve);const requested=Date.now();await cdp.send('Runtime.evaluate',{expression:`(${requestIndexedDbQuiescentPause.toString()})({key:'idb-test-tracking',binding:${JSON.stringify(binding)}})`});await pausedAt;
const pauseDelayMs=Date.now()-requested;
results.push({case:'helper-waits-for-active-owner-transaction-then-peer-write',pauseDelayMs,beforeRequest,bindings,...await measure(()=>new Promise((resolve,reject)=>{const tx=db.transaction('s','readwrite');tx.objectStore('s').put('peer-after-quiescent-pause','k');tx.oncomplete=()=>resolve('committed');tx.onabort=()=>reject(tx.error);} ))});
assert.equal(beforeRequest.active,1);assert.equal(beforeRequest.transactionComplete,false);assert.deepEqual(bindings,[{type:'storage-quiescent',active:0}]);assert.equal(results[3].completedWhilePaused,true);assert.match(results[2].exception,/IDB_QUIESCENCE_UNAVAILABLE/);
console.log(JSON.stringify({browser:owned.browser.version(),context:'owned-default-CDP',results},null,2));
}catch(error){failed=true;primaryFailure=error;throw error;}finally{
 const cleanupErrors=[];
 try{await owned?.close();}catch(error){cleanupErrors.push(error);}
 try{if(server.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}catch(error){cleanupErrors.push(error);}
 if(cleanupErrors.length)throw new AggregateError(failed?[primaryFailure,...cleanupErrors]:cleanupErrors,'QUIESCENT_DIAGNOSTIC_CLEANUP_FAILED');
}
