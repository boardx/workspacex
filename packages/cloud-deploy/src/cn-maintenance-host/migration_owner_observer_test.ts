import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {terminalFixture} from './migration_owner_terminal_test_fixture';
import {fixture as scopeFixture,clock} from './migration_scope_adapter_test_fixture';
import {observeInstalledMigrationOwner} from './migration_owner_observer';
import {runtimeDigest} from './sealed_runtime';
import type {EntryPlan} from './entry';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const terminal=terminalFixture(),id=terminal.f.authority.identity,tool=terminal.f.authority.toolRevision,h='c'.repeat(64),files=new Map<string,Buffer>();
 const put=(path:string,value:unknown)=>{const raw=Buffer.from(JSON.stringify(value));files.set(path,raw);return {path,sha256:sha(raw)};};
 const command={path:'/usr/local/lib/workspacex-cn/fixed.py',sha256:h},reference={path:'/etc/workspacex-cn/fixed.json',sha256:h};
 const migration=put('/etc/workspacex-cn/migration-inputs.json',{expectedCompletion:{productionSource:{accountId:'1177216024653153',regionId:'cn-shanghai',dbInstanceId:'pgm-exact',database:'workspacex',user:'fixed',endpointSha256:h,serverAddressSha256:null,port:null,identityLane:'aliyun-private-endpoint',clientPeerAddressSha256:h,clientPeerPort:5432,configurationSha256:h,providerEvidenceSha256:h,sslMode:'verify-full',clientEncrypted:true,clientTlsAuthorized:true}}});
 const manifest=put('/etc/workspacex-cn/prepared.json',{images:Object.fromEntries(['api','web','agent','sandbox','postgres'].map(k=>[k,{image:'registry.test/'+k+'@sha256:'+h}]))});
 const data={schemaVersion:2,identity:id,toolRevision:tool,prepared:{receipt:reference,manifest},migration:{inputs:migration,binding:{}},writerModules:{writer_fence:command,control_connection:command,fixed_probes:command},candidateModules:{candidate_writer:command,candidate_backend_collector:command,candidate_host_transport:command},sourceOperationModules:{},prehold:{},dockerRuntime:{path:'/usr/bin/docker',sha256:h},publicPolicy:{deploymentMarker:'exact',observationSamples:2,maximumOutstandingRuns:0}};
 const consumer=put(`/etc/workspacex-cn/maintenance-host/${id.sourceRevision}/${id.attemptId}/consumer-inputs.json`,data);
 const p=scopeFixture(v=>{v.consumerInputsSha256=consumer.sha256;v.codeFiles['.harness/scripts/vm/maintenance_source_operations.py']='e'.repeat(64);},id,tool);
 p.f.profile.filesSha256={...p.f.profile.filesSha256,...p.inputs.codeFiles};p.f.profile.candidateComposeEmitter=terminal.f.profile.candidateComposeEmitter;
 const release='f'.repeat(64),root='/var/lib/workspacex-cn/migration-owner/'+release;
 p.f.profile.maintenanceMigrationOwner={schemaVersion:1,releaseSha256:release,originalPlanSha256:p.authority.sourcePlanSha256,configSha256:h};
 const claim=put(root+'/claim.json',{schemaVersion:1,kind:'migration-owner-start-v1',releaseSha256:release,planSha256:p.authority.sourcePlanSha256,launcherSha256:h,unitSha256:h,unit:'workspacex-cn-migration@'+release+'.service'});
 const started=put(root+'/started.json',{claimSha256:claim.sha256,invocationId:'a'.repeat(32),pid:123,startTicks:456,bootId:'11111111-1111-4111-8111-111111111111'});
 terminal.value.originalPlanSha256=p.authority.sourcePlanSha256;
 const completion=JSON.parse(terminal.files.get(terminal.value.completion.path)!.toString());
 completion.capturedAt=new Date(clock).toISOString();completion.providerFinishedAt=new Date(clock).toISOString();completion.expiresAt=new Date(clock+60000).toISOString();
 const completionRef=put(terminal.value.completion.path,completion);terminal.value.completion=completionRef;
 const candidate=JSON.parse(terminal.files.get(terminal.value.candidate.path)!.toString());candidate.plan.migrationCompletionSha256=completionRef.sha256;terminal.value.candidate=put(terminal.value.candidate.path,candidate);
 const rawRef=put(root+'/terminal.json',terminal.value);put(root+'/terminal-seal.json',{schemaVersion:1,claimSha256:claim.sha256,startedSha256:started.sha256,terminalSha256:rawRef.sha256,terminalBytes:files.get(rawRef.path)!.length});
 const read=(path:string,expected?:string)=>{const raw=(path===p.authority.sourcePlanPath||path==='/etc/workspacex-cn/trusted-tool-binding.json')?p.read(path):(files.get(path)??terminal.files.get(path)??terminal.f.store.get(path)??p.read(path));if(expected&&sha(raw)!==expected)throw Error('FIXTURE_RAW_PIN');return raw;};
 const plan={identity:id,host:{...p.f.host,identity:id,writerPlanPath:p.authority.sourcePlanPath,writerPlanSha256:p.authority.sourcePlanSha256,writerPlanCanonicalSha256:runtimeDigest(p.authority.sourcePlan)},production:{toolRevision:tool},consumerInputsPath:consumer.path,consumerInputsSha256:consumer.sha256}as EntryPlan;
 return {plan,profile:p.f.profile,read,files,root};
}
test('readonly observer reconstructs actual authority and original validators without operation ports',async t=>{
 t.mock.method(Date,'now',()=>clock);const f=fixture(),r=await observeInstalledMigrationOwner(f.plan,f.profile,f.read);assert.equal(r.originalPlanSha256,f.plan.host.writerPlanSha256);assert.equal('accepted'in r,false);
});
test('seal cannot authorize altered original terminal bytes',async t=>{t.mock.method(Date,'now',()=>clock);const f=fixture();f.files.set(f.root+'/terminal.json',Buffer.from('{}'));await assert.rejects(observeInstalledMigrationOwner(f.plan,f.profile,f.read),/RAW_PIN/);});
test('expired migration policy prevents readonly terminal acceptance',async t=>{t.mock.method(Date,'now',()=>clock+3600000);const f=fixture();await assert.rejects(observeInstalledMigrationOwner(f.plan,f.profile,f.read),/EXPIRED/);});
