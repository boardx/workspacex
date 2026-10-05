import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {createSourceProductionConsumers,type SourceConsumerRuntime} from './source_production_consumers';
import {persistentSourceModules} from './sealed_runtime';
import {CURRENT_EPOCH_PYTHON_MODULES} from './current_epoch_manifest_consumer';
import type {EntryPlan} from './entry';

/** Root authority/host execution are local source mocks. Actual repository bytes
 * define this bundle, but no test claims they are installed on a real host. */
function fixture(){
 const identity={sourceRevision:'9b25bfa65662b96c0826fe67506b562ea46aa6d0',baselineRevision:'ba6343199f3c834d6a198f83d0c771614292c82b',migrationPlanSha256:'a'.repeat(64),attemptId:'source-local'};
 const revision='b'.repeat(40),hash='c'.repeat(64),events:string[]=[];
 const vm=resolve(fileURLToPath(new URL('../../../../.harness/scripts/vm/',import.meta.url)));
 const files:Record<string,string>={},installed:Record<string,string>={};
 const command=(file:string)=>{const sha=createHash('sha256').update(readFileSync(join(vm,file))).digest('hex');files['.harness/scripts/vm/'+file]=sha;installed['/usr/local/lib/workspacex-cn/'+file]=sha;return {path:'/usr/local/lib/workspacex-cn/'+file,sha256:sha};};
 const modules=Object.fromEntries(Object.entries(persistentSourceModules).map(([key,file])=>[key,command(String(file))]));
 const host={identity,writerPlanPath:'/etc/workspacex-cn/writer-plan.json',writerPlanSha256:hash,writerPlanCanonicalSha256:hash,hold:command('cn_maintenance_hold.py'),writerFence:command('host_transport.py')};
 const writerModules={writer_fence:command('writer_fence.py'),control_connection:command('control_connection.py'),fixed_probes:command('fixed_probes.py')};
 const candidateModules={candidate_writer:command('candidate_writer.py'),candidate_backend_collector:command('candidate_backend_collector.py'),candidate_host_transport:command('candidate_host_transport.py')};
 const collector=command('collect-cn-migration-snapshot.py');
 const qualification={...command('current_epoch_qualification.py'),pythonModules:Object.fromEntries(Object.entries(CURRENT_EPOCH_PYTHON_MODULES).map(([key,file])=>[key,command(file+'.py')]))};
 const data:any={schemaVersion:2,identity,toolRevision:revision,prepared:{receipt:{path:'/etc/workspacex-cn/mock-receipt.json',sha256:hash},manifest:{path:'/etc/workspacex-cn/mock-manifest.json',sha256:hash}},migration:{inputs:{path:'/etc/workspacex-cn/mock-migration.json',sha256:hash},binding:{identity,toolRevision:revision,collector}},writerModules,candidateModules,sourceOperationModules:modules,prehold:{qualificationExecutable:qualification,filesSha256:files},dockerRuntime:{path:'/usr/bin/docker',sha256:hash},publicPolicy:{deploymentMarker:'local-mock',observationSamples:2,maximumOutstandingRuns:0}};
 const profile:any={toolRevision:revision,filesSha256:files,installedFilesSha256:installed,maintenanceSourceOperations:{schemaVersion:1,sourcePath:'.harness/scripts/vm/maintenance_source_operations.py',sha256:modules.maintenance_source_operations!.sha256,inputs:{}},parentCaptureInvocation:{schemaVersion:1,producerId:'retained-capture',executablePins:{'/usr/bin/python3':hash}},currentEpochQualification:{schemaVersion:2,sourcePath:'.harness/scripts/vm/current_epoch_qualification.py',sha256:modules.current_epoch_qualification!.sha256}};
 const plan={identity,host,production:{toolRevision:revision},consumerInputsPath:'/etc/workspacex-cn/mock-consumer.json',consumerInputsSha256:hash} as EntryPlan;
 const io:Partial<SourceConsumerRuntime>={readJson:path=>{events.push('read:'+path);if(path===host.writerPlanPath)return {identity,toolRevision:revision};if(path==='/etc/workspacex-cn/trusted-tool-binding.json')return profile;return {};},readBytes:()=>Buffer.from('{}'),verifyExecutable:()=>{},acquireLock:async()=>{events.push('lock');return async()=>{events.push('unlock');};},lifecycle:()=>{events.push('construct-retained');return {start:async()=>{events.push('start-retained');return host;},invoke:async()=>({stdout:'{}'}),baselineCancellation:async()=>{},bindCandidateReference:async()=>{},candidateOperation:async()=>{},sourceOperation:async()=>{throw Error('ACTUAL_EVIDENCE_MISSING');},migrateExactPlan:async()=>({applied:[],skipped:[]}),recordMigrationCompletion:async()=>{},readDiagnosticLedger:async()=>({ledger:[],rowCount:0,connection:{},observedAt:0}),readRunDrain:async()=>({queued:0,running:0,writebackPending:0}),recoverRetainedBaseline:async()=>{throw Error('LEGACY_RECOVERY_MUST_NOT_RUN');},closeAfterAccepted:async()=>{},retainUnknown:()=>{events.push('retain');}};},migration:()=>({migrate:async()=>({applied:[],skipped:[]}),readFreshCompletion:async()=>({snapshot:{},binding:{}}),verifyLiveWriterBarrier:async()=>{}})};
 return {plan,data,profile,io,events};
}
test('schema2 constructs the compiled A route without starting retained SQL or legacy activation',async()=>{
 const f=fixture(),consumer=await createSourceProductionConsumers(f.plan,f.profile,f.data,f.io);
 assert.equal(typeof consumer.inputs.admittedARoute?.stageCandidateRuntime,'function');
 assert.equal(typeof consumer.inputs.admittedARoute?.observeOpenedCandidate,'function');
 assert.equal(f.events.includes('start-retained'),false);assert.equal(f.events.includes('lock'),false);
});
test('a missing or foreign source module rejects before retained lifecycle construction',async()=>{
 for(const change of [(f:ReturnType<typeof fixture>)=>{delete f.data.sourceOperationModules.candidate_readonly_docker;},(f:ReturnType<typeof fixture>)=>{f.profile.installedFilesSha256[f.data.sourceOperationModules.maintenance_source_operations.path]='0'.repeat(64);}]){
  const f=fixture();change(f);await assert.rejects(createSourceProductionConsumers(f.plan,f.profile,f.data,f.io),/SOURCE_CONSUMER/);assert.equal(f.events.includes('construct-retained'),false);
 }
});
test('missing actual capture/qualification capability rejects before sessions or locks',async()=>{
 for(const key of ['parentCaptureInvocation','currentEpochQualification','maintenanceSourceOperations']){
  const f=fixture();delete f.profile[key];await assert.rejects(createSourceProductionConsumers(f.plan,f.profile,f.data,f.io),/CAPABILITY/);assert.equal(f.events.includes('construct-retained'),false);
 }
});
test('JSON cannot add an executable callback registry or fallback activation lane',async()=>{
 const f=fixture();f.data.operations={resume:'echo unsafe'};
 await assert.rejects(createSourceProductionConsumers(f.plan,f.profile,f.data,f.io));assert.equal(f.events.length,0);
});
test('prehold missing qualified archive releases only the inherited lock and starts no SQL',async()=>{
 const f=fixture(),c=await createSourceProductionConsumers(f.plan,f.profile,f.data,f.io),ops=c.inputs.admittedARoute!;
 const release=await ops.acquireReleaseLock(f.plan.identity);
 await assert.rejects(ops.verifyPreholdRecoveryCapability(f.plan.identity));await release();
 assert.equal(f.events.includes('start-retained'),false);assert.equal(f.events.at(-1),'unlock');
});
