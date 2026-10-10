'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {initializeRetained,canonical,hash}=require('./retained_backup_helper.cjs');
const DBS=['workspacex','workspacex_agent','workspacex_memory'];
function fixture(){
 const now=Date.now()/1000,identity={sourceRevision:'9b25bfa65662b96c0826fe67506b562ea46aa6d0',baselineRevision:'ba6343199f3c834d6a198f83d0c771614292c82b',migrationPlanSha256:'a'.repeat(64),attemptId:'fixture'};
 const authorization={identity,action:'bounded-three-db-backup-read',notBefore:now-10,expiresAt:now+600,rdsInstanceId:'pgm-uf6rg214cp381l49',ecsInstanceId:'i-uf6ga92ewloganobbln6'};
 const files={},put=(path,value)=>{const raw=Buffer.from(typeof value==='string'?value:JSON.stringify(value));files[path]=raw;return {path,sha256:hash(raw)};};
 const record={schemaVersion:1,role:'wsx_release_backup_ro',functions:{fixed:'b'.repeat(64)},allowedPublicTemp:[],...authorization};
 const role=put('/etc/workspacex-cn/backup-approvals/fixture/role.json',record),pub=put('/etc/workspacex-cn/backup-approvals/fixture/public-capability.json',record);
 authorization.roleApprovalSha256=role.sha256;authorization.publicCapabilityApprovalSha256=pub.sha256;
 const table=put('/protected/fixed-queries.json',{'begin-readonly':{sql:'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',params:[]},'rollback-readonly':{sql:'ROLLBACK',params:[]},catalog:{sql:'SELECT name FROM pg_class',params:[]}});
 const transport=Object.fromEntries(DBS.map(database=>[database,{notBefore:now-10,expiresAt:now+800,configurationSha256:'c'.repeat(64),source:{configurationSha256:'c'.repeat(64),database,user:'migration_admin',providerEvidenceSha256:'d'.repeat(64)}}]));
 const providers=Object.fromEntries(DBS.map(db=>[db,'d'.repeat(64)]));
 const statements=Object.fromEntries(DBS.map(db=>[db,{begin:['BEGIN'],commit:['COMMIT'],rollback:['ROLLBACK'],create:['CREATE ROLE wsx_release_backup_ro NOLOGIN'],grant:['GRANT SELECT ON TABLE public.t TO wsx_release_backup_ro'],close:['ALTER ROLE wsx_release_backup_ro NOLOGIN'],revoke:['REVOKE SELECT ON TABLE public.t FROM wsx_release_backup_ro']}]));
 const host={identity,backup:{identity,authorization,toolRevision:'e'.repeat(40),functionBodies:record.functions,timeoutSeconds:900,configurationSha256:'c'.repeat(64),providerBindingSha256:hash(Buffer.from(JSON.stringify(canonical(providers))))},roleApproval:role,publicCapabilityApproval:pub,queryTable:table,statements,connection:{serviceFile:'/protected/service.json',transport}};
 const ref=put('/etc/workspacex-cn/maintenance-backup/'+identity.sourceRevision+'/fixture/host-plan.json',host);
 put('/protected/service.json',{credential:{user:'migration_admin',port:5432,host:'pgm-uf6rg214cp381l49.rwlb.rds.aliyuncs.com',password:'fixture-only'}}); // Synthetic test fixture.
 const library=put('/usr/local/lib/workspacex-cn/backup_connection.cjs','pinned-library-bytes');
 const profile={toolRevision:host.backup.toolRevision,backupHostPlan:ref,installedFilesSha256:{[table.path]:table.sha256,[library.path]:library.sha256}};
 const binding={role:'migration_admin',peer:{database:'workspacex',serverAddr:'192.168.100.44',serverPort:5432},socket:{remoteAddress:'192.168.100.44',remotePort:5432,localAddress:'192.168.100.40',encrypted:false,authorized:false},pid:123,backendStart:'start'};
 const calls=[];const control={mode:'control',binding,capabilities:{alterRoleAuthority:true,catalogLockAuthority:true},identity:async()=>binding,transportLibrary:{verifyExistingMaintenanceTransport:()=>true},client:{query:async(sql,params)=>{calls.push({sql,params});return {rows:sql.startsWith('SELECT')?[{name:'t'}]:[],fields:sql.startsWith('SELECT')?[{name:'name'}]:[]};},connect:()=>{throw Error('new connect forbidden');}}};
 const options={readJson:path=>path==='/etc/workspacex-cn/trusted-tool-binding.json'?profile:JSON.parse(files[path]),readBytes:path=>files[path]};
 return {control,ref,options,calls,profile,files,host};
}
test('retained helper validates protected admission without new Client and returns readonly rows',async()=>{
 const f=fixture(),h=await initializeRetained(f.control,f.ref,f.options);assert.equal(f.calls.length,0);
 await h.dispatch(h.protocol,{operation:'query',queryId:'begin-readonly'});
 const out=await h.dispatch(h.protocol,{operation:'query',queryId:'catalog'});assert.deepEqual(out.rows,[{name:'t'}]);
 await h.dispatch(h.protocol,{operation:'query',queryId:'rollback-readonly'});assert.equal(f.calls.at(-1).sql,'ROLLBACK');
});
test('request cannot inject arbitrary SQL or tables',async()=>{
 for(const request of [{operation:'query',queryId:'catalog',sql:'DROP DATABASE workspacex'},{operation:'query',queryId:'arbitrary'}]){
 const f=fixture(),h=await initializeRetained(f.control,f.ref,f.options);await assert.rejects(h.dispatch(h.protocol,request));assert.ok(f.calls.every(c=>c.sql==='ROLLBACK'));}
});
test('query requires explicit readonly transaction',async()=>{const f=fixture(),h=await initializeRetained(f.control,f.ref,f.options);await assert.rejects(h.dispatch(h.protocol,{operation:'query',queryId:'catalog'}));assert.ok(f.calls.every(c=>c.sql==='ROLLBACK'));});
test('installed table and library pins reject before SQL',async()=>{for(const path of ['/protected/fixed-queries.json','/usr/local/lib/workspacex-cn/backup_connection.cjs']){const f=fixture();f.files[path]=Buffer.from('drift');await assert.rejects(initializeRetained(f.control,f.ref,f.options));assert.equal(f.calls.length,0);}});
test('retained diagnostic cannot become admin control',async()=>{const f=fixture();f.control.mode='diagnostic';await assert.rejects(initializeRetained(f.control,f.ref,f.options));assert.equal(f.calls.length,0);});
test('login uses existing SCRAM compiler and does not send plaintext SQL',async()=>{const f=fixture(),h=await initializeRetained(f.control,f.ref,f.options),password='A'.repeat(48);await h.dispatch(h.protocol,{operation:'mutation',action:'login',password});assert.match(f.calls[0].sql,/SCRAM-SHA-256/);assert.equal(f.calls[0].sql.includes(password),false);});
test('role/public approval bytes and protected profile host pin cannot drift',async()=>{
 for(const defect of ['role','public','profile']){
  const f=fixture();
  if(defect==='profile')f.profile.backupHostPlan={path:f.ref.path,sha256:'f'.repeat(64)};
  else f.files[f.host[defect==='role'?'roleApproval':'publicCapabilityApproval'].path]=Buffer.from('{}');
  await assert.rejects(initializeRetained(f.control,f.ref,f.options));assert.equal(f.calls.length,0);
 }
});
test('readonly SQL failure rolls back and returns a redacted failure',async()=>{
 const f=fixture(),h=await initializeRetained(f.control,f.ref,f.options);
 await h.dispatch(h.protocol,{operation:'query',queryId:'begin-readonly'});
 f.control.client.query=async(sql)=>{f.calls.push({sql});if(sql.startsWith('SELECT'))throw Error('provider-password-secret');return {rows:[],fields:[]};};
 await assert.rejects(h.dispatch(h.protocol,{operation:'query',queryId:'catalog'}),/^Error: RETAINED_BACKUP_FIXED_OPERATION_REJECTED$/);
 assert.equal(f.calls.at(-1).sql,'ROLLBACK');
});
test('failed privilege operation rolls back before cleanup and permanently forbids login',async()=>{
 const f=fixture(),h=await initializeRetained(f.control,f.ref,f.options);
 await h.dispatch(h.protocol,{operation:'mutation',action:'begin',statement:0});
 await h.dispatch(h.protocol,{operation:'mutation',action:'grant',statement:0});
 await assert.rejects(h.dispatch(h.protocol,{operation:'query',queryId:'arbitrary'}));
 assert.equal(f.calls.at(-1).sql,'ROLLBACK');
 await assert.rejects(h.dispatch(h.protocol,{operation:'mutation',action:'commit',statement:0}),/CLEANUP_WRITES_REQUIRED/);
 await h.dispatch(h.protocol,{operation:'mutation',action:'begin',statement:0});
 await h.dispatch(h.protocol,{operation:'mutation',action:'close',statement:0});
 await h.dispatch(h.protocol,{operation:'mutation',action:'revoke',statement:0});
 await h.dispatch(h.protocol,{operation:'mutation',action:'commit',statement:0});
 const before=f.calls.length;await assert.rejects(h.dispatch(h.protocol,{operation:'mutation',action:'login',password:'A'.repeat(48)}),/FAILED_CLEANUP_ONLY/);
 assert.equal(f.calls.length,before);assert.equal(f.calls.filter(c=>c.sql==='COMMIT').length,1);
});
test('lost rollback forbids cleanup rather than committing unknown privilege transaction',async()=>{
 const f=fixture(),h=await initializeRetained(f.control,f.ref,f.options);
 f.control.client.query=async(sql)=>{f.calls.push({sql});throw Error('lost-response');};
 await assert.rejects(h.dispatch(h.protocol,{operation:'query',queryId:'arbitrary'}));
 await assert.rejects(h.dispatch(h.protocol,{operation:'mutation',action:'begin',statement:0}),/FAILED_CLEANUP_ONLY/);
 assert.equal(f.calls.some(c=>c.sql==='COMMIT'),false);
});
test('approved mutation transaction permits only fixed permission identity queries',async()=>{
 const f=fixture(),h=await initializeRetained(f.control,f.ref,f.options);
 await h.dispatch(h.protocol,{operation:'mutation',action:'begin',statement:0});
 const result=await h.dispatch(h.protocol,{operation:'query',queryId:'catalog'});assert.deepEqual(result.rows,[{name:'t'}]);
 await h.dispatch(h.protocol,{operation:'mutation',action:'rollback',statement:0});assert.equal(f.calls.at(-1).sql,'ROLLBACK');
});
