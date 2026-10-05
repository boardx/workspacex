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
function loadHeldCandidateContext(session){
 const profile=JSON.parse(trustedBytes('/etc/workspacex-cn/trusted-tool-binding.json',0o600));
 requireProof(profile.toolRevision===session.toolRevision&&profile.heldCandidateExpected,'HELD_SOURCE_PROFILE');
 const compile=(file,imports)=>{
  const path='/usr/local/lib/workspacex-cn/'+file,expected=profile.filesSha256?.['.harness/scripts/vm/'+file];
  requireProof(/^[a-f0-9]{64}$/.test(expected),'HELD_INSTALLED_SOURCE_PIN');
  const raw=trustedBytes(path,0o700);requireProof(sha(raw)===expected,'HELD_INSTALLED_SOURCE_DRIFT');
  const Module=require('node:module'),m=new Module(path);m.filename=path;
  m.require=name=>{if(Object.hasOwn(imports,name))return imports[name];if(name==='node:crypto')return crypto;throw Error('HELD_INSTALLED_IMPORT_FORBIDDEN');};
  m._compile(raw.toString('utf8'),path);return m.exports;
 };
 const queries=compile('held_candidate_queries.cjs',{'./control_connection.cjs':{READ_QUERIES}});
 const expected=compile('held_candidate_expected.cjs',{'./held_candidate_queries.cjs':queries});
 requireProof(typeof queries.readHeldCandidate==='function'&&typeof expected.createQualifiedExpectedVerifier==='function','HELD_INSTALLED_EXPORTS');
 const readProtected=ref=>{requireProof(ref&&Object.keys(ref).sort().join(',')==='path,sha256'&&ref.path.startsWith('/etc/workspacex-cn/')&&!ref.path.split('/').includes('..'),'HELD_PROTECTED_REF');const raw=trustedBytes(ref.path,0o600);requireProof(sha(raw)===ref.sha256,'HELD_PROTECTED_HASH');return raw;};
 const expectedRef=profile.heldCandidateExpected.expected,data=JSON.parse(readProtected(expectedRef));
 const binding=Object.fromEntries(['identity','toolRevision','host','epoch','holdGeneration'].map(k=>[k,data[k]]));
 requireProof(canonical(binding.identity)===canonical(session.identityBinding)&&binding.toolRevision===session.toolRevision,'HELD_PROFILE_SESSION_IDENTITY');
 return {read:queries.readHeldCandidate,context:{identity:session.identityBinding,connection:session.binding,binding,expectedReadbackRef:expectedRef,readPrivate:readProtected,verifyQualifiedExpected:expected.createQualifiedExpectedVerifier({profile,readProtected})}};
}
const MIGRATOR_LIBRARY='/usr/local/lib/workspacex-cn/cn-maintenance-migrator.cjs';
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function trustedBytes(path,mode){
 requireProof(typeof path==='string'&&path.startsWith('/')&&!path.split('/').includes('..'),'MIGRATION_TRUST_PATH');
 const st=fs.lstatSync(path);requireProof(st.isFile()&&!st.isSymbolicLink()&&st.uid===0&&st.gid===0&&st.nlink===1&&(st.mode&0o777)===mode,'MIGRATION_FILE_TRUST');
 let parent=require('node:path').dirname(path);while(true){const s=fs.lstatSync(parent);requireProof(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===0&&s.gid===0&&!(s.mode&0o022),'MIGRATION_PARENT_TRUST');if(parent==='/')break;parent=require('node:path').dirname(parent);}
 const fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const current=fs.fstatSync(fd);requireProof(current.ino===st.ino&&current.dev===st.dev&&current.size===st.size&&current.mtimeMs===st.mtimeMs,'MIGRATION_FILE_CHANGED');return fs.readFileSync(fd);}finally{fs.closeSync(fd);}
}
function verifyFullBaselineAdmission(identity,read=trustedBytes,now=Date.now()){
 const root='/var/lib/workspacex-cn/preflight-receipts/'+identity.sourceRevision+'/'+identity.attemptId;
 const evidence=JSON.parse(read(root+'/prebuild.json',0o600)),validated=JSON.parse(read(root+'/prebuild.validated.json',0o600));
 const b=evidence.checks?.['bootstrap.compatibility'],proof=b?.metadata;
 const issued=Date.parse(evidence.issuedAt),expires=Date.parse(evidence.expiresAt);
 requireProof(evidence.schemaVersion===2&&evidence.phase==='prebuild'&&evidence.buildStarted===false&&evidence.sourceSha===identity.sourceRevision&&evidence.baselineSha===identity.baselineRevision&&evidence.attemptId===identity.attemptId&&Number.isFinite(issued)&&Number.isFinite(expires)&&issued<=now&&expires>now&&expires-issued>0&&expires-issued<=3600000&&validated.schemaVersion===2&&validated.phase==='prebuild'&&validated.ready===true&&Array.isArray(validated.blockers)&&validated.blockers.length===0&&validated.receiptSha256===sha(canonical(evidence))&&['sourceSha','baselineSha','attemptId','release','issuedAt','expiresAt'].every(k=>validated[k]===evidence[k])&&b?.status==='passed'&&/^[a-f0-9]{64}$/.test(b.evidenceSha256??'')&&proof?.evidenceMode==='source-static'&&proof.baselineSha===identity.baselineRevision&&proof.migrationPlanSha256===identity.migrationPlanSha256&&/^[a-f0-9]{64}$/.test(proof.baselineSchemaSha256??'')&&proof.baselineLedgerContract===true&&proof.baselineSchemaContract===true&&proof.baselinePermissionContract===true&&proof.candidateSchemaContract===false&&proof.buildAdmissionOnly===true&&proof.productionWriteStatements===0,'MIGRATION_BASELINE_ADMISSION_INVALID');
}
function loadFixedMigrator(auth){requireProof(sha(trustedBytes(MIGRATOR_LIBRARY,0o700))===auth.librarySha256,'MIGRATION_LIBRARY_PIN');const library=require(MIGRATOR_LIBRARY);requireProof(typeof library.migrateExistingSession==='function','MIGRATION_LIBRARY_EXPORT');return library;}
function loadRetainedRecovery(auth){const target=process.env.WSX_TRUSTED_RECOVERY_MODULE;requireProof(typeof target==='string'&&target.endsWith('/retained_session_recovery.cjs')&&sha(trustedBytes(target,0o644))===auth.librarySha256,'RECOVERY_LIBRARY_PIN');const library=require(target);requireProof(typeof library.recoverExistingSession==='function'&&typeof library.validateAuthority==='function','RECOVERY_LIBRARY_EXPORT');return library;}
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
READ_QUERIES['candidate-sessions']="BEGIN TRANSACTION READ ONLY;\nSELECT json_build_object('peer',json_build_object('database',current_database(),\n 'serverAddr',inet_server_addr()::text,'serverPort',inet_server_port(),\n 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system())),\n 'sessions',coalesce((SELECT json_agg(json_build_object('role',usename,\n 'clientAddr',client_addr::text,'clientPort',client_port,'pid',pid,\n 'backendStart',backend_start,'backendType',backend_type,'state',state,\n 'ssl',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_stat_activity.pid)))\n FROM pg_stat_activity WHERE datname=current_database()),'[]'::json),\n 'preparedTransactions',coalesce((SELECT json_agg(json_build_object('gid',gid,\n 'owner',owner,'database',database)) FROM pg_prepared_xacts\n WHERE database=current_database()),'[]'::json)); ROLLBACK;";
READ_QUERIES['migration-ledger']='BEGIN TRANSACTION READ ONLY; SELECT json_build_object(\'ledger\',coalesce((SELECT json_agg(json_build_object(\'name\',name,\'checksum\',checksum,\'appliedAt\',applied_at) ORDER BY name) FROM public._kernel_migrations),\'[]\'::json),\'rowCount\',(SELECT count(*)::int FROM public._kernel_migrations)) AS snapshot; ROLLBACK;';
READ_QUERIES['run-drain']="BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT json_build_object('rows',coalesce((SELECT json_agg(x) FROM (SELECT status,count(*)::text AS count FROM public.agent_runs GROUP BY status) x),'[]'::json)) AS snapshot; ROLLBACK;";
const RETAINED_BACKUP_HELPER='/usr/local/lib/workspacex-cn/retained_backup_helper.cjs';
const backupCleanupRequest=message=>message?.operation==='retained-fixed-backup'&&message.request?.operation==='mutation'&&['close','revoke','begin','commit','rollback'].includes(message.request.action);
function loadRetainedBackupExtension(session,ref){
 requireProof(ref&&Object.keys(ref).sort().join(',')==='path,sha256'&&ref.path===`/etc/workspacex-cn/maintenance-backup/${session.identityBinding.sourceRevision}/${session.identityBinding.attemptId}/host-plan.json`&&/^[a-f0-9]{64}$/.test(ref.sha256),'RETAINED_BACKUP_HOST_REFERENCE');
 const profile=JSON.parse(trustedBytes('/etc/workspacex-cn/trusted-tool-binding.json',0o600));
 requireProof(profile.toolRevision===session.toolRevision&&canonical(profile.backupHostPlan)===canonical(ref),'RETAINED_BACKUP_SOURCE_PROFILE');
 for(const path of [RETAINED_BACKUP_HELPER,'/usr/local/lib/workspacex-cn/backup_connection.cjs'])requireProof(sha(trustedBytes(path,0o700))===profile.installedFilesSha256?.[path],'RETAINED_BACKUP_MODULE_CLOSURE');
 return require(RETAINED_BACKUP_HELPER).initializeRetained(session,ref);
}
class ControlSession {
 constructor(clientFactory, configLoader = privateJson, migrationLibraryLoader=loadFixedMigrator, checkoutVerifier=verifyFixedMigrationCheckout, recoveryLibraryLoader=loadRetainedRecovery, Query, transportLibraryLoader=loadFixedMigrator,transportConfigReader=trustedBytes) { this.recoveryLibraryLoader=recoveryLibraryLoader;this.transportLibraryLoader=transportLibraryLoader;this.transportConfigReader=transportConfigReader;this.migrationAdmissionReader=trustedBytes;this.Query=Query;this.migrationLibraryLoader=migrationLibraryLoader;this.checkoutVerifier=checkoutVerifier;this.retainedBackupLoader=loadRetainedBackupExtension;this.factory = clientFactory; this.load = configLoader; this.client = null; this.binding = null; this.sequence = 0; this.failed = false; }
 verifyTransportAuthority() {
  const a=this.connectionTransport,now=Date.now()/1000;requireProof(a.notBefore<=now&&now<a.expiresAt,'CONTROL_TRANSPORT_EXPIRED');
  const profile=JSON.parse(this.transportConfigReader('/etc/workspacex-cn/trusted-tool-binding.json',0o600)),frozen=profile.existingProductionTransport;
  requireProof(profile.toolRevision===a.toolRevision&&profile.installedFilesSha256?.[MIGRATOR_LIBRARY]===a.librarySha256&&frozen&&Object.keys(frozen).sort().join(',')==='allowedCidrs,configurationSha256,ecsInstanceId,privateAddress,rdsInstanceId'&&frozen.configurationSha256===a.configurationSha256&&frozen.ecsInstanceId==='i-uf6ga92ewloganobbln6'&&frozen.rdsInstanceId==='pgm-uf6rg214cp381l49'&&frozen.privateAddress==='192.168.100.44'&&canonical(frozen.allowedCidrs)===canonical(['192.168.100.40/32']),'CONTROL_FROZEN_TRANSPORT_PROFILE');
  const raw=this.transportConfigReader(a.configurationPath,0o600),environment=JSON.parse(raw).environment;
  requireProof(sha(raw)===a.configurationSha256&&a.source.configurationSha256===a.configurationSha256&&environment?.profile==='production'&&environment.ecsInstanceId===frozen.ecsInstanceId&&environment.rdsInstanceId===frozen.rdsInstanceId&&a.source.dbInstanceId===frozen.rdsInstanceId&&canonical(environment.rdsTlsException)===canonical(a.approvedRdsTlsException)&&canonical(a.approvedRdsTlsException?.allowedCidrs)===canonical(frozen.allowedCidrs),'CONTROL_EXISTING_CONFIGURATION_PIN');
  return frozen;
 }
 async identity() {
 const result=await this.client.query(ID_SQL);requireProof(result.rows.length===1,'CONTROL_IDENTITY_PROTOCOL');const value=result.rows[0].identity,stream=this.client.connection?.stream;
 requireProof(stream&&typeof stream.remoteAddress==='string'&&Number.isSafeInteger(stream.remotePort)&&typeof stream.localAddress==='string'&&Number.isSafeInteger(stream.localPort),'CONTROL_SOCKET_IDENTITY');
 const socket={remoteAddress:stream.remoteAddress,remotePort:stream.remotePort,localAddress:stream.localAddress,localPort:stream.localPort,encrypted:stream.encrypted===true,authorized:stream.authorized===true};
 let transport;
 if(this.connectionTransport){
  const a=this.connectionTransport;this.verifyTransportAuthority();
  transport=this.transportLibrary.verifyExistingMaintenanceTransport(a,{database:value.peer.database,user:value.role,serverAddress:value.peer.serverAddr,serverPort:value.peer.serverPort,...socket});
  requireProof(value.tls.ssl===(a.source.sslMode==='verify-full'),'CONTROL_SQL_SOCKET_TRANSPORT');
 }else requireProof(socket.encrypted&&socket.authorized&&value.tls.ssl===true,'CONTROL_SOCKET_TLS_IDENTITY');
 return {...value,socket,...(transport?{transport}:{})};
 }
 async handle(message) {
  requireProof((!this.failed||backupCleanupRequest(message)) && Number.isSafeInteger(message.sequence) && message.sequence === this.sequence + 1, 'CONTROL_SEQUENCE'); this.sequence = message.sequence;
  try {
   if (message.operation === 'connect') {
    requireProof(!this.client && ['verify-full','disable'].includes(message.sslMode) && typeof message.applicationName === 'string' && ['control','diagnostic'].includes(message.mode) && message.applicationName === 'wsx-maintenance-'+message.mode+'-' + message.identity.attemptId, 'CONTROL_CONNECT_AUTHORITY');
    const config = this.load(message.serviceFile); const target = config.databases[message.database];
    requireProof(target&&target.database===message.database,'CONTROL_TARGET_CONFIG');
    this.connectionTransport=message.connectionTransport?structuredClone(message.connectionTransport):null;
    if(this.connectionTransport){
     const a=this.connectionTransport,keys=['schemaVersion','kind','identity','toolRevision','librarySha256','source','sourceEvidence','approvedRdsTlsException','sslResponse','allowlistResponse','notBefore','expiresAt','configurationPath','configurationSha256'];
     requireProof(Object.keys(a).sort().join(',')===keys.sort().join(',')&&a.schemaVersion===1&&a.kind==='existing-production-maintenance-transport'&&canonical(a.identity)===canonical(message.identity)&&Object.keys(a.identity).sort().join(',')==='attemptId,baselineRevision,migrationPlanSha256,sourceRevision'&&a.identity.sourceRevision===FIXED_APP&&a.identity.baselineRevision===FIXED_BASE&&/^[a-f0-9]{64}$/.test(a.identity.migrationPlanSha256)&&/^[A-Za-z0-9-]{1,128}$/.test(a.identity.attemptId)&&a.toolRevision===message.toolRevision&&/^[a-f0-9]{40}$/.test(a.toolRevision)&&a.configurationPath===`/etc/workspacex-cn/maintenance-host/${FIXED_APP}/${a.identity.attemptId}/approved-baseline-deployment.json`&&/^[a-f0-9]{64}$/.test(a.configurationSha256)&&Number.isFinite(a.notBefore)&&Number.isFinite(a.expiresAt)&&a.expiresAt>a.notBefore&&a.expiresAt-a.notBefore<=3600&&a.source.database===target.database&&a.source.user===target.user&&a.source.sslMode==='disable'&&a.source.sslMode===message.sslMode&&a.notBefore<=Date.now()/1000&&Date.now()/1000<a.expiresAt&&a.source.endpointSha256===sha(target.host+':'+target.port),'CONTROL_TRANSPORT_AUTHORITY');
     this.transportLibrary=this.transportLibraryLoader(a);requireProof(typeof this.transportLibrary.verifyExistingMaintenanceTransport==='function'&&typeof this.transportLibrary.approveExistingMaintenanceTransportInputs==='function','CONTROL_TRANSPORT_LIBRARY');
     requireProof(Date.now()/1000-a.notBefore<=300,'CONTROL_TRANSPORT_INITIAL_FRESHNESS');
     const frozen=this.verifyTransportAuthority();
     this.transportEndpoint=this.transportLibrary.approveExistingMaintenanceTransportInputs(a);requireProof(this.transportEndpoint.privateAddress===frozen.privateAddress,'CONTROL_PRIVATE_ENDPOINT');
    }
    let ssl;
    if(message.sslMode==='disable'){requireProof(this.connectionTransport&&target.ssl===false,'CONTROL_NO_TLS_UNAPPROVED');ssl=false;}
    else{requireProof(target.ssl?.rejectUnauthorized===true&&target.ssl.caFile===message.caFile,'CONTROL_TLS_CONFIG');ssl={rejectUnauthorized:true,ca:fs.readFileSync(message.caFile)};}
    const options={...target,ssl,application_name:message.applicationName,connectionTimeoutMillis:10000,query_timeout:10000,statement_timeout:10000};
    if(options.ssl)delete options.ssl.caFile; this.options=options;this.toolRevision=message.toolRevision;this.identityBinding=message.identity;this.migrationAuthorization=message.migrationAuthorization?structuredClone(message.migrationAuthorization):null;this.recoveryAuthorization=message.recoveryAuthorization?structuredClone(message.recoveryAuthorization):null;this.backupHostReference=message.backupHostReference?structuredClone(message.backupHostReference):null;this.diagnosticRole=message.diagnosticRole;this.mode=message.mode; this.client = this.factory(this.transportEndpoint?{...options,host:this.transportEndpoint.privateAddress}:options);requireProof(typeof this.client.connection?.on==='function','CONTROL_TRANSACTION_STATE_REQUIRED');this.client.connection.on('readyForQuery',value=>{this.transactionStatus=value.status;}); this.client.on('error', () => { this.failed = true; }); await this.client.connect();
    this.binding = await this.identity(); requireProof(this.binding.peer.database === message.database && this.binding.tls.ssl === (message.sslMode==='verify-full'), 'CONTROL_TLS_IDENTITY');
    if(this.mode==='control'){requireProof(Array.isArray(message.roleTargets)&&message.roleTargets.length>0,'CONTROL_ROLE_TARGETS');const proof=await this.client.query("SELECT ((SELECT rolsuper FROM pg_roles WHERE rolname=current_user) OR has_table_privilege(current_user,'pg_catalog.pg_authid','UPDATE')) AS catalog_lock_authority, ((SELECT rolsuper FROM pg_roles WHERE rolname=current_user) OR ((SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user) AND NOT EXISTS(SELECT 1 FROM unnest($1::text[]) target(name) WHERE NOT EXISTS(SELECT 1 FROM pg_roles r JOIN pg_auth_members m ON m.roleid=r.oid JOIN pg_roles actor ON actor.oid=m.member WHERE r.rolname=target.name AND actor.rolname=current_user AND m.admin_option)))) AS alter_role_authority",[message.roleTargets]);requireProof(proof.rows.length===1,'CONTROL_CAPABILITY_PROTOCOL');this.capabilities={catalogLockAuthority:proof.rows[0].catalog_lock_authority,alterRoleAuthority:proof.rows[0].alter_role_authority};requireProof(this.capabilities.catalogLockAuthority===true&&this.capabilities.alterRoleAuthority===true,'CONTROL_ROLE_CAPABILITY');}
   } else {
    if(message.operation==='bind-retained-backup'){
     requireProof(Object.keys(message).sort().join(',')==='hostReference,operation,sequence'&&this.mode==='control'&&this.client&&this.transactionStatus==='I'&&!this.retainedBackup&&this.backupHostReference&&canonical(message.hostReference)===canonical(this.backupHostReference),'RETAINED_BACKUP_BIND_AUTHORITY');
     const value=await this.retainedBackupLoader(this,this.backupHostReference);this.retainedBackup=value;
     requireProof(canonical(value.binding)===canonical(this.binding),'RETAINED_BACKUP_SESSION_BINDING');
     return {sequence:this.sequence,ok:true,connection:this.binding,value:{protocol:value.protocol}};
    }
    if(message.operation==='retained-fixed-backup'){
     requireProof(Object.keys(message).sort().join(',')==='operation,protocol,request,sequence'&&this.mode==='control'&&this.retainedBackup,'RETAINED_BACKUP_PROTOCOL_AUTHORITY');
     const reply=await this.retainedBackup.dispatch(message.protocol,message.request);
     requireProof(canonical(reply.connection)===canonical(this.binding),'RETAINED_BACKUP_RESPONSE_SESSION');
     return {...reply,sequence:this.sequence};
    }
    if(message.operation==='recover-existing-session'){
     requireProof(Object.keys(message).sort().join(',')==='identity,operation,sequence'&&this.mode==='control'&&this.client&&this.recoveryAuthorization&&typeof this.Query==='function'&&!this.recoveryStarted&&this.transactionStatus==='I'&&canonical(message.identity)===canonical(this.identityBinding),'RECOVERY_EXISTING_SESSION_AUTHORITY');
     const library=this.recoveryLibraryLoader(this.recoveryAuthorization);library.validateAuthority(this.recoveryAuthorization,this.identityBinding,this.toolRevision);
     requireProof(canonical(await this.identity())===canonical(this.binding),'RECOVERY_CONNECTION_CHANGED');this.recoveryStarted=true;
     const value=await library.recoverExistingSession({client:this.client,Query:this.Query,binding:this.binding,mode:this.mode,identityBinding:this.identityBinding,toolRevision:this.toolRevision,diagnosticRole:this.diagnosticRole,identity:()=>this.identity(),transactionStatus:()=>this.transactionStatus},this.recoveryAuthorization);
     requireProof(this.transactionStatus==='I'&&canonical(await this.identity())===canonical(this.binding)&&value.database===this.binding.peer.database&&value.existingSession===true&&value.decoderJoined===true&&value.dataFidelityVerified===true&&value.ready===false,'RECOVERY_RESULT_BINDING');
     return {sequence:this.sequence,ok:true,connection:this.binding,value};
    }
    if(message.operation==='migrate-exact-plan'){
     requireProof(this.mode==='control'&&this.client&&this.binding.peer.database==='workspacex'&&!this.migrationStarted,'MIGRATION_EXISTING_SESSION_REQUIRED');
     requireProof(this.transactionStatus==='I','MIGRATION_CONTROL_TRANSACTION_NOT_IDLE');const auth=validateMigrationAuthorization(this.migrationAuthorization,this.identityBinding);requireProof(auth.toolRevision===this.toolRevision,'MIGRATION_TOOL_BINDING');requireProof(canonical(message.identity)===canonical(this.identityBinding),'MIGRATION_CALL_IDENTITY');this.checkoutVerifier(auth);
     requireProof(canonical(await this.identity())===canonical(this.binding),'MIGRATION_CONNECTION_CHANGED');
     const ledger=await this.client.query('SELECT name,checksum FROM public._kernel_migrations ORDER BY name');requireProof(canonical(ledger.rows)===canonical(auth.baselineLedger),'MIGRATION_BASELINE_LEDGER_DRIFT');
     verifyFullBaselineAdmission(this.identityBinding,this.migrationAdmissionReader);
     const library=this.migrationLibraryLoader(auth);this.migrationStarted=true;
     const value=await library.migrateExistingSession(this.client,this.options,auth.migrationSource,auth.sourceEvidence,auth.approvedRdsTlsException,auth.checkout+'/apps/api/migrations',auth.lockTimeoutMs);
     requireProof(canonical(await this.identity())===canonical(this.binding)&&canonical(value.applied)===canonical(auth.pending.map(r=>r.name))&&canonical(value.skipped)===canonical(auth.baselineLedger.map(r=>r.name)),'MIGRATION_RESULT_BINDING');
     return {sequence:this.sequence,ok:true,connection:this.binding,value};
    }
    if(message.operation==='verify-live-transport'){
     requireProof(this.mode==='diagnostic'&&this.connectionTransport&&Object.keys(message).sort().join(',')==='operation,provider,sequence','LIVE_TRANSPORT_AUTHORITY');
     requireProof(canonical(await this.identity())===canonical(this.binding),'LIVE_TRANSPORT_CONNECTION_CHANGED');
     const value=this.transportLibrary.verifyFreshMaintenanceProviderTransport(this.connectionTransport,message.provider);
     requireProof(canonical(await this.identity())===canonical(this.binding),'LIVE_TRANSPORT_CONNECTION_CHANGED');
     requireProof(value.sslMode==='disable'&&value.instanceId==='pgm-uf6rg214cp381l49','LIVE_TRANSPORT_EXCEPTION_REQUIRED');
     const proof={sslMode:value.sslMode,configurationSha256:value.configurationSha256,providerEvidenceSha256:value.providerEvidenceSha256};
     return {sequence:this.sequence,ok:true,connection:this.binding,value:{schemaVersion:1,kind:'existing-production-maintenance-transport-verified',identity:this.connectionTransport.identity,peer:this.binding.peer,endpoint:{address:value.privateAddress,port:value.port},observedAt:Date.now()/1000,proof}};
    }
    if(message.operation==='query'&&message.queryId==='owned-release-runs'){
     requireProof(Object.keys(message).sort().join(',')==='operation,params,queryId,sequence'&&this.mode==='diagnostic'&&this.client&&this.binding.peer.database==='workspacex'&&this.transactionStatus==='I','OWNED_RUN_READ_AUTHORITY');
     const p=message.params,ids=p?.runIds;
     requireProof(p&&Object.keys(p).join(',')==='runIds'&&Array.isArray(ids)&&ids.length>=1&&ids.length<=128&&new Set(ids).size===ids.length&&ids.every(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id)),'OWNED_RUN_ID_SCOPE');
     requireProof(canonical(await this.identity())===canonical(this.binding),'OWNED_RUN_CONNECTION_CHANGED');
     let rows;
     try{
      await this.client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await this.client.query("SET LOCAL statement_timeout='5000ms'");
      const mode=await this.client.query("SELECT current_setting('transaction_read_only') AS readonly");
      requireProof(mode.rows.length===1&&mode.rows[0].readonly==='on','OWNED_RUN_TRANSACTION_NOT_READONLY');
      const result=await this.client.query('SELECT id,status FROM public.agent_runs WHERE id=ANY($1::text[]) ORDER BY id',[ids]);rows=result.rows;
      requireProof(Array.isArray(rows)&&rows.length===ids.length&&rows.every(r=>Object.keys(r).sort().join(',')==='id,status'&&ids.includes(r.id)&&typeof r.status==='string')&&new Set(rows.map(r=>r.id)).size===ids.length,'OWNED_RUN_RESULT_SCOPE');
     }finally{await this.client.query('ROLLBACK');}
     requireProof(this.transactionStatus==='I'&&canonical(await this.identity())===canonical(this.binding),'OWNED_RUN_ROLLBACK_OR_CONNECTION_UNKNOWN');
     return {sequence:this.sequence,ok:true,connection:this.binding,value:{rows,readOnly:true,rollbackComplete:true,observedAt:Date.now()/1000}};
    }
    if (message.operation === 'query') {
     if(['held-candidate-schema','held-candidate-permissions','held-candidate-seed'].includes(message.queryId)){
      requireProof(Object.keys(message).sort().join(',')==='operation,params,queryId,sequence'&&this.mode==='diagnostic'&&this.client&&this.transactionStatus==='I','HELD_READBACK_AUTHORITY');
      const bound=loadHeldCandidateContext(this),value=await bound.read(this,message.queryId,message.params,bound.context);
      return {sequence:this.sequence,ok:true,connection:this.binding,value};
     }
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
 const { Client,Query } = require(pgPath); const session = new ControlSession(config => new Client(config),undefined,undefined,undefined,undefined,Query);
 let buffer = ''; let chain = Promise.resolve();
 process.stdin.setEncoding('utf8');
 process.stdin.on('data', chunk => {
  buffer += chunk; if (buffer.length > 1024 * 1024) { process.exitCode = 1; process.stdin.destroy(); return; }
  while (buffer.includes('\n')) { const index = buffer.indexOf('\n'); const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
   chain = chain.then(async () => { const reply = await session.handle(JSON.parse(line)); process.stdout.write(JSON.stringify(reply) + '\n'); }).catch(() => { session.failed=true;process.stdout.write(JSON.stringify({sequence:session.sequence,ok:false,code:'CONTROL_PROTOCOL_REJECTED',holdDisposition:'retain'})+'\n'); });
  }
 });
 process.stdin.on('end', () => { chain.finally(() => {if(!session.failed)return session.close();}); });
}
module.exports = { verifyFullBaselineAdmission, ControlSession, ID_SQL, READ_QUERIES, validateMigrationAuthorization, verifyFixedMigrationCheckout, privateJson, trustedBytes };
if (require.main === module) main().catch(() => { process.stderr.write('CONTROL_HELPER_REJECTED\n'); process.exitCode = 1; });
