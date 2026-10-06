/** Original protected writer-plan authority. Raw file identity is distinct from canonical runtime digests. */
import {createHash} from 'node:crypto';
import type {MaintenanceIdentity} from '../cn-maintenance-release';
import type {HostBinding} from './controller';
import {protectedPrivateBytes} from './fixed_transport';
import {runtimeDigest} from './sealed_runtime';
const issued=new WeakMap<object,()=>void>();
const need=(v:unknown,c:string):void=>{if(!v)throw Error(c);};
const rawHash=(raw:Buffer)=>createHash('sha256').update(raw).digest('hex');
export interface OriginalPlanAuthority {
 readonly identity:MaintenanceIdentity;readonly toolRevision:string;
 readonly sourcePlanPath:string;readonly sourcePlanSha256:string;readonly sourcePlanCanonicalSha256:string;
 readonly sourcePlan:Readonly<Record<string,any>>;
}
export function readOriginalPlanAuthority(host:HostBinding,tool:string,profile:any,readBytes:typeof protectedPrivateBytes=protectedPrivateBytes):OriginalPlanAuthority {
 const path=host.writerPlanPath,pin=host.writerPlanSha256;
 need(profile.originalWriterPlan&&Object.keys(profile.originalWriterPlan).sort().join(',')==='path,sha256'&&profile.originalWriterPlan.path===path&&profile.originalWriterPlan.sha256===pin,'ORIGINAL_PLAN_PROFILE_REF');
 need(path.startsWith('/etc/workspacex-cn/')&&!path.split('/').includes('..')&&/^[a-f0-9]{64}$/.test(pin)&&/^[a-f0-9]{40}$/.test(tool),'ORIGINAL_PLAN_REF');
 const source=JSON.parse(readBytes(path,pin).toString('utf8'));
 const identity=source.identity;
 need(source.schemaVersion===1&&source.mode==='maintenance-all-writer-fence'&&source.productionActionsAuthorized===true&&source.runtimeSessionBootstrapAuthorized===true&&!['runtimeSourcePlanSha256','runtimePlan','controlSessions','diagnosticSessions'].some(k=>k in source),'ORIGINAL_PLAN_SCHEMA');
 need(identity&&Object.keys(identity).sort().join(',')==='attemptId,baselineRevision,migrationPlanSha256,sourceRevision'&&/^[a-f0-9]{40}$/.test(identity.sourceRevision)&&identity.baselineRevision==='ba6343199f3c834d6a198f83d0c771614292c82b'&&/^[a-f0-9]{64}$/.test(identity.migrationPlanSha256)&&/^[A-Za-z0-9-]{1,128}$/.test(identity.attemptId)&&runtimeDigest(identity)===runtimeDigest(host.identity)&&source.toolRevision===tool&&profile.toolRevision===tool,'ORIGINAL_PLAN_IDENTITY');
 const capability=profile.maintenanceSourceOperations;
 need(capability?.schemaVersion===1&&capability.sourcePath==='.harness/scripts/vm/maintenance_source_operations.py'&&/^[a-f0-9]{64}$/.test(capability.sha256)&&profile.filesSha256?.[capability.sourcePath]===capability.sha256&&profile.installedFilesSha256?.['/usr/local/lib/workspacex-cn/maintenance_source_operations.py']===capability.sha256,'ORIGINAL_PLAN_SOURCE_CAPABILITY');
 for(const command of [host.hold,host.writerFence])need(profile.installedFilesSha256?.[command.path]===command.sha256,'ORIGINAL_PLAN_HOST_PIN');
 const profilePin=runtimeDigest(profile),raw=readBytes(path,pin);
 need(runtimeDigest(JSON.parse(readBytes('/etc/workspacex-cn/trusted-tool-binding.json').toString('utf8')))===profilePin,'ORIGINAL_PLAN_PROFILE_PROVENANCE');
 need(rawHash(raw)===pin&&runtimeDigest(JSON.parse(raw.toString('utf8')))===runtimeDigest(source),'ORIGINAL_PLAN_RAW');
 need(host.writerPlanCanonicalSha256===runtimeDigest(source),'ORIGINAL_PLAN_CANONICAL_BINDING');
 const freeze=(v:any):any=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
 const result=freeze({identity:{...identity},toolRevision:tool,sourcePlanPath:path,sourcePlanSha256:pin,sourcePlanCanonicalSha256:runtimeDigest(source),sourcePlan:source});
 issued.set(result,()=>{need(runtimeDigest(profile)===profilePin&&runtimeDigest(JSON.parse(readBytes('/etc/workspacex-cn/trusted-tool-binding.json').toString('utf8')))===profilePin,'ORIGINAL_PLAN_AUTHORITY_DRIFT');need(rawHash(readBytes(path,pin))===pin,'ORIGINAL_PLAN_RAW_DRIFT');});
 return result;
}
export function assertSourcePlanAuthority(authority:OriginalPlanAuthority|undefined,identity:MaintenanceIdentity,tool:string):asserts authority is OriginalPlanAuthority {
 need(authority&&issued.has(authority),'ORIGINAL_PLAN_AUTHORITY_REQUIRED');
 need(runtimeDigest(authority!.identity)===runtimeDigest(identity)&&authority!.toolRevision===tool,'ORIGINAL_PLAN_EXPECTED_IDENTITY');
 issued.get(authority!)!();
}
/** Prior attempts are admitted only by a complete archive policy sealed in the original plan. */
export function assertPreholdArchiveAuthority(authority:OriginalPlanAuthority|undefined,policy:{binding:{identity:MaintenanceIdentity;toolRevision:string};input:unknown;sourcePolicy:unknown;outputRoot:string}):void {
 need(authority&&issued.has(authority),'ORIGINAL_PLAN_AUTHORITY_REQUIRED');
 assertSourcePlanAuthority(authority,authority!.identity,authority!.toolRevision);
 if(runtimeDigest(policy.binding.identity)===runtimeDigest(authority!.identity)&&policy.binding.toolRevision===authority!.toolRevision)return;
 need(policy.binding.toolRevision===authority!.toolRevision&&['sourceRevision','baselineRevision','migrationPlanSha256'].every(k=>(policy.binding.identity as any)[k]===(authority!.identity as any)[k]),'PREHOLD_ARCHIVE_CURRENT_SCOPE');
 const approved=authority!.sourcePlan.preholdArchivePolicy;
 need(approved&&typeof approved==='object'&&!Array.isArray(approved)&&Object.keys(approved).sort().join(',')==='binding,input,outputRoot,sourcePolicy','PREHOLD_ARCHIVE_POLICY_REQUIRED');
 const actual={binding:policy.binding,input:policy.input,sourcePolicy:policy.sourcePolicy,outputRoot:policy.outputRoot};
 need(runtimeDigest(approved)===runtimeDigest(actual),'PREHOLD_ARCHIVE_POLICY_BINDING');
}
