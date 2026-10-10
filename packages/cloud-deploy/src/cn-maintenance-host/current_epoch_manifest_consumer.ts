import {admittedReleaseIdentity} from './release_identity';
import {assertSourcePlanAuthority,assertPreholdArchiveAuthority,type OriginalPlanAuthority} from './source_plan_authority';
import { z } from 'zod';
import { protectedPrivateJson, runFixedPython, type CommandRunner, type TrustedExecutable } from './fixed_transport';
import type { CurrentEpochEvidence, FactoryRef } from './a_route_factory';
import { runtimeDigest } from './sealed_runtime';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const ref = z.object({path:z.string().startsWith('/etc/workspacex-cn/').refine(p=>!p.split('/').includes('..')),sha256:digest}).strict();
const identity = z.object({sourceRevision:z.string().regex(/^[a-f0-9]{40}$/),baselineRevision:z.string().regex(/^[a-f0-9]{40}$/),migrationPlanSha256:digest,attemptId:z.string().regex(/^[A-Za-z0-9-]{1,32}$/)}).strict().refine(admittedReleaseIdentity);
const binding = z.object({identity,toolRevision:z.string().regex(/^[a-f0-9]{40}$/),host:z.object({instanceId:z.string().min(1),bootId:z.string().uuid()}).strict(),epoch:digest,holdGeneration:z.string().regex(/^[a-f0-9]{32}$/),targetInstanceId:z.string().regex(/^pgm-[a-z0-9]+$/)}).strict();
const collection = binding.omit({targetInstanceId:true}).extend({schemaVersion:z.literal(1),kind:z.literal('current-held-epoch-evidence-collection'),sourceRdsInstanceId:z.literal('pgm-uf6rg214cp381l49'),isolatedTargetInstanceId:z.string(),evidenceRefs:z.record(z.string(),ref.or(ref.extend({bytes:z.number().int().positive()}).strict())),collectionVerified:z.literal(true),ready:z.literal(false),qualified:z.literal(false),prepared:z.literal(false),remainingTransport:z.literal('retained-scoped-backup-transport-required')}).strict();
export interface CurrentEpochSourcePolicy {
 binding:z.infer<typeof binding>;
 recoveryVerifier:TrustedExecutable;
 /** The installed bytes must be pinned to this exact repository source. */
 filesSha256:Readonly<Record<string,string>>;
 collection:FactoryRef;
 recoveryEvidence:FactoryRef;
 recoveryManifest:FactoryRef;
 canonicalSetup:FactoryRef;
 formalJourneys:FactoryRef;
 objectRecovery:FactoryRef;
}
const VERIFIER_SOURCE='.harness/scripts/vm/cn-maintenance-recovery-evidence-verifier.py';
const need=(v:unknown,c:string):void=>{if(!v)throw new Error(c);};
/** This is an admission gate, not a capture transport. The existing source-owned
 * verifier has no qualified result today. Keep that fact executable: neither
 * fixture callbacks nor JSON "qualified" flags can mint an epoch manifest.
 * Once a source-owned common-epoch/object/journey qualification consumer exists,
 * it must be explicitly composed here before any O_EXCL manifest publication. */
export async function consumeCurrentEpochManifest(policy:CurrentEpochSourcePolicy,io:{read?:(ref:FactoryRef)=>Promise<unknown>;run?:CommandRunner}={},authority?:OriginalPlanAuthority):Promise<CurrentEpochEvidence>{
 const b=binding.parse(policy.binding);assertSourcePlanAuthority(authority,b.identity,b.toolRevision);
 const refs=[policy.collection,policy.recoveryEvidence,policy.recoveryManifest,policy.canonicalSetup,policy.formalJourneys,policy.objectRecovery].map(r=>ref.parse(r));
 const command=Object.freeze({...policy.recoveryVerifier});
 need(command.path==='/usr/local/lib/workspacex-cn/cn-maintenance-recovery-evidence-verifier.py'&&digest.safeParse(command.sha256).success&&policy.filesSha256[VERIFIER_SOURCE]===command.sha256&&!command.writerFenceModule,'EPOCH_SOURCE_VERIFIER_BINDING');
 need(b.targetInstanceId!=='pgm-uf6rg214cp381l49','EPOCH_PRODUCTION_ISOLATION_FORBIDDEN');
 const read=io.read??(async(r:FactoryRef)=>protectedPrivateJson(r.path,r.sha256));
 const values=await Promise.all(refs.map(read));
 need(values.every(v=>v&&typeof v==='object'&&!Array.isArray(v)),'EPOCH_FORMAL_SOURCE_EVIDENCE_MISSING');
 const c=collection.parse(values[0]);
 const cb={identity:c.identity,toolRevision:c.toolRevision,host:c.host,epoch:c.epoch,holdGeneration:c.holdGeneration,targetInstanceId:c.isolatedTargetInstanceId};
 need(runtimeDigest(cb)===runtimeDigest(b),'EPOCH_COLLECTION_BINDING');
 const recovery=values[1] as Record<string,unknown>, manifest=values[2] as Record<string,unknown>;
 need(recovery&&manifest&&runtimeDigest(recovery.identity)===runtimeDigest(b.identity)&&recovery.toolRevision===b.toolRevision&&runtimeDigest(manifest.identity)===runtimeDigest(b.identity)&&manifest.toolRevision===b.toolRevision&&manifest.evidenceSha256===refs[1]!.sha256&&manifest.targetInstanceId===b.targetInstanceId,'EPOCH_RECOVERY_BINDING');
 const fixedPath=`/etc/workspacex-cn/maintenance-evidence/${b.identity.sourceRevision}/${b.identity.attemptId}/recovery.json`;
 need(refs[1]!.path===fixedPath,'EPOCH_FIXED_RECOVERY_PATH');
 // The real command independently rereads protected raw bytes, full backup
 // metadata/ciphertext, restore receipts/catalog/ACL/sequence/version/row streams,
 // installed source and actual hold. No passed flag bypasses that consumer.
 assertSourcePlanAuthority(authority,b.identity,b.toolRevision);
 await (io.run??runFixedPython)(command,['--maintenance-evidence-replay',fixedPath]);
 // Even a mocked zero exit cannot extend the source verifier's admission scope.
 // Existing admission_result() always rejects; recording extra files cannot
 // prove the missing common snapshot, object recovery or collection provenance.
 throw new Error('EPOCH_QUALIFIED_SOURCE_CONSUMER_UNAVAILABLE');
}

