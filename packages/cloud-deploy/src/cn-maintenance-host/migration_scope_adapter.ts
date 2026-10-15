/** Fixed source adapter for an explicitly approved additive release policy.
 * This is an admission guard, not a DDL executor or a durable dispatch journal.
 * The canonical A-route owns the release lock and original mutation intents.
 */
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {assertSourcePlanAuthority,type OriginalPlanAuthority} from './source_plan_authority';
import {protectedPrivateBytes} from './fixed_transport';
import {runtimeDigest} from './sealed_runtime';
import type {CurrentEpochEvidence} from './a_route_factory';

const hash=z.string().regex(/^[a-f0-9]{64}$/), revision=z.string().regex(/^[a-f0-9]{40}$/);
const ref=z.object({path:z.string(),sha256:hash}).strict();
const identity=z.object({sourceRevision:revision,baselineRevision:revision,migrationPlanSha256:hash,attemptId:z.string().regex(/^[A-Za-z0-9-]{1,128}$/)}).strict();
const scope='cn-reviewed-additive-migration-v1';
const policySchema=z.object({schemaVersion:z.literal(1),scope:z.literal(scope),mode:z.literal('additive'),identity,
 toolRevision:revision,preparedManifestSha256:hash,consumerInputsSha256:hash,codeFiles:z.record(hash),
 target:z.object({accountId:z.string().min(1),regionId:z.string().min(1),dbInstanceId:z.string().min(1),ecsInstanceId:z.string().min(1)}).strict(),
 imageDigests:z.object({api:hash,web:hash,agent:hash,sandbox:hash,postgres:hash}).strict(),
 issuedAt:z.string().datetime(),expiresAt:z.string().datetime(),
 conditions:z.object({qualifiedCurrentEpoch:z.literal(true),sameHoldGeneration:z.literal(true),
  canonicalCompletionBeforeResume:z.literal(true),noOldDumpAfterResume:z.literal(true)}).strict()}).strict();
const need=(value:unknown,code:string)=>{if(!value)throw Error(code);};
const sha=(raw:Buffer)=>createHash('sha256').update(raw).digest('hex');
const issued=new WeakMap<object,{check:(phase:'before-ddl'|'before-resume',epoch:CurrentEpochEvidence)=>void}>();
export interface MigrationScopeAdmission {readonly kind:'root-additive-migration-admission-v1';}
export interface MigrationScopeInputs {preparedManifest:Buffer;consumerInputsSha256:string;codeFiles:Readonly<Record<string,string>>;target:{accountId:string;regionId:string;dbInstanceId:string;ecsInstanceId:string};}

/** Absence preserves the historical canonical path. A new-scope launcher must
 * separately require this guard; an old runtime grant cannot select new scope. */
export function optionalMigrationScopeAdmission(authority:OriginalPlanAuthority,inputs:MigrationScopeInputs,
 read:typeof protectedPrivateBytes=protectedPrivateBytes,now:()=>number=Date.now):MigrationScopeAdmission|undefined {
 assertSourcePlanAuthority(authority,authority.identity,authority.toolRevision);
 const rawDescriptor=authority.sourcePlan.releaseContinuation;
 if(rawDescriptor===undefined)return undefined;
 need(typeof authority.sourcePlan.host?.instanceId==='string'&&inputs.target.ecsInstanceId===authority.sourcePlan.host.instanceId,'MIGRATION_SCOPE_HOST_BINDING');
 const descriptor=z.object({scope:z.literal(scope),policy:ref}).strict().parse(rawDescriptor);
 need(descriptor.policy.path===`/etc/workspacex-cn/maintenance-host/${authority.identity.sourceRevision}/${authority.identity.attemptId}/migration-policy.json`,'MIGRATION_SCOPE_POLICY_PATH');
 const manifest=JSON.parse(inputs.preparedManifest.toString('utf8'));
 const images=Object.fromEntries(['api','web','agent','sandbox','postgres'].map(name=>{
  const image=manifest.images?.[name]?.image;
  need(typeof image==='string'&&/@sha256:[a-f0-9]{64}$/.test(image),'MIGRATION_SCOPE_IMAGE_DIGEST');
  return [name,image.slice(-64)];
 }));
 let epochBinding:string|undefined;
 const validate=()=>{
  assertSourcePlanAuthority(authority,authority.identity,authority.toolRevision);
  const raw=read(descriptor.policy.path,descriptor.policy.sha256);need(sha(raw)===descriptor.policy.sha256,'MIGRATION_SCOPE_POLICY_CHANGED');
  const p=policySchema.parse(JSON.parse(raw.toString('utf8'))),clock=now();
  need(runtimeDigest(p.identity)===runtimeDigest(authority.identity)&&p.toolRevision===authority.toolRevision,'MIGRATION_SCOPE_IDENTITY');
  need(/^[a-f0-9]{64}$/.test(inputs.codeFiles['packages/cloud-deploy/src/cn-maintenance-host/migration_scope_adapter.ts']??'')&&runtimeDigest(p.codeFiles)===runtimeDigest(inputs.codeFiles),'MIGRATION_SCOPE_CODE_CLOSURE');
  need(p.preparedManifestSha256===sha(inputs.preparedManifest)&&p.consumerInputsSha256===inputs.consumerInputsSha256&&runtimeDigest(p.imageDigests)===runtimeDigest(images)&&runtimeDigest(p.target)===runtimeDigest(inputs.target),'MIGRATION_SCOPE_INPUTS');
  const start=Date.parse(p.issuedAt),end=Date.parse(p.expiresAt);
  need(Number.isFinite(clock)&&start<=clock&&clock<end&&end>start&&end-start<=1800000,'MIGRATION_SCOPE_EXPIRED');
  assertSourcePlanAuthority(authority,authority.identity,authority.toolRevision);
 };
 validate();
 const result=Object.freeze({kind:'root-additive-migration-admission-v1' as const});
 issued.set(result,{check:(phase,epoch)=>{
  validate();
  need(epoch.kind==='held-current-epoch-evidence'&&epoch.schemaVersion===1&&runtimeDigest(epoch.identity)===runtimeDigest(authority.identity)&&epoch.toolRevision===authority.toolRevision&&/^[a-f0-9]{32}$/.test(epoch.holdGeneration)&&/^[a-f0-9]{64}$/.test(epoch.epoch.sha256),'MIGRATION_SCOPE_EPOCH');
  const current=runtimeDigest(epoch);
  if(phase==='before-ddl'){need(epochBinding===undefined,'MIGRATION_SCOPE_DDL_REENTRY');epochBinding=current;}
  else need(epochBinding===current,'MIGRATION_SCOPE_EPOCH_DRIFT');
 }});
 return result;
}
export function assertMigrationScopeAdmission(value:MigrationScopeAdmission):void {
 need(issued.has(value),'MIGRATION_SCOPE_CAPABILITY_REQUIRED');
}
export function checkMigrationScopeAdmission(value:MigrationScopeAdmission,phase:'before-ddl'|'before-resume',epoch:CurrentEpochEvidence):void {
 need(issued.has(value),'MIGRATION_SCOPE_CAPABILITY_REQUIRED');
 need(phase==='before-ddl'||phase==='before-resume','MIGRATION_SCOPE_PHASE');
 issued.get(value)!.check(phase,epoch);
}
