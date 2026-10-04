import {test} from 'node:test';
import assert from 'node:assert/strict';
import {consumeCurrentEpochManifest,type CurrentEpochSourcePolicy} from './current_epoch_manifest_consumer';
const hash='a'.repeat(64),identity={sourceRevision:'9b25bfa65662b96c0826fe67506b562ea46aa6d0',baselineRevision:'ba6343199f3c834d6a198f83d0c771614292c82b',migrationPlanSha256:hash,attemptId:'b'.repeat(32)} as const;
function fixture(){
 const binding={identity,toolRevision:'c'.repeat(40),host:{instanceId:'ecs-fixed',bootId:'11111111-1111-4111-8111-111111111111'},epoch:hash,holdGeneration:'d'.repeat(32),targetInstanceId:'pgm-isolated'};
 const reference=(name:string)=>({path:'/etc/workspacex-cn/'+name,sha256:hash});
 const policy:CurrentEpochSourcePolicy={binding,recoveryVerifier:{path:'/usr/local/lib/workspacex-cn/cn-maintenance-recovery-evidence-verifier.py',sha256:hash},filesSha256:{'.harness/scripts/vm/cn-maintenance-recovery-evidence-verifier.py':hash},collection:reference('collection'),recoveryEvidence:reference(`maintenance-evidence/${identity.sourceRevision}/${identity.attemptId}/recovery.json`),recoveryManifest:reference('manifest'),canonicalSetup:reference('canonical'),formalJourneys:reference('journeys'),objectRecovery:reference('objects')};
 const {targetInstanceId,...bound}=binding;
 const collection={schemaVersion:1,kind:'current-held-epoch-evidence-collection',...bound,host:{...bound.host},sourceRdsInstanceId:'pgm-uf6rg214cp381l49',isolatedTargetInstanceId:targetInstanceId,evidenceRefs:{},collectionVerified:true,ready:false,qualified:false,prepared:false,remainingTransport:'retained-scoped-backup-transport-required'};
 const values:Record<string,any>={[policy.collection.path]:collection,[policy.recoveryEvidence.path]:{identity,toolRevision:binding.toolRevision},[policy.recoveryManifest.path]:{identity,toolRevision:binding.toolRevision,evidenceSha256:hash,targetInstanceId},[policy.canonicalSetup.path]:{passed:true},[policy.formalJourneys.path]:{qualified:true},[policy.objectRecovery.path]:{passed:true}};
 const calls:any[]=[];
 const io={read:async(r:{path:string})=>values[r.path],run:async(...args:any[])=>{calls.push(args);return {stdout:'{"qualified":true}'};}};
 return {policy,values,collection,calls,io};
}
test('actual fixed source command executes; even forged qualified stdout cannot mint manifest',async()=>{const f=fixture();await assert.rejects(consumeCurrentEpochManifest(f.policy,f.io),/QUALIFIED_SOURCE_CONSUMER_UNAVAILABLE/);assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0][1],['--maintenance-evidence-replay',f.policy.recoveryEvidence.path]);});
test('real verifier rejection propagates without publication',async()=>{const f=fixture();f.io.run=async()=>{throw Error('THREE_DB_CONSISTENT_SNAPSHOT_UNPROVEN');};await assert.rejects(consumeCurrentEpochManifest(f.policy,f.io),/CONSISTENT_SNAPSHOT/);});
for(const mode of ['qualified','renamed','epoch','host','target','source','missing','hash'] as const)test('reject '+mode+' before command',async()=>{const f=fixture();if(mode==='qualified')f.collection.qualified=true as any;if(mode==='renamed')f.collection.kind='held-current-epoch-manifest';if(mode==='epoch')f.collection.epoch='f'.repeat(64);if(mode==='host')f.collection.host.bootId='22222222-2222-4222-8222-222222222222';if(mode==='target')f.policy.binding.targetInstanceId='pgm-uf6rg214cp381l49';if(mode==='source')f.policy.filesSha256={};if(mode==='missing')delete f.values[f.policy.collection.path];if(mode==='hash')f.values[f.policy.recoveryManifest.path].evidenceSha256='f'.repeat(64);await assert.rejects(consumeCurrentEpochManifest(f.policy,f.io));assert.equal(f.calls.length,0);});