export const CURRENT_EPOCH_PYTHON_MODULES=Object.freeze({epoch_recovery:'cn-maintenance-recovery-evidence-verifier',writer_fence:'writer_fence',cn_backup_package:'cn_backup_package',cn_backup_sql:'cn_backup_sql',cn_production_recovery_executor:'cn_production_recovery_executor',current_held_epoch_evidence_producer:'current_held_epoch_evidence_producer',isolated_canonical_plan_factory:'isolated_canonical_plan_factory',isolated_conservation_evidence_producer:'isolated_conservation_evidence_producer',isolated_conservation_inputs:'isolated_conservation_inputs',isolated_conservation_plan:'isolated_conservation_plan',isolated_conservation_stage:'isolated_conservation_stage',isolated_rehearsal:'isolated_rehearsal'});
export interface QualifiedCurrentEpochSourcePolicy {
 binding:z.infer<typeof binding>;
 qualificationExecutable:TrustedExecutable;
 filesSha256:Readonly<Record<string,string>>;
 input:FactoryRef;
 sourcePolicy:FactoryRef;
 outputRoot:string;
}
const epochEvidence=z.object({schemaVersion:z.literal(1),kind:z.literal('held-current-epoch-evidence'),identity,toolRevision:z.string().regex(/^[a-f0-9]{40}$/),holdGeneration:z.string().regex(/^[a-f0-9]{32}$/),epoch:ref,databases:z.object({workspacex:ref,workspacex_agent:ref,workspacex_memory:ref}).strict(),objectRecovery:ref,beforeHeldObservationSha256:digest,afterHeldObservationSha256:digest}).strict();
/** Schema2 admits only the fixed source-owned Python qualification consumer.
 * The root launcher must supply its installed hash-bound dependency bundle;
 * the old recovery CLI path and old schema remain hard rejecting. */
export async function consumeQualifiedCurrentEpochManifest(policy:QualifiedCurrentEpochSourcePolicy,io:{read?:(ref:FactoryRef)=>Promise<unknown>;run?:CommandRunner}={},authority?:OriginalPlanAuthority):Promise<CurrentEpochEvidence>{
 return consumeQualifiedEpoch(policy,io,'--qualify-current-epoch',authority);
}
/** The binding belongs to the root-approved archive and may use an earlier
 * attempt. Current capture still runs separately after actual writers hold. */
