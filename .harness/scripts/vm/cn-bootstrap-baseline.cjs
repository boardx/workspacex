'use strict';
// Prebuild proves the running baseline and exact migration inventory, never candidate schema.
const fs=require('node:fs'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const objectHash=x=>hash(JSON.stringify(x));
const fail=c=>{throw Error(c);};
function verifyPlan(p,source,baseline,files,now=Date.now()){
 const {planSha256,...body}=p;
 if(p.schemaVersion!==1||p.scope!=='read-only-plan'||p.productionMigrationAuthorized!==false||p.targetSha!==source||p.baselineSha!==baseline||!/^[a-f0-9]{40}$/.test(source)||!/^[a-f0-9]{40}$/.test(baseline)||planSha256!==objectHash(body)||p.ready!==true||!Array.isArray(p.blockers)||p.blockers.length)fail('BOOTSTRAP_MIGRATION_PLAN_UNPROVEN');
 const evidence=p.snapshotEvidence,age=now-Date.parse(evidence?.capturedAt);
 if(!evidence||!Number.isFinite(age)||age<0||age>3600000||!['snapshotSha256','sourceBindingSha256','fullResponseSha256','ledgerSha256'].every(k=>/^[a-f0-9]{64}$/.test(evidence[k]??'')))fail('BOOTSTRAP_MIGRATION_PLAN_EXPIRED');
 if(!Array.isArray(p.ledger)||!Array.isArray(p.pending)||new Set(p.ledger.map(x=>x.name)).size!==p.ledger.length||evidence.independentSqlCount!==p.ledger.length||evidence.ledgerSha256!==objectHash(p.ledger)||p.baselineLedgerSha256!==objectHash(p.ledger))fail('BOOTSTRAP_MIGRATION_LEDGER_UNPROVEN');
 const inventory=Object.entries(files).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,bytes])=>({name,checksum:hash(bytes)}));
 if(p.sourceInventorySha256!==objectHash(inventory))fail('BOOTSTRAP_MIGRATION_SOURCE_DRIFT');
 const applied=new Set(p.ledger.map(x=>x.name));
 for(const row of p.ledger)if(files[row.name]===undefined||hash(files[row.name])!==row.checksum)fail('BOOTSTRAP_MIGRATION_LEDGER_DRIFT');
 const pending=inventory.filter(x=>!applied.has(x.name));
 if(p.pendingSha256!==objectHash(pending)||JSON.stringify(p.pending.map(({name,checksum})=>({name,checksum})))!==JSON.stringify(pending))fail('BOOTSTRAP_MIGRATION_PENDING_DRIFT');
 if(p.pending.some(x=>x.risk!=='additive'))fail('BOOTSTRAP_MIGRATION_RISK_UNPROVEN');
 return planSha256;
}
async function probe(client,p,source,baseline,files,baselineFiles,compareSchema){
 const planSha256=verifyPlan(p,source,baseline,files);
 let began=false;
 try{
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');began=true;
  if((await client.query('SHOW transaction_read_only')).rows[0]?.transaction_read_only!=='on')fail('BOOTSTRAP_READ_ONLY_GUARD_FAILED');
  await client.query("SET LOCAL statement_timeout = '5000ms'");
  const role=(await client.query('SELECT rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole AS unsafe FROM pg_roles WHERE rolname=current_user')).rows[0];
  if(role?.unsafe!==false)fail('BOOTSTRAP_DB_PERMISSION_INCOMPATIBLE');
  const rows=(await client.query('SELECT name,checksum FROM public._kernel_migrations ORDER BY name COLLATE "C"')).rows;
  if(objectHash(rows)!==p.baselineLedgerSha256)fail('BOOTSTRAP_MIGRATION_LEDGER_DRIFT');
  // Baseline inventory is read from the actual running image, not inferred from the candidate.
  if(!Object.keys(baselineFiles).length)fail('BOOTSTRAP_BASELINE_SOURCE_UNPROVEN');
  for(const [name,bytes] of Object.entries(baselineFiles))if(rows.find(x=>x.name===name)?.checksum!==hash(bytes))fail('BOOTSTRAP_BASELINE_SCHEMA_INCOMPATIBLE');
  if(typeof compareSchema!=='function')fail('BOOTSTRAP_BASELINE_FIELD_CONTRACT_UNPROVEN');
  const baselineInventory=Object.entries(baselineFiles).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,bytes])=>({name,checksum:hash(bytes)}));
  const schemaProof=await compareSchema(client,{baselineSha:baseline,sourceInventorySha256:objectHash(baselineInventory)});
  if(schemaProof?.baselineSchemaContract!==true||!/^[a-f0-9]{64}$/.test(schemaProof.schemaSha256??''))fail('BOOTSTRAP_BASELINE_FIELD_CONTRACT_UNPROVEN');
  const ownership=(await client.query("SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND (c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR (c.relrowsecurity AND NOT c.relforcerowsecurity))) AS unsafe")).rows[0];
  if(ownership?.unsafe!==false)fail('BOOTSTRAP_DB_PERMISSION_INCOMPATIBLE');
  return {baselineSha:baseline,migrationPlanSha256:planSha256,baselineSchemaSha256:schemaProof.schemaSha256,readOnlyTransaction:true,productionWriteStatements:0,baselineLedgerContract:true,baselineSchemaContract:true,baselinePermissionContract:true,candidateSchemaContract:false,buildAdmissionOnly:true};
 }finally{if(began)await client.query('ROLLBACK');}
}
module.exports={verifyPlan,probe};
function candidateEnvironment(target,plan,env,source,baseline,imageDigest,attemptId,now=Date.now()){
 const fields=['schemaVersion','scope','sourceSha','baselineSha','migrationPlanSha256','imageDigest','attemptId','database','issuedAt','expiresAt'];
 if(!target||Object.keys(target).sort().join()!==fields.sort().join()||target.schemaVersion!==1||target.scope!=='isolated-post-migration'||target.attemptId!==attemptId||!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(attemptId??'')||target.sourceSha!==source||target.baselineSha!==baseline||target.migrationPlanSha256!==plan.planSha256||target.imageDigest!==imageDigest||!/^sha256:[a-f0-9]{64}$/.test(imageDigest))fail('BOOTSTRAP_CANDIDATE_TARGET_IDENTITY');
 const start=Date.parse(target.issuedAt),end=Date.parse(target.expiresAt);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>now||end<=now||end<=start||end-start>3600000)fail('BOOTSTRAP_CANDIDATE_TARGET_EXPIRED');
 if(typeof target.database!=='string'||target.database!=='wsx_shadow_'+source.slice(0,12)+'_'+hash(attemptId).slice(0,16)||target.database===env.PGDATABASE||env.PGSSLMODE!=='verify-full'||!env.PGSSLROOTCERT)fail('BOOTSTRAP_CANDIDATE_TARGET_ISOLATION');
 // Reuse the existing protected endpoint, TLS and application identity; only choose an approved isolated DB.
 return {...env,PGDATABASE:target.database};
}
module.exports.candidateEnvironment=candidateEnvironment;
