/** Receipt builder, not a host authorization boundary. The root host provider must
 * execute the fixed producers and no-follow/private-read every supplied artifact.
 * See cn-auto-preparation-protocol.ts for the provider wire contract. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { validateReleaseManifest } from './release';
import { validatePreparedCnRelease } from './cn-fast-safe-release';
import { autoIdentitySchema, stageEnvelopeSchema, type AutoPreparationActions, type AutoPreparationInput, type ProtectedRaw,type AutoStage } from './cn-auto-preparation-protocol';
export const autoEvidenceHash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export const autoCanonical = (v: unknown): string => Array.isArray(v) ? '[' + v.map(autoCanonical).join(',') + ']' : v !== null && typeof v === 'object' ? '{' + Object.entries(v).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,w]) => JSON.stringify(k)+':'+autoCanonical(w)).join(',') + '}' : JSON.stringify(v);
const fail = (code: string): never => { throw new Error('CN_AUTO_PREPARATION_' + code); };
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const fileRef = z.object({ path:z.string(), sha256:hash }).strict();
function ref(v: unknown) {
 const r=fileRef.parse(v);
 if(!/^\/(?:etc|var\/lib)\/workspacex-cn\//.test(r.path))fail('REFERENCE');
 if(r.path.slice(1).split('/').some(s=>!s||s==='.'||s==='..')||/[\x00-\x1f]/.test(r.path))fail('REFERENCE');
 return r;
}
function raw(v: ProtectedRaw) {
 ref({path:v.path,sha256:v.sha256});
 if(v.bytes.byteLength===0||v.bytes.byteLength>16*1024*1024||autoEvidenceHash(v.bytes)!==v.sha256)fail('RAW_BYTES');
 try{return JSON.parse(Buffer.from(v.bytes).toString('utf8'));}catch{return fail('JSON');}
}
function fresh(issued: string, expires: string, now: number) {
 const start=Date.parse(issued),end=Date.parse(expires);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>now||end<=now||end<=start||end-start>3600000)fail('EXPIRY');
 return end;
}
/** Compose real stage evidence. Pending additive SQL requires the original
 * old/new runtime compatibility contract; destructive/unknown plans fail early. */
