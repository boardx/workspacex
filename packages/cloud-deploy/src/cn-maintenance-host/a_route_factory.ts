import { z } from 'zod';
import {readNativeCompletion,legacyCompletionRelease} from './native_completion';
import {admittedReleaseIdentity} from './release_identity';
import type { MaintenanceIdentity } from '../cn-maintenance-release';
import type { ARouteOperations } from './a_route';
import { bindARouteHostOperations, type ARouteHostActions } from './a_route_adapter';
import type { HostBinding } from './controller';
import type { CommandRunner, TrustedExecutable } from './fixed_transport';
import { bindPublicAcceptance, type PublicAcceptanceBinding, type PublicAcceptanceTransport } from './public_acceptance';
import { runtimeDigest, type createPersistentWriterLifecycle } from './sealed_runtime';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const identitySchema = z.object({ sourceRevision: z.string().regex(/^[a-f0-9]{40}$/), baselineRevision: z.string().regex(/^[a-f0-9]{40}$/), migrationPlanSha256: hash, attemptId: z.string().regex(/^[A-Za-z0-9-]{1,128}$/) }).strict();
const refSchema = z.object({ path: z.string().startsWith('/etc/workspacex-cn/').refine(p => !p.split('/').includes('..')), sha256: hash }).strict();
export type FactoryRef = z.infer<typeof refSchema>;
/** Construct these consumers in source code. No JSON operation registry is read. */
export interface SourceConsumerBinding {
 identity: MaintenanceIdentity; toolRevision: string; source: TrustedExecutable; inputRefs: readonly FactoryRef[];
}
interface SourceConsumer {
 binding: SourceConsumerBinding;
 assertCapability(binding: SourceConsumerBinding): Promise<void>;
}
export interface CurrentEpochEvidence {
 schemaVersion: 1; kind: 'held-current-epoch-evidence'; identity: MaintenanceIdentity; toolRevision: string;
 holdGeneration: string; epoch: FactoryRef; databases: Record<'workspacex'|'workspacex_agent'|'workspacex_memory', FactoryRef>;
 objectRecovery: FactoryRef; beforeHeldObservationSha256: string; afterHeldObservationSha256: string;
}
export interface FactoryMigrationEvidence {
 identity: MaintenanceIdentity; toolRevision: string; holdGeneration: string; epochSha256: string; completion: FactoryRef;
}
export interface FactoryCandidateEvidence extends FactoryMigrationEvidence { reference: FactoryRef }
type Lifecycle = Pick<ReturnType<typeof createPersistentWriterLifecycle>, 'start'|'invoke'|'bindCandidateReference'|'candidateOperation'|'baselineCancellation'|'closeAfterAccepted'|'retainUnknown'>;
export interface ARouteFactoryConsumers {
 offline: SourceConsumer & { prepare(identity: MaintenanceIdentity): Promise<void> };
 prehold: SourceConsumer & { verifyRecoveryCapability(identity: MaintenanceIdentity): Promise<void>; verifyIsolatedAcceptance(identity: MaintenanceIdentity): Promise<void> };
 epoch: SourceConsumer & {
  captureAndVerify(identity: MaintenanceIdentity, host: HostBinding): Promise<CurrentEpochEvidence>;
  verifyCurrentEpochIsolatedAcceptance(identity: MaintenanceIdentity, epoch: CurrentEpochEvidence): Promise<void>;
 };
 migration: SourceConsumer & { approvedRelease?(): string; migrateExactPlan(identity: MaintenanceIdentity, epoch: CurrentEpochEvidence): Promise<FactoryMigrationEvidence> };
 heldReadback: SourceConsumer & { verify(identity: MaintenanceIdentity, epoch: CurrentEpochEvidence, completion: FactoryMigrationEvidence): Promise<void> };
 candidate: SourceConsumer & {
  stageAndSeal(identity: MaintenanceIdentity, host: HostBinding, epoch: CurrentEpochEvidence, completion: FactoryMigrationEvidence): Promise<FactoryCandidateEvidence>;
 };
 writer: SourceConsumer & { lifecycle: Lifecycle };
 public: SourceConsumer & { bindingPolicy: PublicAcceptanceBinding; transport: PublicAcceptanceTransport };
 disposition: SourceConsumer & { recordRecoveryRequired(identity: MaintenanceIdentity): Promise<void>; recordReconciliationRequired(identity: MaintenanceIdentity): Promise<void> };
}
export interface ARouteFactoryInputs {
 binding: HostBinding; toolRevision: string;
 installedFilesSha256: Readonly<Record<string,string>>;
 consumers: ARouteFactoryConsumers;
 run: CommandRunner;
 acquireReleaseLock(identity: MaintenanceIdentity): Promise<() => Promise<void>>;
 assertInstalledSource(command: TrustedExecutable): Promise<void>;
 /** Root uses protectedPrivateJson(path,sha256); this compiled read is never a plan field. */
 readEvidence(reference: FactoryRef): Promise<unknown>;
}
const methods = {
 offline: ['prepare'], prehold: ['verifyRecoveryCapability','verifyIsolatedAcceptance'],
 epoch: ['captureAndVerify','verifyCurrentEpochIsolatedAcceptance'], migration: ['migrateExactPlan'],
 heldReadback: ['verify'], candidate: ['stageAndSeal'],
 writer: [], public: [], disposition: ['recordRecoveryRequired','recordReconciliationRequired'],
} as const;
const epochSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('held-current-epoch-evidence'), identity: identitySchema, toolRevision: z.string(), holdGeneration: z.string().regex(/^[a-f0-9]{32}$/), epoch: refSchema,
 databases: z.object({workspacex:refSchema,workspacex_agent:refSchema,workspacex_memory:refSchema}).strict(), objectRecovery: refSchema,
 beforeHeldObservationSha256:hash,afterHeldObservationSha256:hash }).strict();
