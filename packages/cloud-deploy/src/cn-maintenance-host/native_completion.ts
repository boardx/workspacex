import {createHash} from 'node:crypto';
import {admittedReleaseIdentity} from './release_identity';
import {assertSourcePlanAuthority,type OriginalPlanAuthority} from './source_plan_authority';
import {protectedPrivateBytes} from './fixed_transport';
import {z} from 'zod';
import type {MaintenanceIdentity} from '../cn-maintenance-release';
const hash=z.string().regex(/^[a-f0-9]{64}$/),stamp=z.string().datetime();
export const nativeCompletionSchema=z.object({schemaVersion:z.literal(1),scope:z.literal('validated-production-migration-completion'),
 sourceRevision:z.string().regex(/^[a-f0-9]{40}$/),baselineRevision:z.string().regex(/^[a-f0-9]{40}$/),attemptId:z.string(),release:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
 originalPlanSha256:hash,completionPlanSha256:hash,sourceInventorySha256:hash,sourceBindingSha256:hash,snapshotSha256:hash,fullResponseSha256:hash,ledgerSha256:hash,
 appliedSqlCount:z.number().int().nonnegative().safe(),pendingCount:z.literal(0),driftCount:z.literal(0),unknownAppliedCount:z.literal(0),
 capturedAt:stamp,providerFinishedAt:stamp,expiresAt:stamp,productionMutationAuthorized:z.literal(false)}).strict();
/** Consume the existing native witness, preserving its provider/source hashes.
 * This does not replace the source verifier or the retained live-ledger check. */
export function readNativeCompletion(value:unknown,identity:MaintenanceIdentity,now=Date.now(),expectedRelease?:string){
 const v=nativeCompletionSchema.parse(value);
 if(!admittedReleaseIdentity(identity))throw Error('NATIVE_COMPLETION_RELEASE_PAIR');
 const release=expectedRelease??legacyCompletionRelease(identity);
 if(typeof release!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(release)||v.release!==release)throw Error('NATIVE_COMPLETION_RELEASE_AUTHORITY');
 if(v.sourceRevision!==identity.sourceRevision||v.baselineRevision!==identity.baselineRevision||v.attemptId!==identity.attemptId||v.originalPlanSha256!==identity.migrationPlanSha256)throw Error('NATIVE_COMPLETION_IDENTITY');
 const captured=Date.parse(v.capturedAt),finished=Date.parse(v.providerFinishedAt),expires=Date.parse(v.expiresAt);
 if(!Number.isFinite(now)||[captured,finished].some(t=>t>now||now-t>=3600000)||expires<=now||expires>Math.min(captured,finished)+3600000||expires<=Math.max(captured,finished))throw Error('NATIVE_COMPLETION_FRESHNESS');
 return v;
}

/** Compatibility is confined to the historic admitted pair. */
export function legacyCompletionRelease(identity:MaintenanceIdentity):string|undefined {
 return admittedReleaseIdentity(identity)&&identity.sourceRevision==='9b25bfa65662b96c0826fe67506b562ea46aa6d0'?'2026.10.3-cn.1':undefined;
}
/** Read release from independent root-profile pins, never the completion body.
 * readBytes is a compiled fixture seam; no JSON input can supply this callback. */
export function readApprovedCompletionRelease(authority:OriginalPlanAuthority,readBytes:typeof protectedPrivateBytes=protectedPrivateBytes):string {
 assertSourcePlanAuthority(authority,authority.identity,authority.toolRevision);
 const legacy=legacyCompletionRelease(authority.identity);
 if(legacy!==undefined)return legacy;
 const profilePath='/etc/workspacex-cn/trusted-tool-binding.json',profileRaw=readBytes(profilePath);
 const profile=JSON.parse(profileRaw.toString('utf8')),entry=profile.candidateComposeEmitter;
 if(profile.toolRevision!==authority.toolRevision||profile.originalWriterPlan?.path!==authority.sourcePlanPath||profile.originalWriterPlan?.sha256!==authority.sourcePlanSha256||!entry)throw Error('NATIVE_COMPLETION_ROOT_RELEASE');
 const reads:Array<{path:string;sha256:string;raw:Buffer}>=[];
 const pinned=(ref:any)=>{
  if(!ref||Object.keys(ref).sort().join(',')!=='path,sha256'||typeof ref.path!=='string'||!ref.path.startsWith('/etc/workspacex-cn/')||ref.path.split('/').includes('..')||typeof ref.sha256!=='string'||!/^[a-f0-9]{64}$/.test(ref.sha256))throw Error('NATIVE_COMPLETION_RELEASE_REF');
  const raw=readBytes(ref.path,ref.sha256);
  if(createHash('sha256').update(raw).digest('hex')!==ref.sha256)throw Error('NATIVE_COMPLETION_RELEASE_PIN');
  reads.push({...ref,raw});return JSON.parse(raw.toString('utf8'));
 };
 const options=pinned(entry.optionsRef),manifest=pinned(options.manifestRef),config=pinned(entry.configRef);
 if(manifest.sourceRevision!==authority.identity.sourceRevision||typeof manifest.release!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(manifest.release)||config.provision?.release!==manifest.release)throw Error('NATIVE_COMPLETION_RELEASE_BINDING');
 for(const r of reads)if(!readBytes(r.path,r.sha256).equals(r.raw))throw Error('NATIVE_COMPLETION_RELEASE_DRIFT');
 if(!readBytes(profilePath).equals(profileRaw))throw Error('NATIVE_COMPLETION_PROFILE_DRIFT');
 assertSourcePlanAuthority(authority,authority.identity,authority.toolRevision);
 return manifest.release;
}
