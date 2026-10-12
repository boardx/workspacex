/** Actual startApi/full migrations; synthetic dedicated database, no live model. */
import { startupDiagnostic } from './diagnostic';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const pg = createRequire(new URL('../../../apps/api/package.json', import.meta.url))('pg');
import { migrate, migrationFiles, MIGRATIONS_DIR } from '../../../apps/api/src/infrastructure/db/migrator';
import { migrationConfig } from '../../../apps/api/src/infrastructure/db/pg-config';
import { seedOrg, addOrgMember, asApp } from '../../../apps/api/tests/support/db';
import { addChatThread, addChatMessage } from '../../../apps/api/tests/support/chat-db';
import { PLATFORM_SKILL_CATALOG } from '../../../apps/api/src/domain/skill/platform-skill-catalog';

function need(ok: unknown, code: string): asserts ok { if (!ok) throw Error(code); }
const scenario = process.argv[2];
const output = process.argv[3];
need(['baseline', 'normal', 'cleanup-denied', 'seed-denied'].includes(scenario), 'SCENARIO');
need(process.env.PGHOST === '127.0.0.1' && /^cn_startup_[a-f0-9]{16}$/.test(process.env.PGDATABASE ?? ''), 'ISOLATED_DATABASE');
need(process.env.CN_API_STARTUP_FIXTURE === '1', 'EXPLICIT_FIXTURE');
const owner = new pg.Client(migrationConfig());
let app: Awaited<ReturnType<typeof import('../../../apps/api/src/main')['startApi']>> | undefined;
const started = Date.now();
const checks: string[] = [];
let stage = 'connect-and-migrate';
try {
  await owner.connect();
  const names = migrationFiles();
  if (scenario === 'baseline') {
    const migration = await migrate(migrationConfig());
    need(migration.applied.length === names.length && migration.skipped.length === 0, 'FRESH_FULL_MIGRATIONS');
    await owner.query("CREATE TABLE cn_template_canary(value text); INSERT INTO cn_template_canary VALUES('pristine-baseline')");
    await owner.end();
    writeFileSync(output,JSON.stringify({kind:'cn-api-startup-fixture-v1',scenario,verified:true,fullMigrations:true,
      migrationCount:names.length,productionAccepted:false})+'\n',{flag:'wx',mode:0o600});
    process.exit(0);
  }
  const rows = (await owner.query('SELECT name,checksum FROM _kernel_migrations ORDER BY name')).rows;
  need(rows.length === names.length && rows.every((x,i)=>x.name===names[i] && x.checksum===createHash('sha256').update(readFileSync(MIGRATIONS_DIR+'/'+x.name)).digest('hex')), 'CLONE_MIGRATION_CHECKSUMS');
  need((await owner.query('TABLE cn_template_canary')).rows[0]?.value==='pristine-baseline','CLONE_CANARY');
  need((await owner.query("SELECT to_regclass('cn_startup_canary') AS t")).rows[0].t===null,'SCENARIO_DATA_LEAKED');
  await owner.query("UPDATE cn_template_canary SET value=$1",[scenario]);
  const roles = await owner.query("SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname IN ('app_rw','app_diag_ro')");
  need(roles.rows.length === 2 && roles.rows.every(x => !x.rolsuper && !x.rolbypassrls), 'ACTUAL_APPLICATION_ROLES');
  checks.push('full_original_migrations_and_nonowner_roles');
  stage = 'seed-synthetic-inputs';
  await owner.query("CREATE TABLE cn_startup_canary(value text); INSERT INTO cn_startup_canary VALUES('unrelated-synthetic-row')");
  await owner.query("INSERT INTO error_logs(trace_id,msg,detail,created_at) VALUES ('cn-startup-old','synthetic','{}',now()-interval '31 days'),('cn-startup-fresh','synthetic','{}',now())");
  await owner.query("INSERT INTO debug_events(trace_id,kind,level,msg,created_at) VALUES ('cn-startup-old','fixture','info','synthetic',now()-interval '8 days'),('cn-startup-fresh','fixture','info','synthetic',now())");
  const skillIds = PLATFORM_SKILL_CATALOG.map(x => x.skillId);
  need((await owner.query('SELECT id FROM skills WHERE id=ANY($1)', [skillIds])).rowCount === 0, 'PLATFORM_SKILLS_MUST_START_ABSENT');
  const org = 'org-cn-startup', actor = 'user-cn-startup', thread = 'thread-cn-startup';
  await seedOrg({orgId:org, projectId:'project-cn-startup'});
  await addOrgMember(org, actor, 'consultant', null);
  await addChatThread({orgId:org,id:thread,projectId:'project-cn-startup',visibilityScope:'plenary',createdBy:actor});
  for (const age of ['old','fresh']) {
    await addChatMessage({orgId:org,id:'msg-cn-startup-'+age,threadId:thread,body:'synthetic',authorId:actor});
    await asApp(org, c => c.query(`INSERT INTO agent_runs
      (id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,heartbeat_at)
      VALUES ($1,$2,$3,$4,'fixture-agent','fixture-version','[]'::jsonb,'deep-agent','fixture-model','running',
        now()-($5::int*interval '1 minute'),now()-($5::int*interval '1 minute'))`,
      ['run-cn-startup-'+age,org,thread,'msg-cn-startup-'+age,age==='old'?60:0]));
  }
  if (scenario === 'cleanup-denied') await owner.query('REVOKE DELETE ON error_logs,debug_events FROM app_rw');
  if (scenario === 'seed-denied') {
    await owner.query(`CREATE FUNCTION cn_startup_deny_seed() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.id='org-platform' THEN RAISE EXCEPTION 'synthetic seed rejection'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER cn_startup_deny_seed BEFORE INSERT ON organizations FOR EACH ROW EXECUTE FUNCTION cn_startup_deny_seed()`);
  }
  // Deliberately calls startApi, not createApp. No replacing sweep/seed/recovery.
  stage = 'actual-startApi';
  stage = 'import-actual-main';
  const {startApi} = await import('../../../apps/api/src/main');
  stage = 'invoke-actual-startApi';
  app = await startApi({port:0,listenHost:'127.0.0.1',loadLocalEnv:false});
  need(app.getHttpServer().listening, 'API_LISTENER_NOT_RUNNING');
  stage = 'read-back-startup-effects';
  const count = async (table: string, trace: string) => Number((await owner.query(`SELECT count(*) AS n FROM ${table} WHERE trace_id=$1`,[trace])).rows[0].n);
  for (const table of ['error_logs','debug_events']) {
    need(await count(table,'cn-startup-fresh') === 1, 'FRESH_LOG_LOST');
    need(await count(table,'cn-startup-old') === (scenario==='cleanup-denied'?1:0), 'RETENTION_EFFECT_MISMATCH');
  }
  const actualSkills = (await owner.query('SELECT id FROM skills WHERE id=ANY($1) ORDER BY id',[skillIds])).rows.map(x=>x.id);
  need(actualSkills.length === (scenario==='seed-denied'?0:skillIds.length), 'SEED_EFFECT_MISMATCH');
  const runs = await owner.query("SELECT id,status,error_code,recovery_attempts,lease_epoch,recovery_diagnostic FROM agent_runs WHERE id IN ('run-cn-startup-old','run-cn-startup-fresh') ORDER BY id");
  need(runs.rows.length===2, 'RECOVERY_ROWS_MISSING');
  const stale=runs.rows.find(x=>x.id==='run-cn-startup-old');
  need(stale?.status==='running' && stale.recovery_attempts===1 && stale.lease_epoch>=1 && typeof stale.recovery_diagnostic==='string' && stale.recovery_diagnostic.length>0,'STALE_RUN_RECOVERY_NOT_ATTEMPTED');
  need(runs.rows.find(x=>x.id==='run-cn-startup-fresh')?.status==='running' && runs.rows.find(x=>x.id==='run-cn-startup-fresh')?.recovery_attempts===0,'FRESH_RUN_MUTATED');
  need((await owner.query('TABLE cn_startup_canary')).rows[0]?.value==='unrelated-synthetic-row','UNRELATED_DATA_CHANGED');
  checks.push('real_startApi_listener','actual_age_retention_or_permission_counterproof','actual_platform_seed_or_trigger_counterproof','actual_stale_run_recovery_fresh_run_preserved','unrelated_row_preserved');
  await app.close(); app=undefined;
  writeFileSync(output,JSON.stringify({kind:'cn-api-startup-fixture-v1',scenario,verified:true,checks,
    realStartApi:true,fullMigrations:false,verifiedMigrationClone:true,migrationCount:names.length,
    migrationNamesSha256:createHash('sha256').update(JSON.stringify(names)).digest('hex'),
    listenerWasRunning:true,startupSideEffectsAccepted:scenario==='normal',
    listenerAloneDoesNotProveSideEffects:scenario!=='normal',
    queuedModelWorkerExecutionTested:false,debugRowCountLimitTested:false,
    productionAccepted:false,cloudCalls:0,durationSeconds:(Date.now()-started)/1000})+'\n',{flag:'wx',mode:0o600});
  await owner.end();process.exit(0);
} catch (error) {
  try { await app?.close(); } catch {}
  try { await owner.end(); } catch {}
  // No raw database error/DSN/query output in the public evidence.
  writeFileSync(output,JSON.stringify({kind:'cn-api-startup-fixture-v1',scenario,verified:false,
    diagnostic:startupDiagnostic(error),stage,checks,productionAccepted:false})+'\n',{flag:'wx',mode:0o600});
  process.exit(1);
}
