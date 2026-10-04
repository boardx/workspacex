'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {verify}=require('./backup_profile_transport.cjs');
const DBS=['workspacex','workspacex_agent','workspacex_memory'];
function fixture(){
 const bytes=Buffer.from(JSON.stringify({environment:{profile:'production',ecsInstanceId:'i-uf6ga92ewloganobbln6',rdsInstanceId:'pgm-uf6rg214cp381l49'}}));
 const configurationSha256=crypto.createHash('sha256').update(bytes).digest('hex');
 const identity={sourceRevision:'9b25bfa65662b96c0826fe67506b562ea46aa6d0',baselineRevision:'ba6343199f3c834d6a198f83d0c771614292c82b',attemptId:'fixture',migrationPlanSha256:'a'.repeat(64)};
 const toolRevision='b'.repeat(40),now=Date.now()/1000,calls=[];
 const host={backup:{identity,toolRevision,configurationSha256},connection:{transport:Object.fromEntries(DBS.map(database=>[database,{kind:'existing-production-maintenance-transport',schemaVersion:1,identity:{...identity},toolRevision,source:{database,user:'migration_admin',configurationSha256,providerEvidenceSha256:'c'.repeat(64)},notBefore:now-10,expiresAt:now+100}]))}};
 const library={approveExistingMaintenanceTransportInputs:a=>{calls.push(a.source.database);return {privateAddress:'192.168.100.44'};}};
 return {host,bytes,library,calls};
}
test('all three exact database proofs use canonical source validator',()=>{
 const f=fixture();const r=verify(f.host,f.bytes,f.library);assert.deepEqual(f.calls,DBS);assert.equal(r.kind,'canonical-existing-transport-verified');assert.match(r.providerEvidenceSha256,/^[a-f0-9]{64}$/);
});
test('missing canonical validator rejects without credentials or connection',()=>{const f=fixture();assert.throws(()=>verify(f.host,f.bytes,{}),/CANONICAL_LIBRARY/);});
test('wrong endpoint cannot satisfy fixed private peer',()=>{const f=fixture();f.library.approveExistingMaintenanceTransportInputs=()=>({privateAddress:'192.168.100.45'});assert.throws(()=>verify(f.host,f.bytes,f.library),/ENDPOINT/);});
test('expired stale foreign role and identity proofs reject',()=>{
 for(const change of [a=>a.expiresAt=Date.now()/1000-1,a=>a.notBefore=Date.now()/1000-301,a=>a.source.user='app_diag_ro',a=>a.source.database='other',a=>a.identity.attemptId='foreign',a=>a.toolRevision='d'.repeat(40)]){
  const f=fixture();change(f.host.connection.transport.workspacex);assert.throws(()=>verify(f.host,f.bytes,f.library),/FRESH_BINDING/);
 }
});
test('configuration byte drift and absent database proof reject',()=>{
 const f=fixture();assert.throws(()=>verify(f.host,Buffer.concat([f.bytes,Buffer.from(' ')]),f.library),/CONFIGURATION/);
 delete f.host.connection.transport.workspacex_agent;assert.throws(()=>verify(f.host,f.bytes,f.library));
});
