'use strict';
// Private fixed-query backup channel. No connection or credentials on import.
const crypto=require('node:crypto');
const {ControlSession,privateJson,trustedBytes}=require('./control_connection.cjs');
const ROLE='wsx_release_backup_ro';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const need=(ok,code)=>{if(!ok)throw Error(code);};
const literal=v=>{need(typeof v==='string'&&!/[\0\r\n]/.test(v),'BACKUP_LITERAL');return "'"+v.replaceAll("'","''")+"'";};
function scramVerifier(password,salt=crypto.randomBytes(16)){
 need(typeof password==='string'&&/^[A-Za-z0-9_-]{48,128}$/.test(password),'BACKUP_PASSWORD_FORMAT');
 const salted=crypto.pbkdf2Sync(password,salt,4096,32,'sha256');
 const client=crypto.createHmac('sha256',salted).update('Client Key').digest();
 const stored=crypto.createHash('sha256').update(client).digest('base64');
 const server=crypto.createHmac('sha256',salted).update('Server Key').digest('base64');
 return 'SCRAM-SHA-256$4096:'+salt.toString('base64')+'$'+stored+':'+server;
}
class BackupConnection {
 constructor(factory,read=privateJson,readBytes=trustedBytes,controlFactory=(factory,loader)=>new ControlSession(factory,loader)){this.factory=factory;this.read=read;this.readBytes=readBytes;this.controlFactory=controlFactory;this.sequence=0;}
 async connect(planPath,planSha,db){
  const raw=this.readBytes(planPath,0o600);need(sha(raw)===planSha,'BACKUP_HOST_PIN');
  const h=this.host=JSON.parse(raw),p=h.backup,a=p.authorization,now=Date.now()/1000;
  need(planPath===`/etc/workspacex-cn/maintenance-backup/${p.identity.sourceRevision}/${p.identity.attemptId}/host-plan.json`&&h.identity&&same(h.identity,p.identity)&&a.identity&&same(a.identity,p.identity)&&a.action==='bounded-three-db-backup-read'&&a.notBefore<=now&&(this.cleanupOnly||now<a.expiresAt)&&a.expiresAt-a.notBefore<=3600&&['workspacex','workspacex_agent','workspacex_memory'].includes(db),'BACKUP_HOST_AUTHORITY');
  const profile=this.read('/etc/workspacex-cn/trusted-tool-binding.json');
  need(profile.toolRevision===p.toolRevision&&profile.backupHostPlan?.path===planPath&&profile.backupHostPlan?.sha256===planSha,'BACKUP_HOST_PROFILE');
  for(const [key,hashKey] of [['roleApproval','roleApprovalSha256'],['publicCapabilityApproval','publicCapabilityApprovalSha256']]){
   const ref=h[key];
   need(ref.path===`/etc/workspacex-cn/backup-approvals/${p.identity.attemptId}/${key==='roleApproval'?'role':'public-capability'}.json`,'BACKUP_APPROVAL_PATH');
   const bytes=this.readBytes(ref.path,0o600),v=JSON.parse(bytes);
   need(Object.keys(v).sort().join(',')==='action,allowedPublicTemp,ecsInstanceId,expiresAt,functions,identity,notBefore,rdsInstanceId,role,schemaVersion'&&v.schemaVersion===1&&v.role===ROLE&&same(v.functions,p.functionBodies)&&Array.isArray(v.allowedPublicTemp)&&new Set(v.allowedPublicTemp).size===v.allowedPublicTemp.length&&v.allowedPublicTemp.every(d=>['workspacex','workspacex_agent','workspacex_memory'].includes(d))&&(v.allowedPublicTemp.length===0||(key==='publicCapabilityApproval'&&same(v.allowedPublicTemp,['workspacex','workspacex_agent','workspacex_memory']))),'BACKUP_APPROVAL_SCOPE');
   need(sha(bytes)===ref.sha256&&ref.sha256===a[hashKey]&&v.action===a.action&&same(v.identity,p.identity)&&v.rdsInstanceId===a.rdsInstanceId&&v.ecsInstanceId===a.ecsInstanceId&&v.expiresAt===a.expiresAt&&v.notBefore===a.notBefore,'BACKUP_APPROVAL_RECORD');
  }
  const tableBytes=this.readBytes(h.queryTable.path,0o700);
  need(sha(tableBytes)===h.queryTable.sha256&&profile.installedFilesSha256?.[h.queryTable.path]===h.queryTable.sha256,'BACKUP_QUERY_TABLE_PIN');
  this.table=JSON.parse(tableBytes);this.db=db;
  const sourceSecret=this.read(h.connection.serviceFile),credential=sourceSecret.credential??sourceSecret;
  need(credential.user==='migration_admin'&&credential.port===5432&&credential.host==='pgm-uf6rg214cp381l49.rwlb.rds.aliyuncs.com'&&typeof credential.password==='string'&&credential.password&&!/[\0\r\n]/.test(credential.password),'BACKUP_ADMIN_REFERENCE');
  const config={databases:{[db]:{database:db,host:credential.host,port:5432,user:credential.user,password:credential.password,ssl:false}}};
  // Reuse authoritative source/profile/provider/socket guard; separate channel
  // from all-writer operations. This private admin connection is not app_diag_ro.
  this.control=this.controlFactory(this.factory,path=>{need(path===h.connection.serviceFile,'BACKUP_SECRET_REFERENCE');return config;});
  const transport=h.connection.transport,providerProofs={};
  need(Object.keys(transport).sort().join(',')==='workspacex,workspacex_agent,workspacex_memory','BACKUP_PROVIDER_DATABASE_CLOSURE');
  for(const name of Object.keys(transport)){
   const proof=transport[name];
   need(proof.configurationSha256===p.configurationSha256&&proof.source.configurationSha256===p.configurationSha256&&proof.source.database===name&&proof.source.user==='migration_admin','BACKUP_CONFIGURATION_BINDING');
   providerProofs[name]=proof.source.providerEvidenceSha256;
  }
  need(sha(JSON.stringify(canonical(providerProofs)))===p.providerBindingSha256,'BACKUP_PROVIDER_BINDING');
  const auth=transport[db];
  need(auth.notBefore<=a.notBefore&&a.expiresAt+120<=auth.expiresAt&&auth.expiresAt-auth.notBefore<=3600,'BACKUP_CLEANUP_TRANSPORT_RESERVE');
  await this.control.handle({sequence:1,operation:'connect',database:db,mode:'diagnostic',diagnosticRole:'migration_admin',serviceFile:h.connection.serviceFile,caFile:'/nonexistent',sslMode:'disable',connectionTransport:auth,toolRevision:p.toolRevision,identity:p.identity,applicationName:'wsx-maintenance-diagnostic-'+p.identity.attemptId});
  this.binding=this.control.binding;
  need(this.binding.role==='migration_admin'&&this.binding.peer.database===db,'BACKUP_ADMIN_SESSION');
 }
 async handle(m){
  need(Number.isSafeInteger(m.sequence)&&m.sequence===++this.sequence,'BACKUP_SEQUENCE');
  if(!(m.operation==='mutation'&&m.action==='rollback'))need(JSON.stringify(await this.control.identity())===JSON.stringify(this.binding),'BACKUP_ADMIN_SESSION_DRIFT');
  let sql,params=[];
  if(m.operation==='verify-backup-transport'){
   need(Object.keys(m).sort().join(',')==='facts,operation,sequence','BACKUP_TRANSPORT_REQUEST');
   const f=m.facts,p=this.host.backup;
   need(f.database===this.db&&same(f.identity,p.identity)&&f.session.role===ROLE&&f.applicationName==='wsx-backup-'+p.identity.attemptId+'-'+this.db&&f.session.applicationName===f.applicationName&&f.peer.database===this.db&&same(f.peer,this.binding.peer)&&f.socket.localAddr==='192.168.100.40'&&f.socket.remoteAddr==='192.168.100.44'&&f.socket.remotePort===5432&&f.socket.localPort===f.session.clientPort&&f.session.ssl===false,'BACKUP_ACTUAL_ROLE_TRANSPORT_BINDING');
   const spec=this.table['backup-sessions'],result=await this.control.client.query(spec.sql,spec.params);
   const items=Array.isArray(result)?result:[result],rows=items.flatMap(x=>x.rows??[]);
   const observed=rows.map(r=>r.json_build_object).find(v=>v&&v.peer&&v.sessions);
   need(observed&&same(observed.peer,f.peer)&&observed.sessions.some(r=>same(r,f.session)),'BACKUP_ACTUAL_SQL_BACKEND_RECHECK');
   const a=structuredClone(this.host.connection.transport[this.db]);
   // The approved fixed role changes only the role expectation, never provider,
   // endpoint, source CIDR or existing exception. Provider digest excludes role.
   a.source.user=ROLE;a.sourceEvidence.configuration.user=ROLE;
   this.control.transportLibrary.verifyExistingMaintenanceTransport(a,{database:this.db,user:ROLE,serverAddress:f.peer.serverAddr,serverPort:f.peer.serverPort,remoteAddress:f.socket.remoteAddr,remotePort:f.socket.remotePort,localAddress:f.socket.localAddr,encrypted:false,authorized:false});
   return {sequence:m.sequence,ok:true,connection:this.binding,rows:[{verified:true}],fields:['verified']};
  }
  if(m.operation==='query'){
   need(Object.keys(m).sort().join(',')==='operation,queryId,sequence'&&Object.hasOwn(this.table,m.queryId),'BACKUP_FIXED_QUERY');
   ({sql,params}=this.table[m.queryId]);
  }else{
   need(m.operation==='mutation'&&Object.keys(m).every(k=>['operation','action','statement','password','sequence'].includes(k)),'BACKUP_FIXED_MUTATION');
   const h=this.host,p=h.backup,a=p.authorization,now=Date.now()/1000;
   need(['create','grant','login','close','revoke','begin','commit','rollback'].includes(m.action),'BACKUP_MUTATION_ACTION');
   need(!this.cleanupOnly||['close','revoke','begin','commit','rollback'].includes(m.action),'BACKUP_CLEANUP_ONLY_OPERATION');
   // Cleanup can commit after expiry; an earlier privilege mutation cannot.
   if(m.action==='commit'&&this.pendingPrivilegeMutation)need(a.notBefore<=now&&now<a.expiresAt,'BACKUP_EXPIRED_PRIVILEGE_COMMIT');
   need(['close','revoke','begin','commit','rollback'].includes(m.action)||(a.notBefore<=now&&now<a.expiresAt),'BACKUP_LEASE_EXPIRED');
   if(m.action==='login'){
    need(typeof m.password==='string'&&m.password.length>=32&&m.password.length<=256,'BACKUP_PASSWORD_BOUND');
    sql=`ALTER ROLE "${ROLE}" PASSWORD ${literal(scramVerifier(m.password))} LOGIN`;
   }else{
    const allowed=h.statements[this.db][m.action];
    need(Array.isArray(allowed)&&Number.isInteger(m.statement)&&m.statement>=0&&m.statement<allowed.length,'BACKUP_BOUND_STATEMENT');
    sql=allowed[m.statement];
   }
  }
  const result=await this.control.client.query(sql,params),items=Array.isArray(result)?result:[result];
  if(m.operation==='mutation'){
   if(['create','grant','login'].includes(m.action))this.pendingPrivilegeMutation=true;
   if(['commit','rollback'].includes(m.action))this.pendingPrivilegeMutation=false;
  }
  need(JSON.stringify(await this.control.identity())===JSON.stringify(this.binding),'BACKUP_ADMIN_SESSION_DRIFT');
  const rows=items.flatMap(x=>x.rows??[]),fields=items.flatMap(x=>x.fields??[]).map(x=>x.name);
  return {sequence:m.sequence,ok:true,connection:this.binding,rows,fields:[...new Set(fields)]};
 }
 async close(){if(this.control)await this.control.close();}
}
async function main(){
 need(process.getuid()===0&&process.platform==='linux'&&(process.argv.length===6||(process.argv.length===7&&process.argv[6]==='--cleanup-only'))&&process.argv[2]==='--backup-json','BACKUP_ENTRY');
 const startup=privateJson(process.argv[3]),runtime=startup.connection.runtime,profile=privateJson('/etc/workspacex-cn/trusted-tool-binding.json');
 need(JSON.stringify(runtime)===JSON.stringify(profile.backupRuntime)&&profile.backupHostPlan?.path===process.argv[3]&&profile.backupHostPlan?.sha256===process.argv[4],'BACKUP_RUNTIME_PROFILE');
 need(typeof runtime.pgModulePath==='string'&&Object.hasOwn(runtime.files,runtime.pgModulePath),'BACKUP_RUNTIME_PG');
 for(const [file,expected] of Object.entries(runtime.files))need(sha(trustedBytes(file,0o644))===expected,'BACKUP_RUNTIME_FILE');
 const {Client}=require(runtime.pgModulePath),session=new BackupConnection(c=>new Client(c));
 session.cleanupOnly=process.argv.length===7;
 await session.connect(process.argv[3],process.argv[4],process.argv[5]);
 process.stdout.write(JSON.stringify({sequence:0,ok:true,connection:session.binding})+'\n');
 let buffer='',chain=Promise.resolve();process.stdin.setEncoding('utf8');
 process.stdin.on('data',chunk=>{buffer+=chunk;if(buffer.length>1048576){process.stdin.destroy();process.exitCode=1;return;}
  while(buffer.includes('\n')){const i=buffer.indexOf('\n'),line=buffer.slice(0,i);buffer=buffer.slice(i+1);
   chain=chain.then(async()=>process.stdout.write(JSON.stringify(await session.handle(JSON.parse(line)))+'\n')).catch(()=>process.stdout.write(JSON.stringify({sequence:session.sequence,ok:false,code:'BACKUP_FIXED_OPERATION_REJECTED'})+'\n'));
  }
 });process.stdin.on('end',()=>chain.finally(()=>session.close()));
}
module.exports={BackupConnection,literal,scramVerifier};
if(require.main===module)main().catch(()=>{process.stderr.write('BACKUP_CHANNEL_REJECTED\n');process.exitCode=1;});
