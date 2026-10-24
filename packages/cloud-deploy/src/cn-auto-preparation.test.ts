/** Composition/protocol tests with controlled provider outputs. These do not claim
 * that RDS backup, restore, browser journeys or production deployment executed. */
import { describe,expect,it } from 'vitest';
import { produceAutoPreparation,autoEvidenceHash as hash,autoCanonical } from './cn-auto-preparation';
import { compareMigrationInventory } from './cn-migration-plan';
import type { AutoPreparationActions,ProtectedRaw,StageRequest } from './cn-auto-preparation-protocol';
const time=new Date('2026-10-24T00:00:00Z'),issued='2026-10-23T23:59:00Z',expires='2026-10-24T00:30:00Z';
const raw=(name:string,value:unknown):ProtectedRaw=>{const bytes=Buffer.from(JSON.stringify(value)+'\n');return {path:'/var/lib/workspacex-cn/auto-preparation/'+name+'.json',bytes,sha256:hash(bytes)};};
function fixture(){
 const identity={sourceRevision:'a'.repeat(40),baselineSourceRevision:'b'.repeat(40),baselineSha256:'c'.repeat(64),release:'v1.0.0',attemptId:'gha-test-1'};
 const image='registry.example/repo/api@sha256:'+'d'.repeat(64);
 const manifest=raw('manifest',{schemaVersion:1,sourceRevision:identity.sourceRevision,release:identity.release,platform:'linux/amd64',images:Object.fromEntries(['api','web','agent','sandbox','postgres','redis'].map(k=>[k,{image}]))});
 const ledger=[{name:'001.sql',checksum:hash('CREATE TABLE a (id integer);')}];
 const plan=compareMigrationInventory({targetSha:identity.sourceRevision,baselineSha:identity.baselineSourceRevision,ledger,snapshotEvidence:{snapshotSha256:hash('snapshot'),sourceBindingSha256:hash('binding'),fullResponseSha256:hash('response'),ledgerSha256:hash(JSON.stringify(ledger)),independentSqlCount:1,capturedAt:issued}},[{...ledger[0]!,sql:'CREATE TABLE a (id integer);'}]);
 const prebuild={schemaVersion:2,phase:'prebuild',sourceSha:identity.sourceRevision,baselineSha:identity.baselineSourceRevision,release:identity.release,attemptId:identity.attemptId,issuedAt:issued,expiresAt:expires,checks:{'config.durable_profiles':{metadata:{asrConfigured:true,githubIssueConfigured:true,platformSuperuserConfigured:true}},'build.affected_services':{metadata:{diffComputed:true,sourceSha:identity.sourceRevision,baselineSha:identity.baselineSourceRevision,services:['api','web']}}}};
 const preactivate={...prebuild,phase:'preactivate',prebuildEvidence:prebuild,prebuildReceiptSha256:hash(autoCanonical(prebuild))};
 const pf=(v:typeof prebuild)=>({evidence:raw(v.phase,v),validation:raw(v.phase+'Validation',{...v,checks:undefined,ready:true,blockers:[],receiptSha256:hash(autoCanonical(v))})});
 const input={identity,manifest,seal:raw('seal',{schemaVersion:1,status:'sealed',sourceRevision:identity.sourceRevision,manifestSha256:manifest.sha256,sealedAt:issued}),migrationPlan:raw('plan',plan),prebuild:pf(prebuild),preactivate:pf(preactivate)};
 const calls:string[]=[];
 const facts:Record<string,any>={
  backup:{childAttemptId:'backup-child',ciphertextsVerified:true,receipt:{identity:{sourceRevision:identity.sourceRevision,baselineRevision:identity.baselineSourceRevision,migrationPlanSha256:plan.planSha256,attemptId:'backup-child'},databases:Object.fromEntries(['workspacex','workspacex_agent','workspacex_memory'].map(k=>[k,{dumpExit:0,encryptionExit:0,ownedProcessesJoined:true,backendObserved:true,ciphertextSha256:hash(k),ciphertextBytes:100,dumpBytes:200}])),cleanupVerified:true,consistencyScope:'three-independent-database-snapshots',currentEpochVerified:false,productionReleaseReady:false}},
  restoreIsolated:{productionTargetUsed:false,restoredBackupSha256:'',dataFidelityVerified:true,pendingMigrationCount:0},
  shadowReadiness:{productionTargetUsed:false,runtimeSourceShas:Object.fromEntries(['api','web','agent','sandbox'].map(k=>[k,identity.sourceRevision])),runtimeImages:Object.fromEntries(['api','web','agent','sandbox'].map(k=>[k,'sha256:'+'d'.repeat(64)])),allServicesReady:true,durableConfig:{asrProfile:true,platformSuperuserEmails:true,githubIssueProfile:true,copilotkitExactTimeoutSeconds:3600,copilotkitPrefixTimeoutSeconds:3600}},
  shadowBusiness:{productionTargetUsed:false,browser:{loginPassed:true,authenticatedNotificationsPassed:true,sourceRuntimeVerified:true}},
  cleanupIsolated:{ownedProcessesJoined:true,ownedContainersAbsent:true,ownedDatabasesAbsent:true,ownedCredentialsAbsent:true,productionResourcesChanged:false},
 };
 for(const stage of ['restoreIsolated','shadowReadiness','shadowBusiness','cleanupIsolated'])facts[stage].isolatedTarget={targetId:'isolated-rds-test',endpointSha256:hash('isolated endpoint'),databases:['shadow_app','shadow_agent','shadow_memory']};
 const patches:Record<string,(v:any)=>void>={};
 const action=(stage:string)=>async(request:StageRequest)=>{
  calls.push(stage);
  const body={schemaVersion:1,kind:'cn-auto-preparation-stage',stage,...request,issuedAt:issued,expiresAt:expires,refs:[{path:'/var/lib/workspacex-cn/raw/'+stage+'.json',sha256:hash(stage)}],facts:structuredClone(facts[stage])};
  if(stage==='restoreIsolated')body.facts.restoredBackupSha256=request.dependencies.backup;
  patches[stage]?.(body);
  return raw(stage,body);
 };
 const actions:AutoPreparationActions={backup:action('backup'),restoreIsolated:action('restoreIsolated'),shadowReadiness:action('shadowReadiness'),shadowBusiness:action('shadowBusiness'),cleanupIsolated:action('cleanupIsolated')};
 return {input,actions,calls,facts,patches};
}
const run=(f:ReturnType<typeof fixture>,clock=()=>time)=>produceAutoPreparation(f.input,f.actions,clock);
describe('automatic zero-migration preparation receipt composition',()=>{
 it('binds raw artifacts and cleanup, preserves earliest expiry, and never activates',async()=>{
  const f=fixture(),result=await run(f);
  expect(f.calls).toEqual(['backup','restoreIsolated','shadowReadiness','shadowBusiness','cleanupIsolated']);
  expect(result.receipt.expiresAt).toBe(new Date(expires).toISOString());
  expect(result.receipt.checks.databaseBackup.evidenceSha256).toBe(result.evidenceIndex.artifacts.backup!.sha256);
  expect(result.receipt.checks.databaseBackup.evidenceSha256).not.toBe(hash(JSON.stringify('passed')));
  expect(result.receipt.checks.shadowBusiness.evidenceSha256).toBe(hash(result.indexBytes));
  expect(result.evidenceIndex.artifacts.cleanupIsolated).toBeDefined();
  expect(result.receipt.diff.pendingMigrationCount).toBe(0);
 });
 it('rejects modified pending inventory without an independently matching pending digest',async()=>{
  const f=fixture(),p=JSON.parse(Buffer.from(f.input.migrationPlan.bytes).toString());
  p.pending=[{name:'002.sql',checksum:hash('sql'),risk:'additive'}];const {planSha256,...body}=p;p.planSha256=hash(JSON.stringify(body));f.input.migrationPlan=raw('plan',p);
  await expect(run(f)).rejects.toThrow('LEDGER');expect(f.calls).toEqual([]);
 });
 it('requires exact old/new runtime evidence for any additive migration',async()=>{
  const f=fixture(),p=JSON.parse(Buffer.from(f.input.migrationPlan.bytes).toString());
  p.pending=[{name:'002.sql',checksum:hash('CREATE TABLE b (id integer);'),risk:'additive'}];p.pendingSha256=hash(JSON.stringify(p.pending.map(({name,checksum}:any)=>({name,checksum}))));
  const {planSha256,...body}=p;p.planSha256=hash(JSON.stringify(body));f.input.migrationPlan=raw('plan',p);f.facts.backup.receipt.identity.migrationPlanSha256=p.planSha256;
  await expect(run(f)).rejects.toThrow('MIGRATION_COMPATIBILITY_REQUIRED');expect(f.calls.at(-1)).toBe('cleanupIsolated');
 });
 it('accepts controlled exact additive proof and rejects cross-plan or incomplete old/new proof',async()=>{
  for(const mutation of ['none','plan','oldWrite','cleanup']){
   const f=fixture(),p=JSON.parse(Buffer.from(f.input.migrationPlan.bytes).toString());
   p.pending=[{name:'002.sql',checksum:hash('CREATE TABLE b (id integer);'),risk:'additive'}];p.pendingSha256=hash(JSON.stringify(p.pending.map(({name,checksum}:any)=>({name,checksum}))));
   const {planSha256,...body}=p;p.planSha256=hash(JSON.stringify(body));f.input.migrationPlan=raw('plan',p);f.facts.backup.receipt.identity.migrationPlanSha256=p.planSha256;
   const proof:any={...f.input.identity,planSha256:p.planSha256,pendingSha256:p.pendingSha256,scope:'restored-baseline-runtime',sqlExecuted:true,cleanupPassed:true};
   delete proof.release;delete proof.attemptId;
   for(const k of ['oldRead','oldWrite','candidateRead','candidateWrite'])proof[k]={status:'passed',evidenceSha256:hash(k)};
   if(mutation==='plan')proof.planSha256=hash('other plan');if(mutation==='oldWrite')proof.oldWrite.status='failed';if(mutation==='cleanup')proof.cleanupPassed=false;
   f.facts.restoreIsolated.migrationCompatibility=proof;
   if(mutation==='none'){const result=await run(f);expect(result.receipt.diff).toMatchObject({migrationRisk:'compatible',pendingMigrationCount:1});expect(result.receipt.migrationCompatibility).toEqual(proof);}
   else await expect(run(f)).rejects.toThrow('INVALID_PREPARED_CN_RELEASE');
   expect(f.calls.at(-1)).toBe('cleanupIsolated');
  }
 });
 it.each(['destructive','unknown'])('refuses %s migrations before any host operation',async(risk)=>{
  const f=fixture(),p=JSON.parse(Buffer.from(f.input.migrationPlan.bytes).toString());p.pending=[{name:'002.sql',checksum:hash('sql'),risk}];
  const {planSha256,...body}=p;p.planSha256=hash(JSON.stringify(body));f.input.migrationPlan=raw('plan',p);
  await expect(run(f)).rejects.toThrow('MIGRATION_PLAN');expect(f.calls).toEqual([]);
 });
 it('rejects raw bytes tampering, changed seals and unbound/expired preflight',async()=>{
  for(const change of [(f:ReturnType<typeof fixture>)=>{f.input.manifest.bytes=Buffer.from('{}');},(f:ReturnType<typeof fixture>)=>{f.input.seal=raw('seal',{});},(f:ReturnType<typeof fixture>)=>{f.input.prebuild.validation=raw('validation',{ready:true});}]){const f=fixture();change(f);await expect(run(f)).rejects.toThrow();expect(f.calls).toEqual([]);}
  await expect(run(fixture(),()=>new Date('2026-10-24T02:00:00Z'))).rejects.toThrow('EXPIRY');
 });
 it.each(['identity','images','dependencies','migrationPlanSha256'])( 'rejects a mismatched stage %s',async(key)=>{
  const f=fixture();f.patches.shadowReadiness=v=>{v[key]=key==='migrationPlanSha256'?hash('different'):{};};
  await expect(run(f)).rejects.toThrow();expect(f.calls.at(-1)).toBe('cleanupIsolated');
 });
 it('runs independent cleanup even when backup provider is killed or rejects',async()=>{
  const f=fixture();f.actions.backup=async()=>{f.calls.push('backup');throw new Error('provider killed after Docker dispatch');};
  await expect(run(f)).rejects.toThrow('provider killed');expect(f.calls).toEqual(['backup','cleanupIsolated']);
 });
 it('rejects a failed dump instead of accepting a passed wrapper',async()=>{
  const f=fixture();f.facts.backup.receipt.databases.workspacex.dumpExit=1;
  await expect(run(f)).rejects.toThrow();expect(f.calls).toEqual(['backup','cleanupIsolated']);
 });
 it.each(['restoreIsolated','shadowReadiness','shadowBusiness'])('cleans after %s rejection and returns no receipt',async(stage)=>{
  const f=fixture();f.patches[stage]=v=>{v.facts.productionTargetUsed=true;};
  await expect(run(f)).rejects.toThrow();expect(f.calls.at(-1)).toBe('cleanupIsolated');
 });
 it('rejects checking a different isolated database after restoration',async()=>{
  const f=fixture();f.facts.shadowBusiness.isolatedTarget.endpointSha256=hash('different endpoint');
  await expect(run(f)).rejects.toThrow('ISOLATED_TARGET');expect(f.calls.at(-1)).toBe('cleanupIsolated');
 });
 it('rejects failed authenticated browser evidence and changed runtime configuration',async()=>{
  for(const change of [(f:ReturnType<typeof fixture>)=>{f.facts.shadowBusiness.browser.authenticatedNotificationsPassed=false;},(f:ReturnType<typeof fixture>)=>{f.facts.shadowBusiness.browser.sourceRuntimeVerified=false;},(f:ReturnType<typeof fixture>)=>{f.facts.shadowReadiness.durableConfig.copilotkitPrefixTimeoutSeconds=30;}]){const f=fixture();change(f);await expect(run(f)).rejects.toThrow();expect(f.calls.at(-1)).toBe('cleanupIsolated');}
 });
 it('rejects leaked resources and traversal refs',async()=>{
  for(const change of [(f:ReturnType<typeof fixture>)=>{f.facts.cleanupIsolated.ownedContainersAbsent=false;},(f:ReturnType<typeof fixture>)=>{f.patches.cleanupIsolated=v=>{v.refs[0].path='/var/lib/workspacex-cn/../secrets';};}]){const f=fixture();change(f);await expect(run(f)).rejects.toThrow();}
 });
 it('cleans up when the provider throws, and refuses expiration during execution',async()=>{
  const f=fixture();f.actions.shadowReadiness=async()=>{throw new Error('controlled provider failure');};
  await expect(run(f)).rejects.toThrow('controlled provider failure');expect(f.calls.at(-1)).toBe('cleanupIsolated');
  let reads=0;
  await expect(run(fixture(),()=>++reads>8?new Date('2026-10-24T00:31:00Z'):time)).rejects.toThrow('EXPIRED_DURING_PREPARATION');
 });
 it('collects preactivate only after the real restore action, and cleans if collection fails',async()=>{
  const f=fixture(),pair=f.input.preactivate;
  const deferred={...f.input,preactivate:undefined};
  f.actions.collectPreactivate=async()=>{expect(f.calls).toEqual(['backup','restoreIsolated']);return pair;};
  const result=await produceAutoPreparation(deferred,f.actions,()=>time);expect(result.evidenceIndex.artifacts.preactivate?.sha256).toBe(pair.evidence.sha256);
  const failed=fixture();failed.actions.collectPreactivate=async()=>{throw new Error('actual collector rejected');};
  await expect(produceAutoPreparation({...failed.input,preactivate:undefined},failed.actions,()=>time)).rejects.toThrow('actual collector rejected');
  expect(failed.calls).toEqual(['backup','restoreIsolated','cleanupIsolated']);
 });
 it('includes cleanup evidence changes in the business check digest',async()=>{
  const a=await run(fixture()),f=fixture();f.patches.cleanupIsolated=v=>{v.refs[0].sha256=hash('other cleanup');};const b=await run(f);
  expect(a.receipt.checks.shadowBusiness.evidenceSha256).not.toBe(b.receipt.checks.shadowBusiness.evidenceSha256);
 });
});
