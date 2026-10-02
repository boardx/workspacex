import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {chromium,firefox,webkit} from '@playwright/test';
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),repo=resolve(web,'../..');
// tsx is a declared root toolchain dependency; use its declared compiler rather than a pnpm-store path.
const rootRequire=createRequire(resolve(repo,'package.json'));
const compilerRequire=createRequire(rootRequire.resolve('tsx/package.json'));
const {build}=compilerRequire('esbuild');
const result=await build({stdin:{contents:"export * from './lib/whiteboard-outbox'; export * from './lib/whiteboard-outbox-key-envelope';",resolveDir:web,sourcefile:'outbox-browser-entry.ts'},bundle:true,write:false,format:'iife',globalName:'Outbox',platform:'browser',metafile:true});
const code=result.outputFiles[0].text,hash=value=>createHash('sha256').update(value).digest('hex');
const inputs=Object.keys(result.metafile.inputs).filter(path=>!path.endsWith('outbox-browser-entry.ts')).sort().map(path=>({path,sha256:hash(readFileSync(resolve(process.cwd(),path)))}));
const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const dirty=execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim().length>0;
const server=createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><html lang="en"><title>Outbox native browser verification</title></html>');});
await new Promise(resolveReady=>server.listen(0,'127.0.0.1',resolveReady));
const origin=`http://127.0.0.1:${server.address().port}`;
const reports=[];
try{
 for(const [browserName,engine] of [['chromium',chromium],['firefox',firefox],['webkit',webkit]]){
  const browser=await engine.launch();
  try{
   const context=await browser.newContext(),page=await context.newPage();await page.goto(origin);await page.addScriptTag({content:code});
   const baseline=await page.evaluate(async()=>{
    const box=new Outbox.IndexedDbEncryptedWhiteboardOutbox('baseline'),intent={type:'update',epoch:1,updateId:crypto.randomUUID(),gestureId:crypto.randomUUID(),update:'AAA='};
    const initial=await box.restore('source-fixture-token');await box.persist('source-fixture-token',intent);box.close();
    const fresh=new Outbox.IndexedDbEncryptedWhiteboardOutbox('baseline');const reopened=await fresh.restore('source-fixture-token');await fresh.rebind('source-fixture-token','target-fixture-token');
    const material=await fresh.keys.resolve('target-fixture-token',await fresh.generationHash('target-fixture-token'));
    let exportRejected=false,wrapRejected=false;try{await crypto.subtle.exportKey('raw',material.key);}catch{exportRejected=true;}
    const wrapper=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['wrapKey']);try{await crypto.subtle.wrapKey('raw',material.key,wrapper,{name:'AES-GCM',iv:crypto.getRandomValues(new Uint8Array(12))});}catch{wrapRejected=true;}
    window.expectedIntent=intent;fresh.close();return {initialEmpty:initial.updates.length===0,reopened:JSON.stringify(reopened.updates)===JSON.stringify([intent]),nonextractable:material.key.extractable===false,exportRejected,wrapRejected};
   });
   const expected=await page.evaluate(()=>window.expectedIntent);await page.reload();await page.addScriptTag({content:code});
   const reload=await page.evaluate(async intent=>{const box=new Outbox.IndexedDbEncryptedWhiteboardOutbox('baseline');try{return {rebound:JSON.stringify((await box.restore('target-fixture-token')).updates)===JSON.stringify([intent]),sourceRevoked:(await box.restore('source-fixture-token')).revoked};}finally{box.close();}},expected);
   const crash=await page.evaluate(async()=>{
    const first=new Outbox.IndexedDbEncryptedWhiteboardOutbox('crash'),intent={type:'update',epoch:1,updateId:crypto.randomUUID(),gestureId:crypto.randomUUID(),update:'AAA='};await first.persist('old-crash-token',intent);
    const encrypt=crypto.subtle.encrypt.bind(crypto.subtle);crypto.subtle.encrypt=async()=>{crypto.subtle.encrypt=encrypt;throw new Error('injected after prepared journal');};let rejected=false;
    try{await first.rebind('old-crash-token','new-crash-token');}catch{rejected=true;}finally{crypto.subtle.encrypt=encrypt;first.close();}
    const fresh=new Outbox.IndexedDbEncryptedWhiteboardOutbox('crash');try{return {rejected,newOnlyRecovery:JSON.stringify((await fresh.restore('new-crash-token')).updates)===JSON.stringify([intent]),oldFenced:(await fresh.restore('old-crash-token')).revoked};}finally{fresh.close();}
   });
   const tabs=await context.newPage();await tabs.goto(origin);await tabs.addScriptTag({content:code});
   const ids=await Promise.all([page,tabs].map((tab,index)=>tab.evaluate(async index=>{const box=new Outbox.IndexedDbEncryptedWhiteboardOutbox('race'),intent={type:'update',epoch:1,updateId:crypto.randomUUID(),gestureId:`race-${index}`,update:'AAA='};try{await box.persist('shared-fixture-token',intent);return intent.updateId;}finally{box.close();}},index)));
   const race=await page.evaluate(async ids=>{const box=new Outbox.IndexedDbEncryptedWhiteboardOutbox('race');try{const rows=(await box.restore('shared-fixture-token')).updates;return rows.length===2&&ids.every(id=>rows.some(row=>row.updateId===id));}finally{box.close();}},ids);
   const revoke=await page.evaluate(async()=>{const old=new Outbox.IndexedDbEncryptedWhiteboardOutbox('revoke'),intent={type:'update',epoch:1,updateId:crypto.randomUUID(),gestureId:crypto.randomUUID(),update:'AAA='};await old.persist('revocation-fixture-token',intent);await old.revoke('revocation-fixture-token');let rejected=false;try{await old.persist('revocation-fixture-token',intent);}catch{rejected=true;}const fresh=new Outbox.IndexedDbEncryptedWhiteboardOutbox('revoke');try{const retired=await fresh.restore('revocation-fixture-token');await fresh.reauthorize('revocation-fixture-token');const accepted={...intent,updateId:crypto.randomUUID()};await fresh.persist('revocation-fixture-token',accepted);await old.revoke('revocation-fixture-token');const readback=await fresh.restore('revocation-fixture-token');return {lateWriteRejected:rejected,retired:retired.revoked&&retired.updates.length===0,freshAuthorized:JSON.stringify(readback.updates)===JSON.stringify([accepted])};}finally{old.close();fresh.close();}});
   const privacy=await page.evaluate(async()=>{
    const db=await new Promise((resolveReady,reject)=>{const open=indexedDB.open('workspacex-whiteboard-outbox-v1');open.onsuccess=()=>resolveReady(open.result);open.onerror=()=>reject(open.error);});
    const read=store=>new Promise((resolveRead,reject)=>{const request=db.transaction(store).objectStore(store).getAll();request.onsuccess=()=>resolveRead(request.result);request.onerror=()=>reject(request.error);});
    try{const meta=await read('meta'),rows=await read('updates');return {rowsEncrypted:rows.every(row=>row.ciphertext instanceof ArrayBuffer&&!('update' in row)&&!('token' in row)&&!('key' in row)),noRawTokens:!JSON.stringify(meta).includes('fixture-token'),native:meta.some(item=>item instanceof CryptoKey),wrapped:meta.some(item=>item?.version===1&&item?.envelopes)};}finally{db.close();}
   });
   for(const value of [...Object.values(baseline),...Object.values(reload),...Object.values(crash),race,...Object.values(revoke),privacy.rowsEncrypted,privacy.noRawTokens])assert.equal(value,true,`${browserName} native outbox counterproof failed`);
   assert.equal(privacy.wrapped,browserName==='webkit');assert.equal(privacy.native,browserName!=='webkit');
   reports.push({browserName,baseline,reload,crash,race,revoke,privacy});await context.close();
  }finally{await browser.close();}
 }
 for(const input of inputs)assert.equal(hash(readFileSync(resolve(process.cwd(),input.path))),input.sha256,'compiled source changed during browser verification');
 console.log(JSON.stringify({kind:'whiteboard-outbox-native-browser',sourceHeadSha:sha,dirty,bundleSha256:hash(code),inputs,reports}));
}finally{await new Promise(resolveClosed=>server.close(resolveClosed));}
