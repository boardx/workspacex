'use strict';
// No client is imported or connection opened when this module is required.
const fs = require('node:fs');
const crypto = require('node:crypto');
function requireProof(ok, code) { if (!ok) throw new Error(code); }
function privateJson(path) {
 requireProof(typeof path === 'string' && path.startsWith('/') && !path.split('/').includes('..'), 'CONTROL_CONFIG_PATH');
 const st = fs.lstatSync(path);
 requireProof(st.isFile() && !st.isSymbolicLink() && st.uid === 0 && st.gid === 0 && st.nlink === 1 && (st.mode & 0o777) === 0o600, 'CONTROL_CONFIG_TRUST');
 let parent = require('node:path').dirname(path);
 while (true) { const s = fs.lstatSync(parent); requireProof(s.isDirectory() && !s.isSymbolicLink() && s.uid === 0 && !(s.mode & 0o022), 'CONTROL_CONFIG_PARENT'); if (parent === '/') break; parent = require('node:path').dirname(parent); }
 return JSON.parse(fs.readFileSync(path, 'utf8'));
}
const ID_SQL = `SELECT json_build_object('peer',json_build_object('database',current_database(),'serverAddr',inet_server_addr()::text,'serverPort',inet_server_port(),'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system())),'role',current_user,'pid',pg_backend_pid(),'backendStart',(SELECT backend_start FROM pg_stat_activity WHERE pid=pg_backend_pid()),'clientAddr',inet_client_addr()::text,'tls',(SELECT json_build_object('ssl',ssl,'version',version,'cipher',cipher) FROM pg_stat_ssl WHERE pid=pg_backend_pid())) AS identity`;
const READ_QUERIES = {"roles": "BEGIN TRANSACTION READ ONLY; SELECT json_build_object('peer',json_build_object('database',current_database(),'serverAddr',inet_server_addr()::text,'serverPort',inet_server_port(),'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system())), 'currentRole',current_user,'selfPid',pg_backend_pid(),'tls',(SELECT json_build_object('ssl',ssl,'version',version,'cipher',cipher) FROM pg_stat_ssl WHERE pid=pg_backend_pid()),'roles',(SELECT json_agg(json_build_object('name',rolname,'login',rolcanlogin,'superuser',rolsuper,'createRole',rolcreaterole,'createDb',rolcreatedb,'replication',rolreplication,'bypassRls',rolbypassrls)) FROM pg_roles),'diagnosticPrivileges',json_build_object('databaseWrite',has_database_privilege(current_user,current_database(),'CREATE,TEMP'),'schemaWrite',EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_temp_%' AND has_schema_privilege(current_user,oid,'CREATE')),'tableWrite',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE c.relkind IN ('r','p','v','f','m') AND n.nspname NOT IN ('pg_catalog','information_schema') AND has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),'sequenceWrite',EXISTS(SELECT 1 FROM pg_class c WHERE c.relkind='S' AND has_sequence_privilege(current_user,c.oid,'USAGE,UPDATE')),'definerExecute',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema') AND has_function_privilege(current_user,p.oid,'EXECUTE')),'privilegedMembership',EXISTS(SELECT 1 FROM pg_roles r WHERE (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls OR r.rolname IN ('pg_write_server_files','pg_execute_server_program','pg_signal_backend')) AND pg_has_role(current_user,r.oid,'MEMBER')))); ROLLBACK;", "sessions": "BEGIN TRANSACTION READ ONLY; SELECT json_build_object('peer',json_build_object('database',current_database(),'serverAddr',inet_server_addr()::text,'serverPort',inet_server_port(),'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system())), 'sessions',coalesce((SELECT json_agg(json_build_object('role',usename,'clientAddr',client_addr::text,'pid',pid,'backendStart',backend_start,'xactStart',xact_start,'backendType',backend_type,'applicationName',application_name,'state',state,'ssl',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_stat_activity.pid))) FROM pg_stat_activity WHERE datname=current_database()),'[]'::json), 'preparedTransactions',coalesce((SELECT json_agg(json_build_object('gid',gid,'owner',owner,'database',database)) FROM pg_prepared_xacts WHERE database=current_database()),'[]'::json)); ROLLBACK;"};
const FIXED_APP='9b25bfa65662b96c0826fe67506b562ea46aa6d0';
const FIXED_BASE='ba6343199f3c834d6a198f83d0c771614292c82b';
const MIGRATOR_LIBRARY='/usr/local/lib/workspacex-cn/cn-maintenance-migrator.cjs';
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function trustedBytes(path,mode){
 requireProof(typeof path==='string'&&path.startsWith('/')&&!path.split('/').includes('..'),'MIGRATION_TRUST_PATH');
 const st=fs.lstatSync(path);requireProof(st.isFile()&&!st.isSymbolicLink()&&st.uid===0&&st.gid===0&&st.nlink===1&&(st.mode&0o777)===mode,'MIGRATION_FILE_TRUST');
 let parent=require('node:path').dirname(path);while(true){const s=fs.lstatSync(parent);requireProof(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===0&&s.gid===0&&!(s.mode&0o022),'MIGRATION_PARENT_TRUST');if(parent==='/')break;parent=require('node:path').dirname(parent);}
 const fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const current=fs.fstatSync(fd);requireProof(current.ino===st.ino&&current.dev===st.dev&&current.size===st.size&&current.mtimeMs===st.mtimeMs,'MIGRATION_FILE_CHANGED');return fs.readFileSync(fd);}finally{fs.closeSync(fd);}
}
function loadFixedMigrator(auth){requireProof(sha(trustedBytes(MIGRATOR_LIBRARY,0o700))===auth.librarySha256,'MIGRATION_LIBRARY_PIN');const library=require(MIGRATOR_LIBRARY);requireProof(typeof library.migrateExistingSession==='function','MIGRATION_LIBRARY_EXPORT');return library;}
function validateMigrationAuthorization(auth,identity){
 const keys=['schemaVersion','kind','identity','toolRevision','checkout','gitExecutableSha256','canonicalMigratorSha256','librarySha256','sourceInventory','sourceInventorySha256','pending','pendingSha256','baselineLedger','baselineLedgerSha256','lockTimeoutMs','operationTimeoutMs','migrationSource','sourceEvidence'];requireProof(auth&&Object.keys(auth).every(k=>keys.includes(k)||k==='approvedRdsTlsException')&&keys.every(k=>Object.hasOwn(auth,k)),'MIGRATION_AUTHORITY_SCHEMA');
 requireProof(auth&&auth.schemaVersion===1&&auth.kind==='exact-9b-existing-session-migration'&&canonical(auth.identity)===canonical(identity)&&identity.sourceRevision===FIXED_APP&&identity.baselineRevision===FIXED_BASE&&auth.checkout==='/var/lib/workspacex-cn/releases/'+FIXED_APP&&/^[a-f0-9]{40}$/.test(auth.toolRevision)&&/^[a-f0-9]{64}$/.test(identity.migrationPlanSha256)&&/^[A-Za-z0-9-]{1,128}$/.test(identity.attemptId),'MIGRATION_AUTHORITY');
 for(const key of ['gitExecutableSha256','canonicalMigratorSha256','librarySha256','sourceInventorySha256','pendingSha256','baselineLedgerSha256'])requireProof(/^[a-f0-9]{64}$/.test(auth[key]),'MIGRATION_AUTHORITY_HASH');
 for(const [key,hashKey] of [['sourceInventory','sourceInventorySha256'],['pending','pendingSha256'],['baselineLedger','baselineLedgerSha256']]){
  const rows=auth[key];requireProof(Array.isArray(rows)&&rows.every(row=>Object.keys(row).sort().join(',')==='checksum,name'&&/^[A-Za-z0-9_.-]+\.sql$/.test(row.name)&&/^[a-f0-9]{64}$/.test(row.checksum))&&new Set(rows.map(r=>r.name)).size===rows.length&&rows.every((r,i)=>i===0||rows[i-1].name<r.name)&&sha(canonical(rows))===auth[hashKey],'MIGRATION_INVENTORY_AUTHORITY');
 }
 const done=new Map(auth.baselineLedger.map(r=>[r.name,r.checksum]));requireProof(auth.baselineLedger.every(r=>auth.sourceInventory.some(s=>s.name===r.name&&s.checksum===r.checksum))&&canonical(auth.pending)===canonical(auth.sourceInventory.filter(r=>!done.has(r.name))),'MIGRATION_PENDING_CLOSURE');
 requireProof(Number.isSafeInteger(auth.lockTimeoutMs)&&auth.lockTimeoutMs>0&&auth.lockTimeoutMs<=300000&&Number.isSafeInteger(auth.operationTimeoutMs)&&auth.operationTimeoutMs>=10000&&auth.operationTimeoutMs<=1800000,'MIGRATION_DEADLINE');
 return auth;
}
function verifyFixedMigrationCheckout(auth){
 const path=require('node:path');const root=auth.checkout;
 for(const directory of [root,path.join(root,'.git'),path.join(root,'apps/api/migrations')]){let p=directory;while(true){const st=fs.lstatSync(p);requireProof(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===0&&st.gid===0&&!(st.mode&0o022),'MIGRATION_CHECKOUT_TRUST');if(p==='/')break;p=path.dirname(p);}}
 requireProof(sha(trustedBytes('/usr/bin/git',0o755))===auth.gitExecutableSha256,'MIGRATION_GIT_PIN');
 const exec=require('node:child_process').execFileSync;const git=(args)=>exec('/usr/bin/git',['--no-optional-locks','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','core.useReplaceRefs=false','-C',root,...args],{env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',GIT_NO_REPLACE_OBJECTS:'1'},encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:10000,maxBuffer:1048576});
 requireProof(git(['rev-parse','HEAD']).trim()===FIXED_APP&&!git(['status','--porcelain','--untracked-files=all','--','apps/api/migrations','apps/api/src/infrastructure/db/migrator.ts']).trim(),'MIGRATION_CHECKOUT_EXACT');
 requireProof(sha(trustedBytes(path.join(root,'apps/api/src/infrastructure/db/migrator.ts'),0o644))===auth.canonicalMigratorSha256,'MIGRATION_CANONICAL_SOURCE_PIN');
 const actual=fs.readdirSync(path.join(root,'apps/api/migrations')).filter(n=>n.endsWith('.sql')).sort();requireProof(canonical(actual)===canonical(auth.sourceInventory.map(r=>r.name)),'MIGRATION_SQL_FILE_SET');
 for(const row of auth.sourceInventory)requireProof(sha(trustedBytes(path.join(root,'apps/api/migrations',row.name),0o644))===row.checksum,'MIGRATION_SQL_PIN');
}
READ_QUERIES['migration-ledger']='BEGIN TRANSACTION READ ONLY; SELECT json_build_object(\'ledger\',coalesce((SELECT json_agg(json_build_object(\'name\',name,\'checksum\',checksum,\'appliedAt\',applied_at) ORDER BY name) FROM public._kernel_migrations),\'[]\'::json),\'rowCount\',(SELECT count(*)::int FROM public._kernel_migrations)) AS snapshot; ROLLBACK;';
READ_QUERIES['run-drain']="BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT json_build_object('rows',coalesce((SELECT json_agg(x) FROM (SELECT status,count(*)::text AS count FROM public.agent_runs GROUP BY status) x),'[]'::json)) AS snapshot; ROLLBACK;";
class ControlSession {
 constructor(clientFactory, configLoader = privateJson, migrationLibraryLoader=loadFixedMigrator, checkoutVerifier=verifyFixedMigrationCheckout) { this.migrationLibraryLoader=migrationLibraryLoader;this.checkoutVerifier=checkoutVerifier;this.factory = clientFactory; this.load = configLoader; this.client = null; this.binding = null; this.sequence = 0; this.failed = false; }
 async identity() { const result = await this.client.query(ID_SQL); requireProof(result.rows.length === 1, 'CONTROL_IDENTITY_PROTOCOL'); const stream=this.client.connection?.stream;requireProof(stream&&typeof stream.remoteAddress==='string'&&Number.isSafeInteger(stream.remotePort)&&typeof stream.localAddress==='string'&&Number.isSafeInteger(stream.localPort)&&stream.encrypted===true&&stream.authorized===true,'CONTROL_SOCKET_TLS_IDENTITY');return {...result.rows[0].identity,socket:{remoteAddress:stream.remoteAddress,remotePort:stream.remotePort,localAddress:stream.localAddress,localPort:stream.localPort,encrypted:true,authorized:true}}; }
 async handle(message) {
  requireProof(!this.failed && Number.isSafeInteger(message.sequence) && message.sequence === this.sequence + 1, 'CONTROL_SEQUENCE'); this.sequence = message.sequence;
  try {
   if (message.operation === 'connect') {
    requireProof(!this.client && message.sslMode === 'verify-full' && typeof message.applicationName === 'string' && ['control','diagnostic'].includes(message.mode) && message.applicationName === 'wsx-maintenance-'+message.mode+'-' + message.identity.attemptId, 'CONTROL_CONNECT_AUTHORITY');
    const config = this.load(message.serviceFile); const target = config.databases[message.database];
    requireProof(target && target.database === message.database && target.ssl && target.ssl.rejectUnauthorized === true && target.ssl.caFile === message.caFile, 'CONTROL_TLS_CONFIG');
    const ca = fs.readFileSync(message.caFile); const options = { ...target, ssl: { rejectUnauthorized: true, ca }, application_name: message.applicationName, connectionTimeoutMillis: 10000, query_timeout: 10000, statement_timeout: 10000 };
    delete options.ssl.caFile; this.options=options;this.toolRevision=message.toolRevision;this.identityBinding=message.identity;this.migrationAuthorization=message.migrationAuthorization?structuredClone(message.migrationAuthorization):null;this.mode=message.mode; this.client = this.factory(options);requireProof(typeof this.client.connection?.on==='function','CONTROL_TRANSACTION_STATE_REQUIRED');this.client.connection.on('readyForQuery',value=>{this.transactionStatus=value.status;}); this.client.on('error', () => { this.failed = true; }); await this.client.connect();
    this.binding = await this.identity(); requireProof(this.binding.peer.database === message.database && this.binding.tls.ssl === true, 'CONTROL_TLS_IDENTITY');
    if(this.mode==='control'){requireProof(Array.isArray(message.roleTargets)&&message.roleTargets.length>0,'CONTROL_ROLE_TARGETS');const proof=await this.client.query("SELECT ((SELECT rolsuper FROM pg_roles WHERE rolname=current_user) OR has_table_privilege(current_user,'pg_catalog.pg_authid','UPDATE')) AS catalog_lock_authority, ((SELECT rolsuper FROM pg_roles WHERE rolname=current_user) OR ((SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user) AND NOT EXISTS(SELECT 1 FROM unnest($1::text[]) target(name) WHERE NOT EXISTS(SELECT 1 FROM pg_roles r JOIN pg_auth_members m ON m.roleid=r.oid JOIN pg_roles actor ON actor.oid=m.member WHERE r.rolname=target.name AND actor.rolname=current_user AND m.admin_option)))) AS alter_role_authority",[message.roleTargets]);requireProof(proof.rows.length===1,'CONTROL_CAPABILITY_PROTOCOL');this.capabilities={catalogLockAuthority:proof.rows[0].catalog_lock_authority,alterRoleAuthority:proof.rows[0].alter_role_authority};requireProof(this.capabilities.catalogLockAuthority===true&&this.capabilities.alterRoleAuthority===true,'CONTROL_ROLE_CAPABILITY');}
   } else {
    if(message.operation==='migrate-exact-plan'){
     requireProof(this.mode==='control'&&this.client&&this.binding.peer.database==='workspacex'&&!this.migrationStarted,'MIGRATION_EXISTING_SESSION_REQUIRED');
     requireProof(this.transactionStatus==='I','MIGRATION_CONTROL_TRANSACTION_NOT_IDLE');const auth=validateMigrationAuthorization(this.migrationAuthorization,this.identityBinding);requireProof(auth.toolRevision===this.toolRevision,'MIGRATION_TOOL_BINDING');requireProof(canonical(message.identity)===canonical(this.identityBinding),'MIGRATION_CALL_IDENTITY');this.checkoutVerifier(auth);
     requireProof(canonical(await this.identity())===canonical(this.binding),'MIGRATION_CONNECTION_CHANGED');
     const ledger=await this.client.query('SELECT name,checksum FROM public._kernel_migrations ORDER BY name');requireProof(canonical(ledger.rows)===canonical(auth.baselineLedger),'MIGRATION_BASELINE_LEDGER_DRIFT');
     const library=this.migrationLibraryLoader(auth);this.migrationStarted=true;
     const value=await library.migrateExistingSession(this.client,this.options,auth.migrationSource,auth.sourceEvidence,auth.approvedRdsTlsException,auth.checkout+'/apps/api/migrations',auth.lockTimeoutMs);
     requireProof(canonical(await this.identity())===canonical(this.binding)&&canonical(value.applied)===canonical(auth.pending.map(r=>r.name))&&canonical(value.skipped)===canonical(auth.baselineLedger.map(r=>r.name)),'MIGRATION_RESULT_BINDING');
     return {sequence:this.sequence,ok:true,connection:this.binding,value};
    }
    if (message.operation === 'query') {
     requireProof(this.mode === 'diagnostic' && Object.hasOwn(READ_QUERIES,message.queryId),'DIAGNOSTIC_QUERY_AUTHORITY');
     requireProof(JSON.stringify(await this.identity()) === JSON.stringify(this.binding),'DIAGNOSTIC_CONNECTION_CHANGED');
     const result=await this.client.query(READ_QUERIES[message.queryId]);
     const results=Array.isArray(result)?result:[result];const records=results.flatMap(r=>r.rows||[]);requireProof(records.length===1,'DIAGNOSTIC_QUERY_PROTOCOL');
     requireProof(JSON.stringify(await this.identity()) === JSON.stringify(this.binding),'DIAGNOSTIC_CONNECTION_CHANGED');
     return {sequence:this.sequence,ok:true,connection:this.binding,value:Object.values(records[0])[0]};
    }
    requireProof(this.mode === 'control' && message.operation === 'execute' && this.client && typeof message.sql === 'string' && message.sql.length <= 1024 * 1024, 'CONTROL_EXECUTE_AUTHORITY');
    requireProof(JSON.stringify(await this.identity()) === JSON.stringify(this.binding), 'CONTROL_CONNECTION_CHANGED');
    await this.client.query(message.sql);
    requireProof(this.transactionStatus==='I','CONTROL_TRANSACTION_NOT_IDLE');
    requireProof(JSON.stringify(await this.identity()) === JSON.stringify(this.binding), 'CONTROL_CONNECTION_CHANGED');
   }
   return { sequence: this.sequence, ok: true, connection: this.binding, capabilities:this.capabilities };
  } catch (error) { this.failed = true; throw new Error('CONTROL_PROTOCOL_REJECTED'); }
 }
 async close() { if (this.client) await this.client.end(); }
}
async function main() {
 requireProof(process.argv.length === 3 && process.argv[2] === '--persistent-control-json', 'CONTROL_ENTRY');
 // Python launcher has verified every runtime file against the root-private manifest.
 const pgPath = process.env.WSX_TRUSTED_PG_MODULE;
 requireProof(typeof pgPath === 'string' && pgPath.startsWith('/'), 'CONTROL_PG_RUNTIME_REQUIRED');
 const { Client } = require(pgPath); const session = new ControlSession(config => new Client(config));
 let buffer = ''; let chain = Promise.resolve();
 process.stdin.setEncoding('utf8');
 process.stdin.on('data', chunk => {
  buffer += chunk; if (buffer.length > 1024 * 1024) { process.exitCode = 1; process.stdin.destroy(); return; }
  while (buffer.includes('\n')) { const index = buffer.indexOf('\n'); const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
   chain = chain.then(async () => { const reply = await session.handle(JSON.parse(line)); process.stdout.write(JSON.stringify(reply) + '\n'); }).catch(async () => { process.exitCode = 1; process.stdin.destroy(); await session.close(); });
  }
 });
 process.stdin.on('end', () => { chain.finally(() => session.close()); });
}
module.exports = { ControlSession, ID_SQL, READ_QUERIES, validateMigrationAuthorization, verifyFixedMigrationCheckout };
if (require.main === module) main().catch(() => { process.stderr.write('CONTROL_HELPER_REJECTED\n'); process.exitCode = 1; });
