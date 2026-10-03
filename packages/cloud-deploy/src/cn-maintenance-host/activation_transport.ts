import { z } from 'zod';
import { createHash } from 'node:crypto';
import { preparedCnReleaseSchema, type ActivationActions } from '../cn-fast-safe-release';
import { validateReleaseManifest } from '../release';
import type { MaintenanceIdentity } from '../cn-maintenance-release';
import { runFixedPython, type CommandRunner, type TrustedExecutable } from './fixed_transport';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const identitySchema=z.object({sourceRevision:z.string().regex(/^[a-f0-9]{40}$/),baselineRevision:z.string().regex(/^[a-f0-9]{40}$/),migrationPlanSha256:hash,attemptId:z.string().regex(/^[A-Za-z0-9-]{1,128}$/)}).strict();
/** Independent maintenance contract. Never relabel destructive SQL compatible. */
const receiptSchema=z.object({
 prepared:preparedCnReleaseSchema.innerType(),
 maintenance:z.object({identity:identitySchema,toolRevision:z.string().regex(/^[a-f0-9]{40}$/),recoveryEvidenceSha256:hash,objectRecoveryEvidenceSha256:hash,writerPlanSha256:hash,migrationCompletionSha256:hash,
 authorization:z.object({identity:identitySchema,action:z.literal('maintenance-destructive-activation'),notBefore:z.string().datetime(),expiresAt:z.string().datetime()}).strict()}).strict(),
}).strict();
const equal=(a:MaintenanceIdentity,b:MaintenanceIdentity)=>Object.keys(a).length===4&&(['sourceRevision','baselineRevision','migrationPlanSha256','attemptId'] as const).every(k=>a[k]===b[k]);
export function validateMaintenancePrepared(input:unknown,identity:MaintenanceIdentity,now=new Date()) {
 const r=receiptSchema.parse(input),p=r.prepared,m=r.maintenance,a=m.authorization;
 if(!equal(m.identity,identity)||!equal(a.identity,identity)||p.sourceRevision!==identity.sourceRevision||p.baselineSourceRevision!==identity.baselineRevision||p.migrationPlanSha256!==identity.migrationPlanSha256||p.checks.migrationAssessed.evidenceSha256!==identity.migrationPlanSha256)throw Error('MAINTENANCE_PREPARED_IDENTITY_MISMATCH');
 if(p.diff.migrationRisk!=='destructive'||p.diff.pendingMigrationCount<1||p.failures.length)throw Error('MAINTENANCE_RISK_ASSESSMENT_REQUIRED');
 const start=Date.parse(p.preparedAt),end=Date.parse(p.expiresAt),before=Date.parse(a.notBefore),expires=Date.parse(a.expiresAt);
 if(end<=start||end-start>7*86400000||now.getTime()<start||now.getTime()>=end||expires<=before||expires-before>3600000||now.getTime()<before||now.getTime()>=expires)throw Error('MAINTENANCE_AUTHORIZATION_EXPIRED');
 return r;
}
export function maintenanceOfflinePreparedAction(input:unknown,bytes:Buffer,verifyOfflineArtifacts:()=>Promise<void>){
 return async(identity:MaintenanceIdentity)=>{
  const {prepared:p}=validateMaintenancePrepared(input,identity);
  const manifest=validateReleaseManifest(JSON.parse(bytes.toString('utf8')));
  if(manifest.sourceRevision!==identity.sourceRevision||createHash('sha256').update(bytes).digest('hex')!==p.manifestSha256)throw Error('MAINTENANCE_MANIFEST_MISMATCH');
  for(const service of ['web','api','agent','sandbox'] as const)if(manifest.images[service].image.split('@').at(-1)!==p.images[service])throw Error('MAINTENANCE_IMAGE_MISMATCH');
  await verifyOfflineArtifacts();
 };
}
/** Maintenance keeps its hold throughout acceptance and baseline DB recovery. */
export function maintenanceActivationAction(input:unknown,actions:ActivationActions,now?:()=>Date){
 return async(identity:MaintenanceIdentity)=>{
  assertMaintenanceActivationCapability();
  const {prepared:p}=validateMaintenancePrepared(input,identity,now?.());
  if(await actions.readBaselineFingerprint()!==p.baselineSha256)throw Error('BASELINE_CAS_MISMATCH');
  const drain=await actions.drainRuns();if([drain.queued,drain.running,drain.writebackPending].some(v=>!Number.isSafeInteger(v)||v!==0))throw Error('RUN_DRAIN_INCOMPLETE');
  let promotionAttempted=false;
  try{
   // A command can partially mutate before failing: rollback cannot depend on its response.
   promotionAttempted=true;await actions.promotePreparedPointer();await actions.activateTraffic();
   const c=await actions.verifyCanonical();if(c.status!=='passed'||c.lockRetained!==true||c.passedStages!==8)throw Error('MAINTENANCE_CANONICAL_REJECTED');
   const browser=await actions.runBrowserSmoke();if(!['login','hello','asr','githubFeedbackRead','skillTool','pdfDownload'].every(k=>browser[k as keyof typeof browser]===true))throw Error('MAINTENANCE_BROWSER_REJECTED');
  }catch{
   if(promotionAttempted){try{await actions.restoreBaseline();await actions.restorePointer();}catch{throw Error('MAINTENANCE_ROLLBACK_UNPROVEN');}}
   throw Error('MAINTENANCE_ACTIVATION_NOT_ACCEPTED');
  }
 };
}
/** Startup gate: no existing implementation authorizes acceptance writes while
 * the production all-writer/NOLOGIN barrier is held. A profile boolean is not a
 * scoped writer lane, so reject before pointer promotion or recovery attempts. */
