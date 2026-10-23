import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runRuntimeProbe} from './cn-migration-runtime-probe.mjs';
const nonce='a'.repeat(32);
function input(){return {schemaVersion:1,nonce,orgId:`cn-probe-${nonce}`,userId:`cn-probe-user-${nonce}`,email:`cn-probe-${nonce}@example.invalid`,password:['Synthetic','Drill','Password','Only'].join('-'),baselineSourceRevision:'5'.repeat(40),sourceRevision:'6'.repeat(40),migrationPlanSha256:'7'.repeat(64),pendingSha256:'8'.repeat(64),old:{origin:'http://old-api:3200',deploymentMarker:'11111111-1111-4111-8111-111111111111',containerId:'1'.repeat(64),imageId:'sha256:'+'3'.repeat(64)},candidate:{origin:'http://api:3200',deploymentMarker:'22222222-2222-4222-8222-222222222222',containerId:'2'.repeat(64),imageId:'sha256:'+'4'.repeat(64)}};}
// Real local HTTP servers are boundary fixtures, NOT actual application images,
// authentication storage, restored databases or migration compatibility evidence.
async function fixture(fn,{fault}={}){
 const config=input(),projects=new Map(),calls=[],servers=[],origins={};
 for(const runtime of ['old','candidate']){
  const server=createServer(async(req,res)=>{
   const path=new URL(req.url,'http://fixture');let raw='';for await(const chunk of req)raw+=chunk;
   const body=raw?JSON.parse(raw):null;
   calls.push({runtime,path:path.pathname,method:req.method,body});
   const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
   if(fault?.({runtime,req,res,path,body,send,projects,config}))return;
   if(path.pathname==='/healthz')return send(200,{trustworthy:true,rlsForced:true,appRoleIsOwner:false,migrationVersion:'20261024001000-fixture',deploymentMarker:config[runtime].deploymentMarker});
   if(path.pathname==='/auth/login'){
    assert.deepEqual(body,{email:config.email,password:config.password});
    return send(200,{userId:config.userId,orgs:[config.orgId],sessionToken:`opaque-${runtime}-session-not-for-logs`,expiresAt:'2099-01-01T00:00:00.000Z'});
   }
   assert.equal(req.headers.authorization,`Bearer opaque-${runtime}-session-not-for-logs`);
   if(path.pathname==='/identity/me'){
    assert.equal(path.searchParams.get('orgId'),config.orgId);return send(200,{org:{id:config.orgId},orgRole:'lead'});
   }
   if(path.pathname==='/projects' && req.method==='POST'){
    assert.deepEqual(body,{orgId:config.orgId,name:`cn-drill-${nonce}-${runtime}`,kind:'general',blueprintVersionId:null});
    const row={id:`prj-${runtime}`,name:body.name,kind:'general',status:'active',readOnlyReason:null,tags:[]};projects.set(row.id,row);
    return send(201,{id:row.id,kind:row.kind,status:row.status});
   }
   if(path.pathname==='/projects')return send(200,[...projects.values(),{id:'not-owned',name:'CUSTOMER-CONTENT-NEVER-PRINT',kind:'general',status:'active',readOnlyReason:null,tags:[]}]);
   const match=path.pathname.match(/^\/projects\/(prj-(?:old|candidate))\/archive$/);
   if(match){const row=projects.get(match[1]);assert.ok(row);row.status='archived';row.readOnlyReason='archived';return send(201,{projectId:row.id,status:'archived'});}
   send(404,{});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);origins[runtime]=`http://127.0.0.1:${server.address().port}`;
 }
 const fetchImpl=(url,options)=>{const runtime=url.startsWith(config.old.origin+'/')?'old':'candidate';return fetch(origins[runtime]+url.slice(config[runtime].origin.length),options);};
 try{await fn({config,projects,calls,fetchImpl});}finally{for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
}
test('HTTP fixtures prove exact login, bidirectional project reads/writes and cross-runtime archive cleanup',()=>fixture(async({config,projects,calls,fetchImpl})=>{
 const result=await runRuntimeProbe(config,{fetchImpl});
 for(const key of ['oldRead','oldWrite','candidateRead','candidateWrite']){assert.equal(result[key].status,'passed');assert.match(result[key].evidenceSha256,/^[a-f0-9]{64}$/);assert.equal(result[key].evidenceSha256,createHash('sha256').update(JSON.stringify(result.httpEvidence.slice(0,result[key].evidenceLength))).digest('hex'));}
 assert.equal(result.evidenceSha256,createHash('sha256').update(JSON.stringify(result.httpEvidence)).digest('hex'));
 assert.equal(result.cleanupPassed,true);assert.equal(result.reasonCode,undefined);assert.deepEqual(result.probeProjectIds,{old:'prj-old',candidate:'prj-candidate'});
 assert.equal(projects.get('prj-old').status,'archived');assert.equal(projects.get('prj-candidate').status,'archived');
 assert.ok(calls.some(call=>call.runtime==='old'&&call.path==='/projects/prj-candidate/archive'));
 assert.ok(calls.some(call=>call.runtime==='candidate'&&call.path==='/projects/prj-old/archive'));
 assert.ok(!calls.some(call=>call.method==='DELETE'));
 const output=JSON.stringify(result);for(const secret of [config.password,config.email,'opaque-old-session','opaque-candidate-session','CUSTOMER-CONTENT-NEVER-PRINT','cn-drill-'])assert.ok(!output.includes(secret));
}));
test('wrong health marker fails before authentication or project mutation',()=>fixture(async({config,calls,fetchImpl})=>{
 const result=await runRuntimeProbe(config,{fetchImpl});assert.equal(result.oldWrite.status,'failed');assert.equal(result.cleanupPassed,false);assert.match(result.reasonCode,/HEALTH_IDENTITY/);assert.equal(calls.length,1);
},{fault:({path,send})=>{if(path.pathname==='/healthz'){send(200,{trustworthy:true,rlsForced:true,appRoleIsOwner:false,migrationVersion:'fixture',deploymentMarker:'wrong'});return true;}}}));
test('unexpected create status cannot count as successful writes',()=>fixture(async({config,fetchImpl})=>{
 const result=await runRuntimeProbe(config,{fetchImpl});assert.equal(result.oldWrite.status,'failed');assert.equal(result.candidateRead.status,'failed');assert.match(result.reasonCode,/CREATE_STATUS/);assert.deepEqual(result.probeProjectIds,{});
},{fault:({path,req,send})=>{if(path.pathname==='/projects'&&req.method==='POST'){send(200,{id:'prj-wrong-status',kind:'general',status:'active'});return true;}}}));
test('candidate must really read old saved data; partial cleanup touches only verified owned IDs',()=>fixture(async({config,calls,fetchImpl})=>{
 const result=await runRuntimeProbe(config,{fetchImpl});assert.equal(result.oldWrite.status,'passed');assert.equal(result.candidateRead.status,'failed');assert.equal(result.cleanupPassed,false);
 const archives=calls.filter(call=>call.path.endsWith('/archive'));assert.deepEqual(archives.map(call=>call.path),['/projects/prj-old/archive']);
},{fault:({runtime,path,req,send})=>{if(runtime==='candidate'&&path.pathname==='/projects'&&req.method==='GET'){send(200,[]);return true;}}}));
test('false project ownership never authorizes cleanup of another row',()=>fixture(async({config,calls,fetchImpl})=>{
 const result=await runRuntimeProbe(config,{fetchImpl});assert.match(result.reasonCode,/OWNED_PROJECT_READBACK/);assert.deepEqual(result.probeProjectIds,{});assert.ok(!calls.some(call=>call.path.endsWith('/archive')));
},{fault:({path,req,send})=>{if(path.pathname==='/projects'&&req.method==='POST'){send(201,{id:'not-owned',kind:'general',status:'active'});return true;}}}));
test('wrong authenticated organization cannot mutate projects',()=>fixture(async({config,calls,fetchImpl})=>{
 const result=await runRuntimeProbe(config,{fetchImpl});assert.match(result.reasonCode,/LOGIN_IDENTITY/);assert.ok(!calls.some(call=>call.path==='/projects'));
},{fault:({path,send,config})=>{if(path.pathname==='/auth/login'){send(200,{userId:config.userId,orgs:['other-org'],sessionToken:'opaque-session-too-wrong',expiresAt:'2099-01-01T00:00:00.000Z'});return true;}}}));
test('redirects fail without following an external target',()=>fixture(async({config,calls,fetchImpl})=>{
 const result=await runRuntimeProbe(config,{fetchImpl});assert.match(result.reasonCode,/HEALTH_TRANSPORT/);assert.equal(calls.length,1);
},{fault:({res})=>{res.writeHead(302,{Location:'https://example.invalid/never-follow'});res.end();return true;}}));
test('archive failure is not a completed compatible rehearsal even after four HTTP phases passed',()=>fixture(async({config,fetchImpl})=>{
 const result=await runRuntimeProbe(config,{fetchImpl});assert.equal(result.oldRead.status,'passed');assert.equal(result.candidateWrite.status,'passed');assert.equal(result.cleanupPassed,false);assert.match(result.reasonCode,/ARCHIVE_STATUS/);assert.ok(!JSON.stringify(result).includes('PRIVATE PROVIDER BODY'));
},{fault:({path,send})=>{if(path.pathname.endsWith('/archive')){send(500,{secret:['PRIVATE','PROVIDER','BODY'].join(' ')});return true;}}}));
test('rejects public origins, runtime aliases, and nonnonce fixture identities before any network request',async()=>{
 for(const mutate of [i=>i.old.origin='https://production.example',i=>i.candidate.origin='http://169.254.169.254',i=>i.candidate.deploymentMarker=i.old.deploymentMarker,i=>i.orgId='restored-production-org',i=>i.email='real-user@example.com']){
  const config=input();mutate(config);let calls=0;const result=await runRuntimeProbe(config,{fetchImpl:()=>{calls++;throw Error('not called');}});assert.equal(calls,0);assert.equal(result.cleanupPassed,false);assert.ok(result.reasonCode);
 }
});
test('CLI input failures exit nonzero and cannot disclose credentials or claim a receipt',()=>{
 const config=input();config.old.origin='http://public.example';
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('./cn-migration-runtime-probe.mjs',import.meta.url))],{input:JSON.stringify(config),encoding:'utf8'});
 assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).cleanupPassed,false);assert.ok(!result.stdout.includes(config.password));
 const malformed=spawnSync(process.execPath,[fileURLToPath(new URL('./cn-migration-runtime-probe.mjs',import.meta.url))],{input:'not JSON',encoding:'utf8'});assert.equal(malformed.status,1);assert.equal(malformed.stdout,'');assert.match(malformed.stderr,/INPUT_REJECTED/);
});