const completionSchema = z.object({identity:identitySchema,toolRevision:z.string(),holdGeneration:z.string(),epochSha256:hash,completion:refSchema}).strict();
const candidateSchema = completionSchema.extend({reference:refSchema}).strict();
// The native retained actor owns the complete plan schema. This boundary checks
// the exact envelope and the artifact binding before handing it to that actor.
const candidateEnvelopeSchema=z.object({schemaVersion:z.literal(1),toolRevision:z.string().regex(/^[a-f0-9]{40}$/),
 plan:z.object({identity:identitySchema,holdGeneration:z.string().regex(/^[a-f0-9]{32}$/),epoch:hash,migrationCompletionSha256:hash,artifactSha256:hash}).passthrough(),
 artifact:refSchema}).strict();
function frozen<T>(value:T):T { if(value&&typeof value==='object'){for(const item of Object.values(value))frozen(item);Object.freeze(value);}return value; }
const same = (a: unknown,b: unknown) => runtimeDigest(a) === runtimeDigest(b);
function need(value: unknown, code: string): asserts value { if(!value) throw Error(code); }
function snapshot<T extends SourceConsumer>(consumer: T, names: readonly string[]): T {
 const value:any={...consumer,binding:frozen(structuredClone(consumer.binding)),assertCapability:consumer.assertCapability.bind(consumer)};
 for(const name of names)value[name]=(consumer as any)[name].bind(consumer);
 return value;
}
/** Source-owned composition only. This factory executes admission reads, then
 * returns the existing coordinator contract; it does not install/run production. */
