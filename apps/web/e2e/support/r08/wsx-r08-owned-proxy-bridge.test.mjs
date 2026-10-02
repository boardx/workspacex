import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startOwnedProxy} from './wsx-r08-owned-proxy-bridge.mjs';
import {sha256} from './wsx-r08-proxy-policy.mjs';
import http from 'node:http';
import net from 'node:net';

test('owned bridge rejects mismatched board and session before network or listener creation',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wsx-r08-bridge-negative-'));
 try{
  const manifest=join(directory,'manifest.json'),configPath=join(directory,'config.json');
  await writeFile(manifest,JSON.stringify({prepared:true,ports:{api:36329}}),{mode:0o600});
  const boardId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  await writeFile(configPath,JSON.stringify({nativeManifestPath:manifest,upstream:'http://127.0.0.1:36329',controlSecret:'s'.repeat(32),bearerPrefix:'bearer.',port:36330,scope:{boardId,sessionHashes:['one','two'].map(sha256)}}),{mode:0o600});
  const valid={configPath,boardId,userId:'owner',title:'R08 closed origin negative',tokens:['one','two']};
  await assert.rejects(startOwnedProxy({...valid,boardId:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'}),/BINDING_MISMATCH/);
  await assert.rejects(startOwnedProxy({...valid,tokens:['one','foreign']}),/BINDING_MISMATCH/);
  await assert.rejects(startOwnedProxy({...valid,title:'Unrelated board'}),/INVALID_OWNED_PROXY_BINDING/);
 }finally{await rm(directory,{recursive:true});}
});

test('actual authority HTTP denies archived, absent archive state and mismatched owners before proxy listen',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wsx-r08-authority-negative-'));
 const boardId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';let scenario='archived';
 const server=http.createServer((request,response)=>{
  const identity=request.url==='/kernel/probe/whoami';
  const body=identity?{userId:scenario==='identity'?'foreign':'owner',orgId:'org'}:{id:boardId,ownerId:scenario==='owner'?'foreign':'owner',name:'R08 closed origin authority',...(scenario==='missing'?{}:{archived:scenario==='archived'})};
  response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(body));
 });
 const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
 let failure;const errors=[];
 try{
  const upstream=await listen(server),reservation=net.createServer(),port=await listen(reservation);await new Promise(resolve=>reservation.close(resolve));
  const manifest=join(directory,'manifest.json'),configPath=join(directory,'config.json');
  await writeFile(manifest,JSON.stringify({prepared:true,ports:{api:upstream}}),{mode:0o600});
  await writeFile(configPath,JSON.stringify({nativeManifestPath:manifest,upstream:`http://127.0.0.1:${upstream}`,controlSecret:'s'.repeat(32),bearerPrefix:'bearer.',port,scope:{boardId,sessionHashes:['one','two'].map(sha256)}}),{mode:0o600});
  for(scenario of ['archived','missing','owner','identity']){
   await assert.rejects(startOwnedProxy({configPath,boardId,userId:'owner',title:'R08 closed origin authority',tokens:['one','two']}),/OWNERSHIP_NOT_PROVEN/);
   const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(port,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
  }
 }catch(error){failure=error;}
 finally{if(server.listening)try{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}catch(error){errors.push(error);}try{await rm(directory,{recursive:true});}catch(error){errors.push(error);}}
 if(failure||errors.length)throw new AggregateError([...(failure?[failure]:[]),...errors],'AUTHORITY_NEGATIVE_OR_CLEANUP_FAILED');
});
