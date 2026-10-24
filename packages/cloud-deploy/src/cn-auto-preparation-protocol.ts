/** Host provider protocol, v1.
 * The root driver executes fixed, source-pinned commands under the canonical
 * release lock. It must private/no-follow read raw artifacts, verify referenced
 * ciphertext/content bytes, and install envelopes create-once, mode 0600.
 * Envelopes attest completed operations, never dispatch success. Child backup
 * and isolated UUID attempts are explicitly mapped to this parent identity.
 * backup.facts: childAttemptId, original BackupHost receipt, ciphertextsVerified.
 * restoreIsolated.facts: productionTargetUsed=false, restoredBackupSha256,
 * dataFidelityVerified, pendingMigrationCount=0.
 * shadowReadiness.facts: productionTargetUsed=false, runtimeSourceShas,
 * runtimeImages (all four immutable digests), allServicesReady, durableConfig
 * measured from the actual canonical rendering (three profile booleans and both
 * CopilotKit timeout values, each exactly 3600).
 * shadowBusiness.facts: productionTargetUsed=false, browser={loginPassed,authenticatedNotificationsPassed,
 * sourceRuntimeVerified}, all true and backed by the existing real browser probe.
 * cleanupIsolated.facts: ownedProcessesJoined, ownedContainersAbsent,
 * ownedDatabasesAbsent, ownedCredentialsAbsent, productionResourcesChanged=false.
 * Restore/readiness/business/cleanup also carry facts.isolatedTarget:
 * {targetId,endpointSha256,databases:[three distinct database names]}. All must
 * match the actual restored target. The host independently proves that this
 * endpoint/database set is isolated from production before issuing an envelope.
 * Each stage repeats the exact request dependencies, attaches raw producer refs,
 * and expires within one hour. No shell stdout 'passed' is an envelope.
 * preflight evidence/validation are the existing root verifier's *.json and
 * *.validated.json; its Python validator remains the metadata policy authority.
 * The builder is a composition/validation library, not a privilege boundary.
 */
import { z } from 'zod';
const hash=z.string().regex(/^[a-f0-9]{64}$/),sha=z.string().regex(/^[a-f0-9]{40}$/);
export const autoIdentitySchema=z.object({sourceRevision:sha,baselineSourceRevision:sha,baselineSha256:hash,release:z.string().regex(/^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/),attemptId:z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/)}).strict();
export type AutoIdentity=z.infer<typeof autoIdentitySchema>;
const images=z.object({api:z.string().regex(/^sha256:[a-f0-9]{64}$/),web:z.string().regex(/^sha256:[a-f0-9]{64}$/),agent:z.string().regex(/^sha256:[a-f0-9]{64}$/),sandbox:z.string().regex(/^sha256:[a-f0-9]{64}$/)}).strict();
export const stageEnvelopeSchema=z.object({schemaVersion:z.literal(1),kind:z.literal('cn-auto-preparation-stage'),stage:z.enum(['backup','restoreIsolated','shadowReadiness','shadowBusiness','cleanupIsolated']),identity:autoIdentitySchema,images,migrationPlanSha256:hash,dependencies:z.record(hash),issuedAt:z.string().datetime(),expiresAt:z.string().datetime(),refs:z.array(z.object({path:z.string(),sha256:hash}).strict()),facts:z.record(z.unknown())}).strict();
export interface ProtectedRaw {path:string;sha256:string;bytes:Uint8Array}
export interface AutoPreparationInput {identity:AutoIdentity;manifest:ProtectedRaw;seal:ProtectedRaw;migrationPlan:ProtectedRaw;prebuild:{evidence:ProtectedRaw;validation:ProtectedRaw};preactivate?:{evidence:ProtectedRaw;validation:ProtectedRaw}}
export interface StageRequest {identity:AutoIdentity;images:Record<string,string>;migrationPlanSha256:string;dependencies:Record<string,string>}
export type AutoStage=z.infer<typeof stageEnvelopeSchema>['stage'];
export type AutoPreparationActions=Record<AutoStage,(request:StageRequest)=>Promise<ProtectedRaw>> & {collectPreactivate?:()=>Promise<{evidence:ProtectedRaw;validation:ProtectedRaw}>};