export async function createARouteFactory(input: ARouteFactoryInputs): Promise<ARouteOperations> {
 const missing:string[]=[];
 for(const name of ['run','acquireReleaseLock','assertInstalledSource','readEvidence'] as const)if(typeof input[name]!=='function')missing.push(name);
 for(const [group,names] of Object.entries(methods)){
  const consumer=(input.consumers as any)?.[group];
  if(!consumer?.binding)missing.push(group+'.binding');
  for(const name of ['assertCapability',...names])if(typeof consumer?.[name]!=='function')missing.push(group+'.'+name);
 }
 for(const name of ['start','invoke','bindCandidateReference','candidateOperation','baselineCancellation','closeAfterAccepted','retainUnknown'])if(typeof input.consumers?.writer?.lifecycle?.[name as keyof Lifecycle]!=='function')missing.push('writer.lifecycle.'+name);
 for(const name of ['readPublicIdentity','verifyCanonical','runBrowserSmoke','readObservation'])if(typeof (input.consumers?.public?.transport as any)?.[name]!=='function')missing.push('public.transport.'+name);
 if(!input.consumers?.public?.bindingPolicy)missing.push('public.bindingPolicy');
 if(missing.length)throw Error('A_ROUTE_FACTORY_CONSUMERS_MISSING:'+missing.sort().join(','));
 const identity=Object.freeze(identitySchema.parse(input.binding.identity));
 need(admittedReleaseIdentity(identity),'A_ROUTE_FACTORY_RELEASE_PAIR');
 const releaseReader=input.consumers.migration.approvedRelease?.bind(input.consumers.migration);
 need(typeof releaseReader==='function'||legacyCompletionRelease(identity)!==undefined,'A_ROUTE_FACTORY_RELEASE_AUTHORITY');
 if(releaseReader){const release=releaseReader();need(typeof release==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(release),'A_ROUTE_FACTORY_RELEASE_AUTHORITY');}
 need(/^[a-f0-9]{40}$/.test(input.toolRevision),'A_ROUTE_FACTORY_TOOL_REVISION');
 const toolRevision=input.toolRevision, run=input.run, acquire=input.acquireReleaseLock, assertSource=input.assertInstalledSource, readEvidence=input.readEvidence;
 const binding={...input.binding,identity,hold:Object.freeze({...input.binding.hold})};
 const c=Object.fromEntries(Object.entries(methods).map(([group,names])=>[group,snapshot((input.consumers as any)[group],names)])) as unknown as ARouteFactoryConsumers;
 // The lifecycle is compiled source, never selected by a private-plan flag.
 const actor=input.consumers.writer.lifecycle;
 const lifecycle=Object.fromEntries(['start','invoke','bindCandidateReference','candidateOperation','baselineCancellation','closeAfterAccepted','retainUnknown'].map(name=>[name,(actor as any)[name].bind(actor)])) as Lifecycle;
 need(same(c.public.bindingPolicy.identity,identity),'A_ROUTE_FACTORY_PUBLIC_IDENTITY');
 const acceptance=bindPublicAcceptance(structuredClone(c.public.bindingPolicy),c.public.transport);
 const commands=[binding.hold];
 for(const consumer of Object.values(c)){
  const b=consumer.binding;
  need(same(b.identity,identity)&&b.toolRevision===toolRevision,'A_ROUTE_FACTORY_CONSUMER_IDENTITY');
  need(b.source?.path.startsWith('/usr/local/lib/workspacex-cn/')&&!b.source.path.split('/').includes('..')&&/^[a-f0-9]{64}$/.test(b.source.sha256),'A_ROUTE_FACTORY_SOURCE_BINDING');
  need(Array.isArray(b.inputRefs)&&b.inputRefs.length>0,'A_ROUTE_FACTORY_SOURCE_INPUTS');
  b.inputRefs.forEach((ref:FactoryRef)=>refSchema.parse(ref));commands.push(b.source);
 }
 for(const command of commands)need(input.installedFilesSha256?.[command.path]===command.sha256,'A_ROUTE_FACTORY_PROFILE_BINDING');
 let host:HostBinding|undefined, epoch:CurrentEpochEvidence|undefined, epochAccepted=false, completion:FactoryMigrationEvidence|undefined;
 let candidate:FactoryCandidateEvidence|undefined, resumeIntent=false, resumed=false, lockAcquired=false;
 const id=(value:MaintenanceIdentity)=>need(same(value,identity),'A_ROUTE_FACTORY_IDENTITY_CHANGED');
 async function heldGeneration(state='held'){
  const v=JSON.parse((await run(binding.hold,['read','/var/lib/workspacex-cn/runtime'])).stdout);
  need(v.schemaVersion===1&&same(v.identity,identity)&&v.state===state&&/^[a-f0-9]{32}$/.test(v.generation),'A_ROUTE_FACTORY_HOLD_BINDING');
  return v.generation as string;
 }
 async function verifyBlocked(value:MaintenanceIdentity){
  id(value);need(host,'A_ROUTE_FACTORY_WRITER_NOT_STARTED');
  if(candidate){await lifecycle.candidateOperation(identity,'verify-blocked');await heldGeneration();return;}
  const v=JSON.parse((await lifecycle.invoke('verifyWritesBlocked',identity)).stdout), generation=await heldGeneration();
  need(v.schemaVersion===1&&v.kind==='maintenance-writers-held'&&v.ready===false&&same(v.identity,identity)&&v.holdGeneration===generation&&v.planSha256===host.writerPlanCanonicalSha256&&/^[a-f0-9]{64}$/.test(v.observationSha256)&&Number.isFinite(v.observedAt)&&Date.now()/1000-v.observedAt>=0&&Date.now()/1000-v.observedAt<=30,'A_ROUTE_FACTORY_HELD_OBSERVATION');
 }
 function migrationBinding(value:FactoryMigrationEvidence){
  need(epoch&&same(value.identity,identity)&&value.toolRevision===toolRevision&&value.holdGeneration===epoch.holdGeneration&&value.epochSha256===epoch.epoch.sha256,'A_ROUTE_FACTORY_MIGRATION_EPOCH');
  need(value.completion.path===`/etc/workspacex-cn/migration-completion-inputs/${identity.sourceRevision}/${identity.attemptId}.completed.json`,'A_ROUTE_FACTORY_COMPLETION_PATH');
 }
 const actions:ARouteHostActions={
  acquireReleaseLock:async value=>{id(value);need(!lockAcquired,'A_ROUTE_FACTORY_ATTEMPT_REUSE');const release=await acquire(identity);lockAcquired=true;return async()=>{if(host)await lifecycle.closeAfterAccepted();await release();};},
  prepareOffline:value=>{id(value);return c.offline.prepare(identity);},
  verifyPreholdRecoveryCapability:value=>{id(value);return c.prehold.verifyRecoveryCapability(identity);},
  verifyIsolatedCandidateAcceptance:value=>{id(value);return c.prehold.verifyIsolatedAcceptance(identity);},
  blockAllWrites:async value=>{id(value);if(!host)host=await lifecycle.start();need(same(host.identity,identity),'A_ROUTE_FACTORY_SEALED_HOST_IDENTITY');await lifecycle.invoke('blockAllWrites',identity);},
  verifyWritesBlocked:verifyBlocked,
  captureAndVerifyCurrentEpochRecovery:async value=>{
   id(value);need(host&&!epoch,'A_ROUTE_FACTORY_EPOCH_REBIND');await verifyBlocked(identity);const generation=await heldGeneration();
   const produced=epochSchema.parse(await c.epoch.captureAndVerify(identity,host));
   need(same(produced.identity,identity)&&produced.toolRevision===toolRevision&&produced.holdGeneration===generation,'A_ROUTE_FACTORY_EPOCH_IDENTITY');
   need(produced.epoch.path===`/etc/workspacex-cn/maintenance-evidence/${identity.sourceRevision}/${identity.attemptId}/qualified-current-epoch/epoch.json`,'A_ROUTE_FACTORY_EPOCH_PATH');
   const raw:any=await readEvidence(produced.epoch);
   const {epoch:_ref,kind:_kind,...contents}=produced;
   need(same(raw,{...contents,kind:'held-current-epoch-manifest'}),'A_ROUTE_FACTORY_EPOCH_FILE_BINDING');
   await verifyBlocked(identity);need(await heldGeneration()===generation,'A_ROUTE_FACTORY_EPOCH_HOLD_DRIFT');epoch=frozen(structuredClone(produced));
  },
  verifyCurrentEpochIsolatedCandidateAcceptance:async value=>{id(value);need(epoch,'A_ROUTE_FACTORY_EPOCH_MISSING');await c.epoch.verifyCurrentEpochIsolatedAcceptance(identity,epoch);need(await heldGeneration()===epoch.holdGeneration,'A_ROUTE_FACTORY_EPOCH_HOLD_DRIFT');epochAccepted=true;},
  migrateExactPlan:async value=>{id(value);need(epoch&&epochAccepted&&!completion,'A_ROUTE_FACTORY_EPOCH_NOT_ACCEPTED');await verifyBlocked(identity);const v=completionSchema.parse(await c.migration.migrateExactPlan(identity,epoch));migrationBinding(v);const raw:any=await readEvidence(v.completion);readNativeCompletion(raw,identity,Date.now(),releaseReader?.());completion=frozen(structuredClone(v));},
  verifyHeldCandidateReadback:async value=>{id(value);need(epoch&&completion,'A_ROUTE_FACTORY_COMPLETION_MISSING');await c.heldReadback.verify(identity,epoch,completion);await verifyBlocked(identity);},
  stageCandidateRuntime:async value=>{
   id(value);need(host&&epoch&&completion&&!candidate,'A_ROUTE_FACTORY_CANDIDATE_STAGE_ORDER');
   const v=candidateSchema.parse(await c.candidate.stageAndSeal(identity,host,epoch,completion));migrationBinding(v);
   need(same(v.completion,completion.completion)&&v.reference.path===`/etc/workspacex-cn/maintenance-candidate/${identity.sourceRevision}/${identity.attemptId}/candidate-plan.json`,'A_ROUTE_FACTORY_CANDIDATE_BINDING');
   const raw=candidateEnvelopeSchema.parse(await readEvidence(v.reference));need(raw.toolRevision===toolRevision&&same(raw.plan.identity,identity)&&raw.plan.holdGeneration===epoch.holdGeneration&&raw.plan.epoch===epoch.epoch.sha256&&raw.plan.migrationCompletionSha256===completion.completion.sha256&&raw.artifact.sha256===raw.plan.artifactSha256,'A_ROUTE_FACTORY_CANDIDATE_FILE_BINDING');
   await lifecycle.bindCandidateReference(identity,v.reference);candidate=frozen(structuredClone(v));
  },
  verifyCandidateRuntimeIdentity:async value=>{id(value);need(candidate,'A_ROUTE_FACTORY_CANDIDATE_UNBOUND');await lifecycle.candidateOperation(identity,'verify-staging');},
  persistCandidateResumeIntent:async value=>{id(value);need(candidate&&!resumeIntent,'A_ROUTE_FACTORY_RESUME_INTENT_ORDER');await lifecycle.candidateOperation(identity,'prepare-resume-intent');resumeIntent=true;},
  resumeExactCandidateWriters:async value=>{id(value);need(candidate&&resumeIntent,'A_ROUTE_FACTORY_RESUME_WITHOUT_INTENT');await lifecycle.candidateOperation(identity,'resume');},
  verifyCandidateWritersResumed:async value=>{id(value);need(candidate&&resumeIntent,'A_ROUTE_FACTORY_RESUME_WITHOUT_INTENT');await lifecycle.candidateOperation(identity,'verify-resumed');resumed=true;},
  verifyPublicAcceptance:async value=>{id(value);need(resumed,'A_ROUTE_FACTORY_PUBLIC_BEFORE_RESUME');await acceptance.verifyPublicAcceptance(identity);},
  observeOpenedCandidate:async value=>{id(value);need(resumed&&epoch,'A_ROUTE_FACTORY_PUBLIC_BEFORE_RESUME');need(await heldGeneration('cleared')===epoch.holdGeneration,'A_ROUTE_FACTORY_OPEN_HOLD_DRIFT');await lifecycle.candidateOperation(identity,'observe-opened');await acceptance.observeOpenedCandidate(identity);await lifecycle.candidateOperation(identity,'observe-opened');},
  blockCandidateWriters:async value=>{id(value);need(candidate,'A_ROUTE_FACTORY_CANDIDATE_UNBOUND');await lifecycle.candidateOperation(identity,'rebind-held-epoch-for-reblock');await lifecycle.candidateOperation(identity,'block');await lifecycle.candidateOperation(identity,'verify-blocked');},
  verifyNoMigrationCommitted:value=>{id(value);return lifecycle.baselineCancellation(identity,'verify-no-migration');},
  resumeUnchangedBaselineCancellation:value=>{id(value);return lifecycle.baselineCancellation(identity,'resume-baseline');},
  verifyBaselineCancellation:value=>{id(value);return lifecycle.baselineCancellation(identity,'verify-baseline');},
  recordRecoveryRequired:async value=>{id(value);try{await c.disposition.recordRecoveryRequired(identity);}finally{lifecycle.retainUnknown();}},
  recordReconciliationRequired:async value=>{id(value);try{await c.disposition.recordReconciliationRequired(identity);}finally{lifecycle.retainUnknown();}},
 };
 return bindARouteHostOperations({binding,actions,run,assertProtectedInputs:async()=>{
  for(const command of commands)await assertSource(command);
  for(const consumer of Object.values(c))await consumer.assertCapability(consumer.binding);
 }});
}