export function assertMaintenanceActivationCapability(): never {
 throw Error('MAINTENANCE_ACCEPTANCE_WRITER_LANE_NOT_IMPLEMENTED');
}
export interface MaintenanceActivationBindings {
 identity:MaintenanceIdentity; toolRevision:string;
 activationCommand:TrustedExecutable;
 recoveryCommand:TrustedExecutable;
 plan:{path:string;sha256:string}; recoveryPlan:{path:string;sha256:string};
}
/** Concrete installed-command consumer. The host helper itself must be delivered
 * in the exact tool closure; an ordinary deploy script is deliberately forbidden. */
export function fixedMaintenanceActivationActions(binding:MaintenanceActivationBindings,run:CommandRunner=runFixedPython):ActivationActions {
 const identity=identitySchema.parse(binding.identity);
 if(!/^[a-f0-9]{40}$/.test(binding.toolRevision)||binding.activationCommand.path!=='/usr/local/lib/workspacex-cn/cn-maintenance-activation.py'||binding.recoveryCommand.path!=='/usr/local/lib/workspacex-cn/cn-production-recovery-executor.py')throw Error('MAINTENANCE_ACTIVATION_COMMAND_BINDING');
 for(const [plan,base,name] of [[binding.plan,'maintenance-activation','activation-plan.json'],[binding.recoveryPlan,'maintenance-recovery','recovery-plan.json']] as const)if(plan.path!==`/etc/workspacex-cn/${base}/${identity.sourceRevision}/${identity.attemptId}/${name}`||!hash.safeParse(plan.sha256).success)throw Error('MAINTENANCE_ACTIVATION_PLAN_BINDING');
 async function operation(action:string){
  const raw=await run(binding.activationCommand,['--maintenance-activation-operation',binding.plan.path,binding.plan.sha256,action]);
  const r=z.object({schemaVersion:z.literal(1),kind:z.literal('maintenance-activation-operation'),identity:identitySchema,toolRevision:z.string(),planSha256:hash,action:z.string(),writesHeld:z.literal(true),result:z.record(z.unknown())}).strict().parse(JSON.parse(raw.stdout));
  if(!equal(r.identity,identity)||r.toolRevision!==binding.toolRevision||r.planSha256!==binding.plan.sha256||r.action!==action)throw Error('MAINTENANCE_ACTIVATION_RESPONSE_BINDING');
  return r.result;
 }
 return {
  readBaselineFingerprint:async()=>z.object({baselineSha256:hash}).strict().parse(await operation('read-baseline-fingerprint')).baselineSha256,
  drainRuns:async()=>z.object({queued:z.number().int().nonnegative(),running:z.number().int().nonnegative(),writebackPending:z.number().int().nonnegative()}).strict().parse(await operation('read-run-drain')),
  promotePreparedPointer:async()=>{z.object({pointerPromoted:z.literal(true)}).strict().parse(await operation('promote-prepared-pointer'));},
  activateTraffic:async()=>{z.object({trafficActivated:z.literal(true)}).strict().parse(await operation('activate-traffic'));},
  verifyCanonical:async()=>z.object({status:z.literal('passed'),lockRetained:z.literal(true),passedStages:z.literal(8)}).strict().parse(await operation('verify-canonical')),
  runBrowserSmoke:async()=>z.object({login:z.literal(true),hello:z.literal(true),asr:z.literal(true),githubFeedbackRead:z.literal(true),skillTool:z.literal(true),pdfDownload:z.literal(true)}).strict().parse(await operation('browser-acceptance')),
  restoreBaseline:async()=>{
   // Exact private plan is reread/hash checked by the command, then the actual
   // production executor restores all three DBs before baseline runtime recovery.
   const pin=z.object({recoveryPlanSha256:hash}).strict().parse(await operation('verify-recovery-plan'));
   if(pin.recoveryPlanSha256!==binding.recoveryPlan.sha256)throw Error('RECOVERY_PLAN_DRIFT');
   const r=z.object({schemaVersion:z.literal(1),kind:z.literal('production-recovery-completed'),identity:identitySchema,receiptSha256:hash,writesHeld:z.literal(true),ready:z.literal(false)}).strict().parse(JSON.parse((await run(binding.recoveryCommand,['--execute-production-recovery',binding.recoveryPlan.path])).stdout));
   if(!equal(r.identity,identity))throw Error('BASELINE_DATABASE_RECOVERY_IDENTITY');
   z.object({baselineRuntimeRecovered:z.literal(true),databaseRecoveryReceiptSha256:hash}).strict().superRefine((v,c)=>{if(v.databaseRecoveryReceiptSha256!==r.receiptSha256)c.addIssue({code:z.ZodIssueCode.custom,message:'RECOVERY_RECEIPT_BINDING'});}).parse(await operation('restore-baseline-runtime'));
  },
  restorePointer:async()=>{z.object({baselinePointerRestored:z.literal(true)}).strict().parse(await operation('restore-baseline-pointer'));},
 };
}
