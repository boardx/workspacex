/** Shared devapp/CN/US forward-only migration driver; no per-tag SQL allowlist.
 * Call with a fresh pg.Client after any RECONCILE_REQUIRED result. Never replay --force.
 */
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const LOCK='8014530119003001'; // Same database lock as apps/api migrator.
const need=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{safeCode:code});};
const hash=s=>createHash('sha256').update(s).digest('hex');
export async function executeMigrations({client:c,files,mode,expectedDatabase,expectedUser}) {
 let locked=false,transaction=false,commitSent=false,stage='input',failedMigration;
 const applied=[];
 try {
  need(['plan','apply'].includes(mode),'INVALID_MODE');
  need(expectedDatabase&&expectedUser&&!['app_rw','app_diag_ro','memory_rw'].includes(expectedUser),'MIGRATION_IDENTITY_REQUIRED');
  const names=Object.keys(files).sort();
  need(names.length>0&&names.every(n=>/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*\.sql$/.test(n)&&typeof files[n]==='string'&&files[n].length>0),'INVALID_SQL_SET');
  const identity=(await c.query('SELECT current_database() AS database,current_user AS role')).rows[0];
  need(identity.database===expectedDatabase&&identity.role===expectedUser,'DATABASE_IDENTITY_MISMATCH');
  await c.query("SET lock_timeout='10s'");await c.query("SET statement_timeout='120s'");
  stage='lock';locked=(await c.query('SELECT pg_try_advisory_lock($1::bigint) AS locked',[LOCK])).rows[0].locked;
  need(locked,'MIGRATION_BUSY');
  const present=(await c.query("SELECT to_regclass('public._kernel_migrations') IS NOT NULL AS present")).rows[0].present;
  const ledger=present?(await c.query('SELECT name,checksum FROM public._kernel_migrations ORDER BY name')).rows:[];
  stage='ledger';
  // Match the application's migrator: committed names are never replayed, even
  // when a later branch edits/removes old files. Preserve their original ledger
  // checksums and report drift; new changes must ship as new migration names.
  const historicalDrift=ledger.filter(row=>!Object.hasOwn(files,row.name)||hash(files[row.name])!==row.checksum).map(row=>row.name);
  const done=new Set(ledger.map(r=>r.name));need(done.size===ledger.length,'DUPLICATE_MIGRATION_RECORD');
  const pending=names.filter(n=>!done.has(n));
  if(mode==='plan'||!pending.length)return {status:pending.length?'PENDING':'COMPLETE',pending,applied,skipped:done.size,historicalDrift};
  for(const name of pending) {
   failedMigration=name;stage='migration';
   await c.query('BEGIN');transaction=true;
   if(!present&&!applied.length)await c.query('CREATE TABLE IF NOT EXISTS public._kernel_migrations (name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
   await c.query(files[name]);
   await c.query('INSERT INTO public._kernel_migrations(name,checksum) VALUES($1,$2)',[name,hash(files[name])]);
   stage='commit';commitSent=true;await c.query('COMMIT');transaction=false;commitSent=false;applied.push(name);
  }
  return {status:'COMPLETE',pending:[],applied,skipped:done.size,historicalDrift};
 } catch(error) {
  let rollbackAcknowledged=false;
  if(transaction&&!commitSent)try{await c.query('ROLLBACK');rollbackAcknowledged=true;}catch{}
  return {status:commitSent?'RECONCILE_REQUIRED':'FAILED',stage,code:error.safeCode??'DATABASE_OPERATION_FAILED',
   ...(failedMigration?{failedMigration}:{}),applied,rollbackAcknowledged,
   ...(/^[0-9A-Z]{5}$/.test(error.code??'')?{sqlState:error.code}:{})};
 } finally {
  // A new invocation always uses a new connection. Lost COMMIT acknowledgement must
  // not be followed by another SQL script on the uncertain connection.
  if(locked&&!commitSent)await c.query('SELECT pg_advisory_unlock($1::bigint)',[LOCK]).catch(()=>{});
 }
}

async function main() {
 const appRoot=process.env.WSX_API_ROOT??'/opt/workspacex/apps/api';
 const req=createRequire(join(appRoot,'package.json'));const {Client}=req('pg');
 const expectedDatabase=process.env.WSX_EXPECTED_DATABASE,expectedUser=process.env.WSX_EXPECTED_MIGRATION_USER;
 // Use exactly the API's TLS/connection configuration (including managed RDS CA),
 // loaded from the immutable candidate image, not a workstation dependency.
 const {migrationConfig}=await import(pathToFileURL(join(appRoot,'src/infrastructure/db/pg-config.ts')));
 const cfg=migrationConfig();
 need(cfg.host===process.env.WSX_EXPECTED_DATABASE_HOST&&String(cfg.port)===process.env.WSX_EXPECTED_DATABASE_PORT&&cfg.database===expectedDatabase&&cfg.user===expectedUser,'MIGRATION_ENDPOINT_MISMATCH');
 const dir=join(appRoot,'migrations');
 const files=Object.fromEntries(readdirSync(dir).filter(n=>n.endsWith('.sql')).map(n=>[n,readFileSync(join(dir,n),'utf8')]));
 const client=new Client(cfg);let connected=false;
 try {
  await client.connect();connected=true;
  const result=await executeMigrations({client,files,mode:process.argv[2],expectedDatabase,expectedUser});
  console.log(JSON.stringify(result));if(!['COMPLETE','PENDING'].includes(result.status))process.exitCode=1;
 } finally {if(connected)await client.end();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
 main().catch(()=>{console.log(JSON.stringify({status:'FAILED',stage:'connection',code:'MIGRATION_CONNECTION_FAILED'}));process.exitCode=1;});
}
