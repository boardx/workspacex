/* Actual canonical migration adapter; immutable candidate API image supplies tsx/pg. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
function validate(p){
 const b=p.binding,s=p.secret,v=p.providerObservation,plan=p.plan;
 if(b.targetInstanceId===b.sourceInstanceId||b.sourceInstanceId!=='pgm-uf6rg214cp381l49'||s.user!=='migration_admin'||s.targetInstanceId!==b.targetInstanceId||s.attemptId!==b.attemptId||s.host!==b.host||s.peer!==b.peer)throw Error('TARGET_BINDING');
 if(!v.providerVerified||v.targetInstanceId!==b.targetInstanceId||v.peer!==b.peer||v.providerCreatedUtc!==b.providerCreatedUtc||Date.now()-Date.parse(v.observedUtc)>120000||Date.now()<Date.parse(v.observedUtc))throw Error('FRESH_PROVIDER');
 if(plan.prepared!==true||plan.candidateSha!==b.candidateSha||!Array.isArray(plan.sourceSqlInventory)||!plan.sourceSqlInventory.length||new Set(plan.sourceSqlInventory.map(x=>x.name)).size!==plan.sourceSqlInventory.length)throw Error('FROZEN_PLAN');
 for(const x of plan.sourceSqlInventory)if(!/^[-a-zA-Z0-9_]+\.sql$/.test(x.name)||! /^[0-9a-f]{64}$/.test(x.sha256))throw Error('SQL_INVENTORY');
 return p;
}
async function main(p){
 validate(p);const {binding:b,secret:s,plan}=p,root='/opt/workspacex',dir=path.join(root,'apps/api/migrations');
 const names=fs.readdirSync(dir).filter(n=>n.endsWith('.sql')).sort(),expected=[...plan.sourceSqlInventory].sort((a,b)=>a.name.localeCompare(b.name));
 if(JSON.stringify(names)!==JSON.stringify(expected.map(x=>x.name)))throw Error('SOURCE_SQL_SET');
 const sums=new Map();for(const x of expected){if(hash(fs.readFileSync(path.join(dir,x.name)))!==x.sha256)throw Error('SOURCE_SQL_BYTES');sums.set(x.name,x.sha256);}
 const module=path.join(root,'apps/api/src/infrastructure/db/migrator.ts');if(hash(fs.readFileSync(module))!==plan.canonicalMigratorSha256)throw Error('CANONICAL_RUNNER_BYTES');
 const pg=require('pg'),Original=pg.Client;let peerChecks=0;
 const tls=b.tls.sslmode==='verify-full'?{rejectUnauthorized:true,ca:p.caPem,servername:b.host}:false;
 if(!tls&&!(b.tls.approvedException==='aliyun-postgresql-serverless-no-tls'&&b.tls.providerSslEvidence?.targetInstanceId===b.targetInstanceId&&b.tls.providerSslEvidence?.providerCreatedUtc===b.providerCreatedUtc&&b.tls.providerSslEvidence?.sslEnabled===false))throw Error('TLS_BINDING');
 const cfg={host:b.host,port:5432,database:'workspacex',user:s.user,password:s.password,ssl:tls,connectionTimeoutMillis:10000,statement_timeout:300000};
 pg.Client=class extends Original{async connect(){await super.connect();try{if(hash(this.connection.stream.remoteAddress.replace(/^::ffff:/,''))!==b.peerSha256||this.connection.stream.remotePort!==5432)throw Error('ACTUAL_PEER');await this.query('BEGIN READ ONLY');try{const x=(await this.query("SELECT current_database() db,current_user username,current_setting('transaction_read_only') ro")).rows[0];if(x.db!==cfg.database||x.username!==s.user||x.ro!=='on')throw Error('ACTUAL_SQL_IDENTITY');}finally{await this.query('ROLLBACK');}peerChecks++;}catch(e){await this.end();throw e;}}};
 try{
  for(const k of Object.keys(process.env))if(k.startsWith('PG')||k.startsWith('APP_DB_')||k.startsWith('MIGRATION_DB_')||['DATABASE_URL','DATABASE_URI'].includes(k))delete process.env[k];process.env.WORKSPACEX_DEPLOY_PROFILE='production';
  if(p.operation==='canvas-audit'){
   if(typeof p.sql!=='string'||hash(p.sql)!==p.sqlSha256||p.sql.includes('\\ir')||!p.sql.includes('ROLLBACK;')||!p.sql.includes('SET LOCAL ROLE app_rw'))throw Error('CANVAS_SQL_CLOSURE');
   const c=new pg.Client(cfg);await c.connect();try{await c.query(p.sql);const r=(await c.query("SELECT current_setting('app.canvas_template_actor',true) actor,current_setting('app.canvas_template_action',true) action")).rows[0];if(r.actor||r.action)throw Error('POOLED_CONTEXT_LEAK');}
   finally{await c.query('ROLLBACK');await c.end();}
   return {accepted:true,targetInstanceId:b.targetInstanceId,attemptId:b.attemptId,candidateSha:b.candidateSha,transactionRollbackVerified:true,appRuntimeInsertVerified:true,frozenOrgAndCascadeVerified:true,actualSqlPeerChecks:peerChecks,sqlSha256:p.sqlSha256};
  }
  async function ledger(){const c=new pg.Client(cfg);await c.connect();try{return(await c.query('SELECT name,checksum FROM _kernel_migrations ORDER BY name')).rows;}finally{await c.end();}}
  const before=await ledger();if(before.some(x=>sums.get(x.name)!==x.checksum)||new Set(before.map(x=>x.name)).size!==before.length)throw Error('FRESH_LEDGER_DRIFT');
  const pending=names.filter(n=>!before.some(x=>x.name===n));if(plan.pendingNames&&JSON.stringify(pending)!==JSON.stringify([...plan.pendingNames].sort()))throw Error('FRESH_PENDING_DRIFT');
  const authority=await import('file://'+module),first=await authority.migrate(cfg,{dir,force:false}),after=await ledger();
  if(JSON.stringify(first.applied)!==JSON.stringify(pending)||first.skipped.length!==before.length||after.length!==names.length||after.some(x=>sums.get(x.name)!==x.checksum))throw Error('FIRST_CANONICAL_RESULT');
  const second=await authority.migrate(cfg,{dir,force:false});if(second.applied.length||second.skipped.length!==names.length)throw Error('REPEAT_CANONICAL_RESULT');
  return {accepted:true,targetInstanceId:b.targetInstanceId,attemptId:b.attemptId,candidateSha:b.candidateSha,force:false,seed:false,firstApplied:first.applied.length,repeatedApplied:0,sourceFileCount:names.length,restoredLedgerCount:before.length,ledgerSha256:hash(JSON.stringify(after)),actualSqlPeerChecks:peerChecks};
 }finally{pg.Client=Original;}
}
module.exports={validate,main};if(require.main===module){let raw='';process.stdin.on('data',x=>raw+=x);process.stdin.on('end',()=>main(JSON.parse(raw)).then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('ISOLATED_MIGRATION_REJECTED');process.exitCode=1;}));}