export async function consumePreholdEpochManifest(policy:QualifiedCurrentEpochSourcePolicy,io:{read?:(ref:FactoryRef)=>Promise<unknown>;run?:CommandRunner}={},authority?:OriginalPlanAuthority):Promise<CurrentEpochEvidence>{
 return consumeQualifiedEpoch(policy,io,'--verify-prehold-epoch',authority);
}
async function consumeQualifiedEpoch(policy:QualifiedCurrentEpochSourcePolicy,io:{read?:(ref:FactoryRef)=>Promise<unknown>;run?:CommandRunner},operation:'--qualify-current-epoch'|'--verify-prehold-epoch',authority?:OriginalPlanAuthority):Promise<CurrentEpochEvidence>{
 const b=binding.parse(policy.binding);
 const admit=()=>operation==='--verify-prehold-epoch'?assertPreholdArchiveAuthority(authority,policy):assertSourcePlanAuthority(authority,b.identity,b.toolRevision);
 admit();
 const inputRef=ref.parse(policy.input),sourcePolicy=ref.parse(policy.sourcePolicy);
 const modules=policy.qualificationExecutable.pythonModules;
 need(modules&&Object.keys(modules).sort().join(',')===Object.keys(CURRENT_EPOCH_PYTHON_MODULES).sort().join(','),'EPOCH_QUALIFICATION_MODULE_CLOSURE');
 for(const [name,file] of Object.entries(CURRENT_EPOCH_PYTHON_MODULES)){
  const module=modules![name];need(module&&module.path===`/usr/local/lib/workspacex-cn/${file}.py`&&digest.safeParse(module.sha256).success&&policy.filesSha256[`.harness/scripts/vm/${file}.py`]===module.sha256,'EPOCH_QUALIFICATION_MODULE_BINDING');
 }
 const command=Object.freeze({...policy.qualificationExecutable,pythonModules:Object.freeze(Object.fromEntries(Object.entries(modules!).map(([name,module])=>[name,Object.freeze({...module})])))});
 const source='.harness/scripts/vm/current_epoch_qualification.py';
 need(command.path==='/usr/local/lib/workspacex-cn/current_epoch_qualification.py'&&digest.safeParse(command.sha256).success&&policy.filesSha256[source]===command.sha256&&!command.writerFenceModule,'EPOCH_QUALIFICATION_SOURCE_BINDING');
 const root=`/etc/workspacex-cn/maintenance-evidence/${b.identity.sourceRevision}/${b.identity.attemptId}`;
 need(inputRef.path===root+'/qualification-input.json'&&policy.outputRoot===root+'/qualified-current-epoch'&&sourcePolicy.path.startsWith(root+'/'),'EPOCH_QUALIFICATION_FIXED_PATHS');
 const read=io.read??(async(r:FactoryRef)=>protectedPrivateJson(r.path,r.sha256));
 const input=await read(inputRef) as Record<string,unknown>;
 need(input?.schemaVersion===2&&input.kind==='current-held-epoch-qualification'&&input.outputRoot===policy.outputRoot,'EPOCH_QUALIFICATION_INPUT_SCHEMA');
 const candidate=input.binding as Record<string,unknown>;
 need(candidate&&runtimeDigest(Object.fromEntries(Object.keys(b).map(k=>[k,candidate[k]])))===runtimeDigest(b)&&digest.safeParse(candidate.providerBindingSha256).success,'EPOCH_QUALIFICATION_INPUT_BINDING');
 const rawRef=input.sourcePolicy as Record<string,unknown>;
 need(rawRef&&rawRef.path===sourcePolicy.path&&rawRef.sha256===sourcePolicy.sha256,'EPOCH_QUALIFICATION_EXTERNAL_POLICY');
 await read(sourcePolicy);
 admit();
 const response=await (io.run??runFixedPython)(command,[operation,inputRef.path]);
 let parsed:unknown;try{parsed=JSON.parse(response.stdout);}catch{throw Error('EPOCH_QUALIFICATION_OUTPUT_JSON');}
 const evidence=epochEvidence.parse(parsed);
 need(runtimeDigest(evidence.identity)===runtimeDigest(b.identity)&&evidence.toolRevision===b.toolRevision&&evidence.holdGeneration===b.holdGeneration&&evidence.epoch.path===policy.outputRoot+'/epoch.json','EPOCH_QUALIFICATION_OUTPUT_BINDING');
 const {epoch,...manifest}=evidence;
 need(runtimeDigest(await read(epoch))===runtimeDigest({...manifest,kind:'held-current-epoch-manifest'}),'EPOCH_QUALIFICATION_MANIFEST_RAW_BINDING');
 for(const [db,r] of Object.entries(evidence.databases)){
  need(r.path===policy.outputRoot+'/'+db+'.json','EPOCH_QUALIFICATION_DATABASE_PATH');
  const persisted=await read(r) as Record<string,unknown>;
  need(persisted?.schemaVersion===2&&persisted.kind==='qualified-held-database-evidence'&&runtimeDigest(persisted.binding)===runtimeDigest(candidate),'EPOCH_QUALIFICATION_DATABASE_BINDING');
 }
 need(evidence.objectRecovery.path===policy.outputRoot+'/objects.json','EPOCH_QUALIFICATION_OBJECT_PATH');
 const objects=await read(evidence.objectRecovery) as Record<string,unknown>;
 need(objects?.schemaVersion===2&&objects.kind==='qualified-held-object-recovery'&&runtimeDigest(objects.binding)===runtimeDigest(candidate),'EPOCH_QUALIFICATION_OBJECT_BINDING');
 await read(inputRef);await read(sourcePolicy);
 return evidence;
}
