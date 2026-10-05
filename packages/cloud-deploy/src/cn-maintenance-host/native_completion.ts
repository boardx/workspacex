import {z} from 'zod';
import type {MaintenanceIdentity} from '../cn-maintenance-release';
const hash=z.string().regex(/^[a-f0-9]{64}$/),stamp=z.string().datetime();
export const nativeCompletionSchema=z.object({schemaVersion:z.literal(1),scope:z.literal('validated-production-migration-completion'),
 sourceRevision:z.string().regex(/^[a-f0-9]{40}$/),baselineRevision:z.string().regex(/^[a-f0-9]{40}$/),attemptId:z.string(),release:z.literal('2026.10.3-cn.1'),
 originalPlanSha256:hash,completionPlanSha256:hash,sourceInventorySha256:hash,sourceBindingSha256:hash,snapshotSha256:hash,fullResponseSha256:hash,ledgerSha256:hash,
 appliedSqlCount:z.number().int().nonnegative().safe(),pendingCount:z.literal(0),driftCount:z.literal(0),unknownAppliedCount:z.literal(0),
 capturedAt:stamp,providerFinishedAt:stamp,expiresAt:stamp,productionMutationAuthorized:z.literal(false)}).strict();
/** Consume the existing native witness, preserving its provider/source hashes.
 * This does not replace the source verifier or the retained live-ledger check. */
export function readNativeCompletion(value:unknown,identity:MaintenanceIdentity,now=Date.now()){
 const v=nativeCompletionSchema.parse(value);
 if(v.sourceRevision!==identity.sourceRevision||v.baselineRevision!==identity.baselineRevision||v.attemptId!==identity.attemptId||v.originalPlanSha256!==identity.migrationPlanSha256)throw Error('NATIVE_COMPLETION_IDENTITY');
 const captured=Date.parse(v.capturedAt),finished=Date.parse(v.providerFinishedAt),expires=Date.parse(v.expiresAt);
 if(!Number.isFinite(now)||[captured,finished].some(t=>t>now||now-t>=3600000)||expires<=now||expires>Math.min(captured,finished)+3600000||expires<=Math.max(captured,finished))throw Error('NATIVE_COMPLETION_FRESHNESS');
 return v;
}
