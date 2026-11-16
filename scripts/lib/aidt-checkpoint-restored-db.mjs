// Exact restored-data receipt gate. Used by the restore owner and e2e-up before skipping seed.
import {readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {hash,invariant,readOwnedPrivateJson,verifyCheckpoint,verifyRestoredObjects,ZERO_EXECUTION_ENV} from './aidt-checkpoint-restore.mjs';
import {preservedVersion} from './aidt-default-fixture-repair.mjs';
export async function connectOwnedDatabase(root,env=process.env,database=env.PGDATABASE){
  invariant(env.PGHOST==='127.0.0.1'&&/^wsx_[a-z0-9_]+$/.test(database??''),'CHECKPOINT_LOOPBACK_DATABASE_REQUIRED');
  const {migrationConfig}=await import(pathToFileURL(join(root,'apps/api/src/infrastructure/db/pg-config.ts')));
  const {Client}=createRequire(join(root,'apps/api/package.json'))('pg');
  const config={...migrationConfig(),host:'127.0.0.1',port:Number(env.PGPORT),database};
  const db=new Client(config);await db.connect();return{db,config};
}
export async function restoredDataFacts(db,plan){
  const protectedHashes={};for(const table of Object.keys(plan.protectedBaseline.protectedHashes)){
    invariant(/^[a-z_]+$/.test(table),'CHECKPOINT_BASELINE_TABLE_INVALID');
    const wallet=table==='wallets';
    const sql=wallet?"SELECT to_jsonb(t) AS row FROM credit_wallets t WHERE (owner_type='user' AND owner_id=$1) OR (owner_type='team' AND owner_id=$2) ORDER BY wallet_id":`SELECT to_jsonb(t) AS row FROM ${table} t WHERE org_id=$1 ORDER BY to_jsonb(t)::text`;
    const params=wallet?[plan.fundedActorId,plan.orgId]:[plan.orgId];
    const rows=(await db.query(sql,params)).rows.map(r=>r.row);protectedHashes[table]={count:rows.length,sha256:hash(JSON.stringify(rows))};
  }
  const agentId=plan.agents[0].id;
  const versionRows=(await db.query('SELECT to_jsonb(v) AS row FROM agent_versions v WHERE org_id=$1 AND agent_id=$2 ORDER BY id',[plan.orgId,agentId])).rows.map(row=>row.row);
  const versions=versionRows.map(v=>({id:v.id,instruction_digest:v.instruction_digest}));
  const pointer=(await db.query('SELECT published_version_id FROM agents WHERE org_id=$1 AND id=$2',[plan.orgId,agentId])).rows[0]?.published_version_id;
  const oldVersion=(await db.query('SELECT to_jsonb(v) AS row FROM agent_versions v WHERE org_id=$1 AND id=$2',[plan.orgId,plan.protectedBaseline.oldVersionId])).rows[0]?.row;
  const stages=(await db.query('SELECT DISTINCT ON (stage_id) project_id,stage_id,revision,content,source_stage_revisions,updated_by,updated_at FROM aidt_stage_revisions WHERE org_id=$1 AND project_id=$2 AND stage_id IN (1,2) ORDER BY stage_id,revision DESC',[plan.orgId,plan.primaryProjectId])).rows.map(row=>({projectId:row.project_id,stageId:row.stage_id,revision:row.revision,content:row.content,sourceStageRevisions:row.source_stage_revisions,updatedBy:row.updated_by,updatedAt:new Date(row.updated_at).toISOString()}));
  const finance=(await db.query("SELECT (SELECT count(*)::int FROM agent_runs WHERE status NOT IN ('succeeded','failed','cancelled')) AS active,(SELECT count(*)::int FROM model_request_starts) AS physical,(SELECT count(*)::int FROM token_usage_events) AS usage,(SELECT count(*)::int FROM credit_consumption_requests) AS credit,(SELECT count(*)::int FROM credit_consumption_requests WHERE state<>'settled') AS unsettled,(SELECT coalesce(sum(held_hundredths+remaining_held_hundredths),0)::text FROM credit_wallets) AS holds,(SELECT coalesce(sum(unbounded_requests),0)::text FROM credit_wallets) AS unbounded")).rows[0];
  invariant(hash(JSON.stringify(protectedHashes))===hash(JSON.stringify(plan.protectedBaseline.protectedHashes)),'CHECKPOINT_RESTORED_PROTECTED_DATA_MISMATCH');
  invariant(hash(JSON.stringify(oldVersion))===plan.protectedBaseline.oldVersionHash,'CHECKPOINT_OLD_VERSION_CHANGED');
  invariant(versions.length===2&&versions.every(v=>plan.agents.some(a=>a.version_id===v.id&&a.instruction_digest===v.instruction_digest))&&pointer===plan.protectedBaseline.newVersionId,'CHECKPOINT_RESTORED_AGENT_MISMATCH');
  invariant(versionRows.every(v=>typeof v.instructions==='string'&&hash(v.instructions)===v.instruction_digest),'CHECKPOINT_RESTORED_INSTRUCTION_BYTES_MISMATCH');
  const canonicalVersion=versionRows.find(v=>v.id===pointer);
  invariant(hash(JSON.stringify(preservedVersion(canonicalVersion)))===hash(JSON.stringify(preservedVersion(oldVersion))),'CHECKPOINT_RESTORED_MODEL_POLICY_ROLE_MISMATCH');
  invariant(Array.isArray(plan.expectedStages)&&plan.expectedStages.length===2&&isDeepStrictEqual(stages,plan.expectedStages),'CHECKPOINT_RESTORED_STAGE_MISMATCH');
  invariant(finance.active===0&&finance.unsettled===0&&Number(finance.holds)===0&&Number(finance.unbounded)===0&&finance.physical===2&&finance.usage===2&&finance.credit===2,'CHECKPOINT_RESTORED_FINANCIAL_MISMATCH');
  return{protectedHashes,versions,publishedVersionId:pointer,instructionBytesMatchDigests:true,modelPolicyPinsRoleFieldsPreserved:true,stages:stages.map(s=>({stageId:s.stageId,revision:s.revision,exactSavedValueMatches:true})),finance};
}
export function validateRestoreReceipt(receipt,plan,env){
  invariant(receipt.kind==='aidt-checkpoint-restored'&&receipt.restored===true&&receipt.seedResetAllowed===false,'CHECKPOINT_RESTORE_RECEIPT_REQUIRED');
  invariant(receipt.emptyTargetBeforeRestore===true,'CHECKPOINT_RESTORE_EMPTY_TARGET_REQUIRED');
  invariant(receipt.planSha256===env.REAL_MODEL_E2E_RESTORE_PLAN_SHA256&&receipt.database===plan.database&&receipt.orgId===plan.orgId&&receipt.containerId&&receipt.composeProject===env.COMPOSE_PROJECT_NAME,'CHECKPOINT_RESTORE_RECEIPT_BINDING');
  invariant(env.PGDATABASE===receipt.database&&env.WORKSPACEX_DB===receipt.database&&env.PGHOST==='127.0.0.1'&&String(env.PGPORT)===String(receipt.pgPort),'CHECKPOINT_RESTORE_TRANSPORT_MISMATCH');
  invariant(String(receipt.pgPort)===String(receipt.ports?.PGPORT),'CHECKPOINT_RESTORE_RESERVED_PG_PORT_MISMATCH');
  invariant(Object.entries(ZERO_EXECUTION_ENV).every(([k,v])=>env[k]===v),'CHECKPOINT_RESTORE_EXECUTORS_NOT_ZERO');
  invariant(env.WORKSPACEX_OBJECT_ROOT===receipt.objectRoot,'CHECKPOINT_RESTORE_OBJECT_ROOT_MISMATCH');
}
export async function verifyRestoredReceipt(root,receiptFile,env=process.env){
  const receipt=readOwnedPrivateJson(receiptFile),plan=readOwnedPrivateJson(receipt.planFile);
  invariant(hash(readFileSync(receipt.planFile))===receipt.planSha256,'CHECKPOINT_RESTORE_PLAN_CHANGED');validateRestoreReceipt(receipt,plan,env);
  const verified=verifyCheckpoint({checkpoint:plan.checkpoint,receiptFile:plan.checkpointReceiptFile,legacyLedger:plan.ledgerPaths.legacy,supplementLedger:plan.ledgerPaths.supplementS1});
  invariant(verified.dumpSha256===plan.dumpSha256&&verified.manifestSha256===plan.manifestSha256,'CHECKPOINT_RESTORE_INPUT_CHANGED');
  const actual=readFileSync(`/proc/${receipt.leaseOwner.pid}/stat`,'utf8'),f=actual.slice(actual.lastIndexOf(')')+2).split(' ');
  invariant(Number(f[19])===receipt.leaseOwner.startTicks&&f[0]!=='Z','CHECKPOINT_RESTORE_LEASE_OWNER_CHANGED');
  const {testPortLeaseDir}=await import(pathToFileURL(join(root,'.harness/scripts/lib/test-port-lease.ts')));
  for(const port of Object.values(receipt.ports)){const dir=join(testPortLeaseDir(env),String(port)),files=readdirSync(dir);invariant(files.length===1,'CHECKPOINT_RESTORE_LEASE_INVALID');const lease=JSON.parse(readFileSync(join(dir,files[0]),'utf8'));invariant(lease.pid===receipt.leaseOwner.pid&&lease.starting===true,'CHECKPOINT_RESTORE_LEASE_INVALID');}
  const {leaseDir}=await import(pathToFileURL(join(root,'.harness/scripts/lib/stack-admission.ts')));
  invariant(receipt.stackAdmission?.ownerPid===receipt.leaseOwner.pid&&receipt.stackAdmission.isolationId===env.WORKSPACEX_ISOLATION_ID,'CHECKPOINT_RESTORE_STACK_ADMISSION_MISMATCH');
  const slot=JSON.parse(readFileSync(join(leaseDir(env),`${receipt.stackAdmission.ownerPid}-${receipt.stackAdmission.isolationId}.json`),'utf8'));
  invariant(slot.pid===receipt.leaseOwner.pid&&slot.isolationId===env.WORKSPACEX_ISOLATION_ID,'CHECKPOINT_RESTORE_STACK_ADMISSION_MISMATCH');
  const docker=spawnSync('docker',['inspect','--format','{{json .Config.Labels}}',receipt.containerId],{encoding:'utf8'});invariant(docker.status===0,'CHECKPOINT_RESTORE_CONTAINER_MISSING');const labels=JSON.parse(docker.stdout);invariant(labels['com.docker.compose.project']===receipt.composeProject&&labels['com.docker.compose.service']==='postgres','CHECKPOINT_RESTORE_CONTAINER_OWNER_MISMATCH');
  const port=spawnSync('docker',['port',receipt.containerId,'5432/tcp'],{encoding:'utf8'});invariant(port.status===0&&port.stdout.trim()===`127.0.0.1:${receipt.pgPort}`,'CHECKPOINT_RESTORE_ACTUAL_PG_PORT_MISMATCH');
  verifyRestoredObjects(plan,receipt.objectRoot);
  const {db}=await connectOwnedDatabase(root,env);let facts;try{await db.query('BEGIN READ ONLY');facts=await restoredDataFacts(db,plan);await db.query('ROLLBACK');}finally{await db.end();}
  const fixture=readOwnedPrivateJson(receipt.fixtureFile);invariant(hash(readFileSync(receipt.fixtureFile))===receipt.fixtureSha256&&fixture.orgId===plan.orgId,'CHECKPOINT_RESTORE_FIXTURE_CHANGED');
  return{receipt,plan,fixture,facts};
}