export async function produceAutoPreparation(input: AutoPreparationInput, actions: AutoPreparationActions, clock: () => Date = () => new Date()) {
 const identity=autoIdentitySchema.parse(input.identity), time=clock().getTime();
 if(!Number.isFinite(time))fail('CLOCK');
 const artifacts: Record<string,{path:string;sha256:string}> = {};
 const read=(key:string,value:ProtectedRaw)=>{const parsed=raw(value);artifacts[key]=ref({path:value.path,sha256:value.sha256});return parsed;};
 const manifest=validateReleaseManifest(read('manifest',input.manifest));
 if(manifest.sourceRevision!==identity.sourceRevision||manifest.release!==identity.release)fail('MANIFEST_IDENTITY');
 const seal=read('seal',input.seal);
 if(seal.schemaVersion!==1||seal.status!=='sealed'||seal.sourceRevision!==identity.sourceRevision||seal.manifestSha256!==input.manifest.sha256||!Number.isFinite(Date.parse(seal.sealedAt))||Date.parse(seal.sealedAt)>time)fail('SEAL');
 const images=Object.fromEntries(['api','web','agent','sandbox'].map(k=>[k,manifest.images[k as 'api'].image.split('@')[1]!]));
 const plan=read('plan',input.migrationPlan),{planSha256,...planBody}=plan;
 if(plan.schemaVersion!==1||plan.scope!=='read-only-plan'||plan.productionMigrationAuthorized!==false||plan.targetSha!==identity.sourceRevision||plan.baselineSha!==identity.baselineSourceRevision||plan.ready!==true||autoEvidenceHash(JSON.stringify(planBody))!==planSha256||['drift','blockers'].some(k=>!Array.isArray(plan[k])||plan[k].length)||!Array.isArray(plan.pending)||plan.pending.some((v:any)=>v.risk!=='additive'))fail('MIGRATION_PLAN');
 const snapshot=z.object({capturedAt:z.string(),snapshotSha256:hash,sourceBindingSha256:hash,fullResponseSha256:hash,ledgerSha256:hash,independentSqlCount:z.number().int().nonnegative()}).strict().parse(plan.snapshotEvidence);
 if(!Array.isArray(plan.ledger)||snapshot.independentSqlCount!==plan.ledger.length||snapshot.ledgerSha256!==autoEvidenceHash(JSON.stringify(plan.ledger))||snapshot.ledgerSha256!==plan.baselineLedgerSha256||plan.pendingSha256!==autoEvidenceHash(JSON.stringify(plan.pending.map(({name,checksum}:any)=>({name,checksum})))))fail('LEDGER');
 const expiries=[fresh(snapshot.capturedAt,new Date(Date.parse(snapshot.capturedAt)+3600000).toISOString(),time)];
 const preflights: Record<string,any> = {};
 function preflight(phase:'prebuild'|'preactivate',pair:{evidence:ProtectedRaw;validation:ProtectedRaw}){
  const evidence=read(phase,pair.evidence), validation=read(phase+'Validation',pair.validation);
  for(const value of [evidence,validation])if(value.phase!==phase||value.sourceSha!==identity.sourceRevision||value.baselineSha!==identity.baselineSourceRevision||value.attemptId!==identity.attemptId||value.release!==identity.release)fail('PREFLIGHT_IDENTITY');
  if(evidence.schemaVersion!==2||validation.ready!==true||!Array.isArray(validation.blockers)||validation.blockers.length||validation.receiptSha256!==autoEvidenceHash(autoCanonical(evidence)))fail('PREFLIGHT_VALIDATION');
  if(validation.issuedAt!==evidence.issuedAt||validation.expiresAt!==evidence.expiresAt)fail('PREFLIGHT_TIME');
  expiries.push(fresh(evidence.issuedAt,evidence.expiresAt,clock().getTime()));
  preflights[phase]=evidence;
 }
 let services: Array<'api'|'web'|'agent'|'sandbox'>=[];
 function checkPreactivate(){
 if(autoCanonical(preflights.preactivate.prebuildEvidence)!==autoCanonical(preflights.prebuild)||preflights.preactivate.prebuildReceiptSha256!==autoEvidenceHash(autoCanonical(preflights.prebuild)))fail('PREFLIGHT_CHAIN');
 const durable=preflights.preactivate.checks?.['config.durable_profiles']?.metadata;
 if(durable?.asrConfigured!==true||durable?.githubIssueConfigured!==true||durable?.platformSuperuserConfigured!==true)fail('DURABLE_CONFIG');
 const affected=preflights.preactivate.checks?.['build.affected_services']?.metadata;
 const services=z.array(z.enum(['api','web','agent','sandbox'])).max(4).parse(affected?.services);
 if(affected?.diffComputed!==true||affected.sourceSha!==identity.sourceRevision||affected.baselineSha!==identity.baselineSourceRevision||new Set(services).size!==services.length)fail('AFFECTED_SERVICES');
 return services;
 }
 preflight('prebuild',input.prebuild);
 if(input.preactivate){preflight('preactivate',input.preactivate);services=checkPreactivate();}
 const dependencies: Record<string,string> = Object.fromEntries(Object.entries(artifacts).map(([k,v])=>[k,v.sha256]));
 const stages: Record<string,any>={};
 async function execute(stage: AutoStage){
  const artifact=await actions[stage]({identity,images,migrationPlanSha256:planSha256,dependencies:{...dependencies}});
  const result=stageEnvelopeSchema.parse(read(stage,artifact));
  if(result.stage!==stage||autoCanonical(result.identity)!==autoCanonical(identity)||autoCanonical(result.images)!==autoCanonical(images)||result.migrationPlanSha256!==planSha256||autoCanonical(result.dependencies)!==autoCanonical(dependencies))fail('STAGE_BINDING');
  for(const r of result.refs)ref(r);
  if(result.refs.length===0||new Set(result.refs.map(r=>r.path)).size!==result.refs.length)fail('STAGE_REFERENCES');
  expiries.push(fresh(result.issuedAt,result.expiresAt,clock().getTime()));
  stages[stage]=result;dependencies[stage]=artifact.sha256;
  return result.facts;
 }
 const targetSchema=z.object({targetId:z.string().min(1).max(128),endpointSha256:hash,databases:z.array(z.string().min(1)).length(3)}).strict();
 let isolatedTarget: ReturnType<typeof targetSchema.parse> | undefined;
 const matchTarget=(value:unknown)=>{const target=targetSchema.parse(value);if(new Set(target.databases).size!==3||isolatedTarget&&autoCanonical(target)!==autoCanonical(isolatedTarget))fail('ISOLATED_TARGET');return target;};
 let migrationCompatibility: unknown;
 let failure: unknown;
 try{
 const backup=await execute('backup');
 const backupReceipt=z.object({identity:z.object({sourceRevision:z.string(),baselineRevision:z.string(),migrationPlanSha256:hash,attemptId:z.string()}).strict(),databases:z.record(z.object({dumpExit:z.literal(0),encryptionExit:z.literal(0),ownedProcessesJoined:z.literal(true),backendObserved:z.literal(true).optional(),ciphertextSha256:hash,ciphertextBytes:z.number().int().positive(),dumpBytes:z.number().int().positive()}).passthrough()),cleanupVerified:z.literal(true),consistencyScope:z.literal('three-independent-database-snapshots'),currentEpochVerified:z.literal(false),productionReleaseReady:z.literal(false)}).strict().parse(backup.receipt);
 if(backupReceipt.identity.sourceRevision!==identity.sourceRevision||backupReceipt.identity.baselineRevision!==identity.baselineSourceRevision||backupReceipt.identity.migrationPlanSha256!==planSha256||backupReceipt.identity.attemptId!==backup.childAttemptId||Object.keys(backupReceipt.databases).sort().join()!=='workspacex,workspacex_agent,workspacex_memory'||backup.ciphertextsVerified!==true)fail('BACKUP');
 if(Object.values(backupReceipt.databases).some(v=>v.backendObserved!==true)&&(backup.implementation!=='pinned-pgdump16-read-only-cms'||!/^pg_dump \(PostgreSQL\) 16\./.test(String(backup.pgDumpVersion))||! /^(?:[^\s]+@)?sha256:[a-f0-9]{64}$/.test(String(backup.clientImage))))fail('BACKUP_IMPLEMENTATION');
  const restore=await execute('restoreIsolated');
  isolatedTarget=matchTarget(restore.isolatedTarget);
  if(restore.productionTargetUsed!==false||restore.restoredBackupSha256!==dependencies.backup||restore.dataFidelityVerified!==true||restore.pendingMigrationCount!==0)fail('RESTORE');
  if(plan.pending.length){migrationCompatibility=restore.migrationCompatibility;if(!migrationCompatibility)fail('MIGRATION_COMPATIBILITY_REQUIRED');}
  if(!input.preactivate){
   const collect=actions.collectPreactivate;
   if(!collect)throw new Error('CN_AUTO_PREPARATION_PREACTIVATE_COLLECTOR_REQUIRED');
   const collected=await collect();preflight('preactivate',collected);services=checkPreactivate();
   for(const name of ['preactivate','preactivateValidation'])dependencies[name]=artifacts[name]!.sha256;
  }
  const readiness=await execute('shadowReadiness');
  matchTarget(readiness.isolatedTarget);
  if(readiness.productionTargetUsed!==false||autoCanonical(readiness.runtimeSourceShas)!==autoCanonical(Object.fromEntries(Object.keys(images).map(k=>[k,identity.sourceRevision])))||autoCanonical(readiness.runtimeImages)!==autoCanonical(images)||readiness.allServicesReady!==true)fail('SHADOW_READINESS');
  const business=await execute('shadowBusiness');
  matchTarget(business.isolatedTarget);
  z.object({loginPassed:z.literal(true),authenticatedNotificationsPassed:z.literal(true),sourceRuntimeVerified:z.literal(true)}).strict().parse(business.browser);
  if(business.productionTargetUsed!==false)fail('SHADOW_BUSINESS');
 }catch(error){failure=error;}
 // Cleanup is mandatory even after restore/readiness/business rejection.
 const cleanup=await execute('cleanupIsolated');
 if(isolatedTarget)matchTarget(cleanup.isolatedTarget);
 if(cleanup.ownedProcessesJoined!==true||cleanup.ownedContainersAbsent!==true||cleanup.ownedDatabasesAbsent!==true||cleanup.ownedCredentialsAbsent!==true||cleanup.productionResourcesChanged!==false)fail('CLEANUP');
 if(failure)throw failure;
 const durableConfig=z.object({asrProfile:z.literal(true),platformSuperuserEmails:z.literal(true),githubIssueProfile:z.literal(true),copilotkitExactTimeoutSeconds:z.literal(3600),copilotkitPrefixTimeoutSeconds:z.literal(3600)}).strict().parse(stages.shadowReadiness.facts.durableConfig);
 const evidenceIndex={schemaVersion:1,kind:'cn-auto-preparation-evidence',identity,images,migrationPlanSha256:planSha256,artifacts,stages:Object.fromEntries(Object.entries(stages).map(([k,v])=>[k,{refs:v.refs,dependencies:v.dependencies}]))};
 const indexBytes=Buffer.from(JSON.stringify(evidenceIndex)+'\n');
 const check=(evidenceSha256:string)=>({status:'passed',evidenceSha256});
 const preparedAt=clock();
 if(Math.min(...expiries)<=preparedAt.getTime())fail('EXPIRED_DURING_PREPARATION');
 const receipt=validatePreparedCnRelease({schemaVersion:1,status:'prepared',baselineSourceRevision:identity.baselineSourceRevision,sourceRevision:identity.sourceRevision,baselineSha256:identity.baselineSha256,release:identity.release,migrationPlanSha256:planSha256,pendingMigrationSha256:plan.pendingSha256,migrationCompatibility,manifestSha256:input.manifest.sha256,images,
  diff:{migrationRisk:plan.pending.length?'compatible':'none',pendingMigrationCount:plan.pending.length,changedServices:services},durableConfig,
  checks:{sourceFrozen:check(input.prebuild.evidence.sha256),imagesImmutable:check(input.manifest.sha256),canonicalConfigRendered:check(artifacts.preactivate!.sha256),migrationAssessed:check(plan.pending.length?planSha256:input.migrationPlan.sha256),databaseBackup:check(dependencies.backup!),shadowReadiness:check(dependencies.shadowReadiness!),shadowBusiness:check(autoEvidenceHash(indexBytes))},failures:[],preparedAt:preparedAt.toISOString(),expiresAt:new Date(Math.min(...expiries)).toISOString()});
 return {receipt,evidenceIndex,indexBytes,indexSha256:autoEvidenceHash(indexBytes)};
}
