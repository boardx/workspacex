// Root-operated, fixed-plan migration driver. Input comes only from protected stdin.
// This module is copied into the frozen API image probe; it imports that image's pg config.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {migrationConfig} from './src/infrastructure/db/pg-config.ts';
const p=JSON.parse(fs.readFileSync(0,'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');
const need=(v,code)=>{if(!v)throw Object.assign(new Error(),{safeCode:code});};
const plan=p.plan;
need(plan.source==='9eaedc66c6f9d83220ba702ecc62205a0bdaaa4b'&&plan.baseline==='f0eb9d07398a66fdd5646a9e6b855fa1b940e571','SOURCE_BINDING');
const actualFiles=fs.readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort();
need(actualFiles.length===Object.keys(plan.targetLedger).length&&actualFiles.every(n=>hash(fs.readFileSync('migrations/'+n))===plan.targetLedger[n]),'IMAGE_MIGRATION_CLOSURE');
const cfg=migrationConfig();
need(cfg.host==='pgm-uf6rg214cp381l49.rwlb.rds.aliyuncs.com'&&cfg.database==='workspacex_a1cb_20261006'&&cfg.user==='migration_admin'&&cfg.port===5432,'DATABASE_BINDING');
for(const f of plan.migrations){
 let cursor=0;
 for(const v of f.components){need(v.start===cursor&&v.end>v.start&&Buffer.byteLength(v.sql)===v.end-v.start&&hash(v.sql)===v.sha256&&['schema','manual-data'].includes(v.kind),'COMPONENT_BINDING');cursor=v.end;}
 need(hash(f.components.map(c=>c.sql).join(''))===f.sourceChecksum&&plan.targetLedger[f.name]===f.sourceChecksum,'FILE_BINDING');
}
const pure=plan.migrations.filter(f=>f.components.every(c=>c.kind==='schema'));
const deferred=plan.migrations.filter(f=>f.components.some(c=>c.kind==='manual-data'));
need(pure.length===12&&deferred.length===4,'COMPONENT_SET');
const schemaLedger={...plan.baselineLedger,...Object.fromEntries(pure.map(f=>[f.name,f.sourceChecksum]))};
const c=new pg.Client({...cfg,connectionTimeoutMillis:5000,statement_timeout:30000,application_name:'wsx-cn-release-5917'});
let stage='connect',transaction=false,commitSent=false;
const ledger=async()=>{
 const rows=(await c.query('SELECT name,checksum FROM public._kernel_migrations ORDER BY name')).rows;
 const count=(await c.query('SELECT count(*)::integer AS n FROM public._kernel_migrations')).rows[0].n;
 need(count===rows.length,'LEDGER_COUNT');return Object.fromEntries(rows.map(r=>[r.name,r.checksum]));
};
const equal=(a,b)=>Object.keys(a).length===Object.keys(b).length&&Object.entries(b).every(([n,s])=>a[n]===s);
const recorded=async(f,i,v)=>c.query('INSERT INTO public._kernel_migration_components(name,source_checksum,component_index,kind,sql_checksum,plan_checksum,attempt) VALUES($1,$2,$3,$4,$5,$6,$7)',[f.name,f.sourceChecksum,i,v.kind,v.sha256,p.planChecksum,'cn-5917-40097204900']);
const writerDrain=async()=>{
 const rows=(await c.query("SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'")).rows;
 need(rows[0].n===0,'OTHER_DATABASE_SESSIONS');
 need((await c.query('SELECT count(*)::integer AS n FROM pg_prepared_xacts WHERE database=current_database()')).rows[0].n===0,'PREPARED_TRANSACTIONS');
};
try{
 await c.connect();stage='identity';
 const identity=(await c.query('SELECT current_database() AS database,current_user AS role')).rows[0];
 need(identity.database===cfg.database&&identity.role===cfg.user,'CONNECTED_DATABASE_BINDING');
 await c.query("SET lock_timeout='10s'");
 await c.query('SELECT pg_advisory_lock($1)',['8014530119003001']);
 if(p.mode==='status'){
  await c.query('BEGIN READ ONLY');transaction=true;
  const actual=await ledger();
  const status=equal(actual,plan.baselineLedger)?'BASELINE':equal(actual,plan.targetLedger)?'COMPLETE':equal(actual,schemaLedger)?'SCHEMA_COMPLETE_DATA_DEFERRED':'DRIFT';
  await c.query('ROLLBACK');transaction=false;
  console.log(JSON.stringify({status,identity,ledgerCount:Object.keys(actual).length,readOnly:true}));need(status!=='DRIFT','LEDGER_DRIFT');
 }else{
  need(['schema','manual-initialize-cn'].includes(p.mode),'MODE');
  await c.query('BEGIN');transaction=true;
  await c.query("SET LOCAL idle_in_transaction_session_timeout='120s'");
  await writerDrain();stage='ledger';
  need(equal(await ledger(),p.mode==='schema'?plan.baselineLedger:schemaLedger),'PRE_WRITE_LEDGER_DRIFT');
  if(p.mode==='schema'){
   need((await c.query("SELECT to_regclass('public.credit_packages') AS packages,to_regclass('public.billing_subscriptions') AS subscriptions,to_regclass('public.credit_consumption_settings') AS settings")).rows.every(r=>Object.values(r).every(v=>v===null)),'NEW_DOMAIN_ALREADY_EXISTS');
   await c.query('CREATE TABLE public._kernel_migration_components(name text NOT NULL,source_checksum text NOT NULL,component_index integer NOT NULL,kind text NOT NULL CHECK(kind IN (\'schema\',\'manual-data\')),sql_checksum text NOT NULL,plan_checksum text NOT NULL,attempt text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(name,source_checksum,component_index))');
   for(const f of plan.migrations){
    for(const [i,v] of f.components.entries())if(v.kind==='schema'){stage='schema:'+f.name;await c.query(v.sql);await recorded(f,i,v);}
    if(f.components.every(v=>v.kind==='schema'))await c.query('INSERT INTO public._kernel_migrations(name,checksum) VALUES($1,$2)',[f.name,f.sourceChecksum]);
   }
   need(equal(await ledger(),schemaLedger),'SCHEMA_LEDGER_POSTCONDITION');
  }else{
   stage='manual-preconditions';
   const seen=(await c.query('SELECT name,source_checksum,component_index,kind,sql_checksum,plan_checksum,attempt FROM public._kernel_migration_components')).rows;
   const expected=plan.migrations.flatMap(f=>f.components.map((v,i)=>({f,i,v}))).filter(x=>x.v.kind==='schema');
   need(seen.length===expected.length&&expected.every(({f,i,v})=>seen.some(r=>r.name===f.name&&r.source_checksum===f.sourceChecksum&&r.component_index===i&&r.kind===v.kind&&r.sql_checksum===v.sha256&&r.plan_checksum===p.planChecksum&&r.attempt==='cn-5917-40097204900')),'SCHEMA_COMPONENT_DRIFT');
   // Only newly introduced, empty CN domain tables are eligible. Never overwrite a live catalog.
   for(const table of ['credit_packages','credit_consumption_settings','billing_subscriptions','billing_stripe_bindings'])need((await c.query(`SELECT count(*)::integer AS n FROM public.${table}`)).rows[0].n===0,'MANUAL_INITIALIZATION_NONEMPTY');
   for(const f of deferred){
    for(const [i,v] of f.components.entries())if(v.kind==='manual-data'){stage='manual:'+f.name;await c.query(v.sql);await recorded(f,i,v);}
    await c.query('INSERT INTO public._kernel_migrations(name,checksum) VALUES($1,$2)',[f.name,f.sourceChecksum]);
   }
   need((await c.query('SELECT count(*)::integer n FROM credit_packages')).rows[0].n===9,'PACKAGE_POSTCONDITION');
   need((await c.query('SELECT count(*)::integer n FROM credit_consumption_settings WHERE singleton AND NOT credit_preflight_enabled')).rows[0].n===1,'SETTINGS_POSTCONDITION');
   need(equal(await ledger(),plan.targetLedger),'FULL_LEDGER_POSTCONDITION');
  }
  stage='commit';commitSent=true;await c.query('COMMIT');transaction=false;
  console.log(JSON.stringify({status:p.mode==='schema'?'SCHEMA_COMMITTED_DATA_DEFERRED':'MANUAL_CN_INITIALIZATION_COMMITTED',identity,ledgerCount:p.mode==='schema'?427:431,commitAcknowledged:true}));
 }
}catch(e){
 let rollbackAcknowledged=false;
 if(transaction&&!commitSent){try{await c.query('ROLLBACK');rollbackAcknowledged=true;}catch{}}
 console.log(JSON.stringify({status:commitSent?'COMMIT_UNKNOWN_RECONCILE_REQUIRED':'FAILED',stage,code:e.safeCode??(/^[A-Z0-9_]{1,32}$/.test(e.code??'')?e.code:'QUERY_REJECTED'),rollbackAcknowledged}));process.exitCode=1;
}finally{await c.end().catch(()=>{});}
