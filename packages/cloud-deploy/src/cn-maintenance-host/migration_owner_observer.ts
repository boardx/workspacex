import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {EntryPlan} from './entry';
import {protectedPrivateBytes} from './fixed_transport';
import {readOriginalPlanAuthority} from './source_plan_authority';
import {readApprovedCompletionRelease} from './native_completion';
import {sourceConsumerSchema} from './source_production_consumers';
import {migrationSourceSchema} from '../cn-migration-source-identity';
import {optionalMigrationScopeAdmission} from './migration_scope_adapter';
import {verifyOwnerTerminal,ownerDescriptorSchema,ownerStartedSchema,ownerClaimSchema} from './migration_owner_terminal';
const hash=z.string().regex(/^[a-f0-9]{64}$/),sha=(raw:Buffer)=>createHash('sha256').update(raw).digest('hex');
const need=(ok:unknown,code:string)=>{if(!ok)throw Error(code);};
/** Fixed readonly observer. Reads original authority/policy/receipts, never
 * acquires/releases FD9, starts a unit or replays a maintenance operation. */
export async function observeInstalledMigrationOwner(plan:EntryPlan,profile:any,read:typeof protectedPrivateBytes=protectedPrivateBytes){
 const authority=readOriginalPlanAuthority(plan.host,plan.production.toolRevision,profile,read);
 const inputs=sourceConsumerSchema.parse(JSON.parse(read(plan.consumerInputsPath,plan.consumerInputsSha256).toString('utf8')));
 const migration=JSON.parse(read(inputs.migration.inputs.path,inputs.migration.inputs.sha256).toString('utf8'));
 const productionSource=migrationSourceSchema.parse(migration.expectedCompletion?.productionSource);
 const guard=optionalMigrationScopeAdmission(authority,{preparedManifest:read(inputs.prepared.manifest.path,inputs.prepared.manifest.sha256),consumerInputsSha256:plan.consumerInputsSha256,codeFiles:profile.filesSha256,target:{accountId:productionSource.accountId,regionId:productionSource.regionId,dbInstanceId:productionSource.dbInstanceId,ecsInstanceId:authority.sourcePlan.host?.instanceId}},read);
 need(guard!==undefined,'OWNER_OBSERVER_MIGRATION_SCOPE_REQUIRED');
 const descriptor=ownerDescriptorSchema.parse(profile.maintenanceMigrationOwner);
 need(descriptor.originalPlanSha256===authority.sourcePlanSha256,'OWNER_OBSERVER_DESCRIPTOR');
 const root='/var/lib/workspacex-cn/migration-owner/'+descriptor.releaseSha256;
 const claim=read(root+'/claim.json'),started=read(root+'/started.json'),sealRaw=read(root+'/terminal-seal.json');
 const seal=z.object({schemaVersion:z.literal(1),claimSha256:hash,startedSha256:hash,terminalSha256:hash,terminalBytes:z.number().int().positive().max(1048576)}).strict().parse(JSON.parse(sealRaw.toString('utf8')));
 need(seal.claimSha256===sha(claim)&&seal.startedSha256===sha(started),'OWNER_OBSERVER_SEAL_BINDING');
 const claimValue=ownerClaimSchema.parse(JSON.parse(claim.toString('utf8'))),startedValue=ownerStartedSchema.parse(JSON.parse(started.toString('utf8')));
 need(claimValue.unit===`workspacex-cn-migration@${descriptor.releaseSha256}.service`,'OWNER_OBSERVER_UNIT');
 need(claimValue.releaseSha256===descriptor.releaseSha256&&claimValue.planSha256===authority.sourcePlanSha256&&startedValue.claimSha256===sha(claim),'OWNER_OBSERVER_ORIGINAL_CLAIM');
 const raw=read(root+'/terminal.json',seal.terminalSha256);need(raw.length===seal.terminalBytes,'OWNER_OBSERVER_LENGTH');
 const result=await verifyOwnerTerminal(authority,raw,seal.terminalSha256,{identity:authority.identity,...inputs.publicPolicy},readApprovedCompletionRelease(authority,read),read);
 for(const [name,original] of [['claim.json',claim],['started.json',started],['terminal-seal.json',sealRaw]] as const)need(read(root+'/'+name).equals(original),'OWNER_OBSERVER_DRIFT');
 return {...result,claimSha256:sha(claim),startedSha256:sha(started)};
}