import {consumeQualifiedCurrentEpochManifest,consumePreholdEpochManifest,CURRENT_EPOCH_PYTHON_MODULES,type QualifiedCurrentEpochSourcePolicy} from './current_epoch_manifest_consumer';
function qualified(){
 const f=fixture(),b=f.policy.binding;
 const root=`/etc/workspacex-cn/maintenance-evidence/${b.identity.sourceRevision}/${b.identity.attemptId}`,outputRoot=root+'/qualified-current-epoch';
 const reference=(path:string)=>({path,sha256:hash});
 const policy:QualifiedCurrentEpochSourcePolicy={binding:b,qualificationExecutable:{path:'/usr/local/lib/workspacex-cn/current_epoch_qualification.py',sha256:hash},filesSha256:{'.harness/scripts/vm/current_epoch_qualification.py':hash},input:reference(root+'/qualification-input.json'),sourcePolicy:reference(root+'/source-policy.json'),outputRoot};
 policy.qualificationExecutable.pythonModules=Object.fromEntries(Object.entries(CURRENT_EPOCH_PYTHON_MODULES).map(([name,file])=>[name,{path:`/usr/local/lib/workspacex-cn/${file}.py`,sha256:hash}]));
 policy.filesSha256={...policy.filesSha256,...Object.fromEntries(Object.values(CURRENT_EPOCH_PYTHON_MODULES).map(file=>[`.harness/scripts/vm/${file}.py`,hash]))};
 const bound={...b,providerBindingSha256:hash};
 const evidence={schemaVersion:1,kind:'held-current-epoch-evidence',identity:b.identity,toolRevision:b.toolRevision,holdGeneration:b.holdGeneration,epoch:reference(outputRoot+'/epoch.json'),databases:Object.fromEntries(['workspacex','workspacex_agent','workspacex_memory'].map(db=>[db,reference(outputRoot+'/'+db+'.json')])),objectRecovery:reference(outputRoot+'/objects.json'),beforeHeldObservationSha256:hash,afterHeldObservationSha256:'b'.repeat(64)};
 const {epoch,...manifest}=evidence;
 const values:Record<string,any>={[policy.input.path]:{schemaVersion:2,kind:'current-held-epoch-qualification',binding:bound,sourcePolicy:{...policy.sourcePolicy,bytes:100},outputRoot},[policy.sourcePolicy.path]:{schemaVersion:2},[epoch.path]:{...manifest,kind:'held-current-epoch-manifest'},[evidence.objectRecovery.path]:{schemaVersion:2,kind:'qualified-held-object-recovery',binding:bound}};
 for(const r of Object.values(evidence.databases))values[r.path]={schemaVersion:2,kind:'qualified-held-database-evidence',binding:bound};
 const calls:any[]=[];const io={read:async(r:{path:string})=>values[r.path],run:async(...args:any[])=>{calls.push(args);return {stdout:JSON.stringify(evidence)};}};
 return {policy,values,evidence,io,calls};
}
test('schema2 invokes fixed qualifier then rereads exact manifest and three database/object aggregates',async()=>{const f=qualified();assert.deepEqual(await consumeQualifiedCurrentEpochManifest(f.policy,f.io),f.evidence);assert.deepEqual(f.calls[0][1],['--qualify-current-epoch',f.policy.input.path]);});
for(const mode of ['missing-db','manifest-drift','generation','input-policy','tool','old-schema','fake-ready'] as const)test('schema2 rejects '+mode,async()=>{const f=qualified();if(mode==='missing-db')delete f.values[f.evidence.databases.workspacex!.path];if(mode==='manifest-drift')f.values[f.evidence.epoch.path].afterHeldObservationSha256=hash;if(mode==='generation')f.evidence.holdGeneration='f'.repeat(32);if(mode==='input-policy')f.values[f.policy.input.path].sourcePolicy.sha256='f'.repeat(64);if(mode==='tool')f.policy.filesSha256={};if(mode==='old-schema')f.values[f.policy.input.path].schemaVersion=1;if(mode==='fake-ready')(f.evidence as any).ready=true;await assert.rejects(consumeQualifiedCurrentEpochManifest(f.policy,f.io));});

for(const mode of ['missing','extra','hash','path'] as const)test('schema2 module closure rejects '+mode,async()=>{const f=qualified(),modules=f.policy.qualificationExecutable.pythonModules as Record<string,{path:string;sha256:string}>;if(mode==='missing')delete modules.epoch_recovery;if(mode==='extra')modules.foreign={path:'/usr/local/lib/workspacex-cn/foreign.py',sha256:hash};if(mode==='hash')modules.cn_backup_sql!.sha256='f'.repeat(64);if(mode==='path')modules.cn_backup_sql!.path='/tmp/cn_backup_sql.py';await assert.rejects(consumeQualifiedCurrentEpochManifest(f.policy,f.io));assert.equal(f.calls.length,0);});

test('prehold fixed consumer verifies archive through independent readonly CLI rather than current publication',async()=>{const f=qualified();assert.deepEqual(await consumePreholdEpochManifest(f.policy,f.io),f.evidence);assert.deepEqual(f.calls[0][1],['--verify-prehold-epoch',f.policy.input.path]);});
test('prehold missing archive aggregate rejects after readonly call',async()=>{const f=qualified();delete f.values[f.evidence.objectRecovery.path];await assert.rejects(consumePreholdEpochManifest(f.policy,f.io));assert.equal(f.calls[0][1][0],'--verify-prehold-epoch');});
