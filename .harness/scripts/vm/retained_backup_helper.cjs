'use strict';
// BEGIN GENERATED RELEASE IDENTITIES
const admittedReleaseIdentity = i => !!i && ((i.sourceRevision === "9b25bfa65662b96c0826fe67506b562ea46aa6d0" && i.baselineRevision === "ba6343199f3c834d6a198f83d0c771614292c82b") || (i.sourceRevision === "5285bef9a6c91bbb9857ede42779aafa64b98f32" && i.baselineRevision === "a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0"));
// END GENERATED RELEASE IDENTITIES
// Reuses BackupConnection's protected profile/approval/table/deadline/SCRAM
// admission and fixed-operation compiler. No Client factory is ever called.
const crypto=require('node:crypto');
const {BackupConnection}=require('./backup_connection.cjs');
const {privateJson,trustedBytes}=require('./control_connection.cjs');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const protocolBytes=v=>Buffer.from(JSON.stringify(canonical(v)).replace(/[\u0080-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const need=(ok,code)=>{if(!ok)throw Error(code);};
async function initializeRetained(control,hostRef,options={}){
 need(control?.mode==='control'&&control.client&&typeof control.identity==='function'&&control.binding?.role==='migration_admin','RETAINED_BACKUP_EXISTING_CONTROL');
 need(control.capabilities?.alterRoleAuthority===true&&control.capabilities?.catalogLockAuthority===true,'RETAINED_BACKUP_ADMIN_CAPABILITY');
 const read=options.readJson||privateJson,readBytes=options.readBytes||trustedBytes;
 const profile=read('/etc/workspacex-cn/trusted-tool-binding.json');
 const library='/usr/local/lib/workspacex-cn/backup_connection.cjs';
 need(hash(readBytes(library,0o700))===profile.installedFilesSha256?.[library],'RETAINED_BACKUP_LIBRARY_PIN');
 const pinned=structuredClone(control.binding);
 need(same(await control.identity(),pinned),'RETAINED_BACKUP_LIVE_IDENTITY');
 // connect() supplies all existing protected validation. Replace only its final
 // connection admission with a check on the already retained control. Neither
 // the client factory nor ControlSession.connect may execute.
 const proxy=Object.create(control);
 proxy.handle=async message=>{
  need(message.operation==='connect'&&message.database===pinned.peer.database&&message.diagnosticRole==='migration_admin'&&message.mode==='diagnostic','RETAINED_BACKUP_ADMISSION_ONLY');
  need(same(await control.identity(),pinned),'RETAINED_BACKUP_ADMISSION_DRIFT');
  need(admittedReleaseIdentity(message.identity)&&same(message.identity,control.identityBinding),'RETAINED_BACKUP_FIXED_IDENTITY');
  need(control.transportLibrary&&typeof control.transportLibrary.verifyExistingMaintenanceTransport==='function','RETAINED_BACKUP_TRANSPORT_LIBRARY');
  const b=pinned,s=b.socket;
  control.transportLibrary.verifyExistingMaintenanceTransport(message.connectionTransport,{database:b.peer.database,user:b.role,serverAddress:b.peer.serverAddr,serverPort:b.peer.serverPort,remoteAddress:s.remoteAddress,remotePort:s.remotePort,localAddress:s.localAddress,encrypted:s.encrypted,authorized:s.authorized});
  need(same(await control.identity(),pinned),'RETAINED_BACKUP_ADMISSION_CHANGED');
  return {connection:pinned};
 };
 proxy.close=async()=>{throw Error('RETAINED_BACKUP_CLOSE_FORBIDDEN');};
 const connection=new BackupConnection(()=>{throw Error('RETAINED_BACKUP_NEW_CLIENT_FORBIDDEN');},read,readBytes,()=>proxy);
 await connection.connect(hostRef.path,hostRef.sha256,pinned.peer.database);
 const protocol={kind:'retained-fixed-backup-v1',identity:connection.host.backup.identity,toolRevision:connection.host.backup.toolRevision,database:connection.db,queriesSha256:hash(protocolBytes(connection.table)),mutationsSha256:hash(protocolBytes(connection.host.statements))};
 let readOnly=false,mutationActive=false,failed=false,cleanupAvailable=false,cleanupTransaction=false,cleanupWrites=0;
 return {protocol,binding:pinned,async dispatch(received,request){
  need(same(received,protocol),'RETAINED_BACKUP_PROTOCOL_CHANGED');
  const fresh=read('/etc/workspacex-cn/trusted-tool-binding.json');
  need(same(fresh.backupHostPlan,hostRef)&&fresh.toolRevision===protocol.toolRevision&&hash(readBytes(hostRef.path,0o600))===hostRef.sha256&&hash(readBytes(connection.host.queryTable.path,0o700))===fresh.installedFilesSha256?.[connection.host.queryTable.path],'RETAINED_BACKUP_PROTECTED_INPUT_DRIFT');
  need(hash(readBytes(library,0o700))===fresh.installedFilesSha256?.[library],'RETAINED_BACKUP_LIBRARY_DRIFT');
  for(const key of ['roleApproval','publicCapabilityApproval'])need(hash(readBytes(connection.host[key].path,0o600))===connection.host[key].sha256,'RETAINED_BACKUP_APPROVAL_DRIFT');
  if(failed){
   need(cleanupAvailable&&request.operation==='mutation'&&['close','revoke','begin','commit','rollback'].includes(request.action),'RETAINED_BACKUP_FAILED_CLEANUP_ONLY');
   connection.cleanupOnly=true;
   need(!connection.pendingPrivilegeMutation,'RETAINED_BACKUP_PRIVILEGE_PENDING');
   if(request.action==='begin')need(!cleanupTransaction,'RETAINED_BACKUP_CLEANUP_ALREADY_OPEN');
   if(['close','revoke'].includes(request.action))need(cleanupTransaction,'RETAINED_BACKUP_CLEANUP_BEGIN_REQUIRED');
   if(request.action==='commit')need(cleanupTransaction&&cleanupWrites>0,'RETAINED_BACKUP_CLEANUP_WRITES_REQUIRED');
  }
  need(same(await control.identity(),pinned),'RETAINED_BACKUP_REQUEST_IDENTITY');
  const keys=Object.keys(request).sort().join(',');
  try{
   if(request.operation==='query'){
    need(keys==='operation,queryId'&&Object.hasOwn(connection.table,request.queryId),'RETAINED_BACKUP_FIXED_QUERY');
    if(request.queryId==='begin-readonly'){need(!readOnly&&!mutationActive,'RETAINED_BACKUP_TRANSACTION_ALREADY_OPEN');readOnly=true;}
    else if(request.queryId==='rollback-readonly')need(readOnly,'RETAINED_BACKUP_NO_TRANSACTION');
    else need(readOnly||mutationActive,'RETAINED_BACKUP_READONLY_REQUIRED');
   }else if(request.operation==='verify-backup-transport'){
    need(keys==='facts,operation','RETAINED_BACKUP_TRANSPORT_REQUEST');
   }else{
    need(request.operation==='mutation','RETAINED_BACKUP_OPERATION');
    if(request.action==='login')need(keys==='action,operation,password'&&!readOnly,'RETAINED_BACKUP_LOGIN_REQUEST');
    else need(keys==='action,operation,statement'&&(request.action==='rollback'||!readOnly),'RETAINED_BACKUP_MUTATION_REQUEST');
    need(request.action!=='quiesce-owned-admin','RETAINED_BACKUP_FOREIGN_ADMIN_FORBIDDEN');
   }
   const reply=await connection.handle({...request,sequence:connection.sequence+1});
   if(request.action==='begin')mutationActive=true;
   if(['commit','rollback'].includes(request.action))mutationActive=false;
   if(request.queryId==='rollback-readonly'||request.action==='rollback')readOnly=false;
   if(failed){
    if(request.action==='begin'){cleanupTransaction=true;cleanupWrites=0;}
    if(['close','revoke'].includes(request.action))cleanupWrites++;
    if(['commit','rollback'].includes(request.action)){cleanupTransaction=false;cleanupWrites=0;}
   }
   return reply;
  }catch(_){
   failed=true;cleanupAvailable=false;connection.cleanupOnly=true;
   // A pending privilege transaction must never be committed by cleanup.
   try{await control.client.query('ROLLBACK');need(same(await control.identity(),pinned),'RETAINED_BACKUP_ROLLBACK_BINDING');readOnly=false;mutationActive=false;connection.pendingPrivilegeMutation=false;cleanupTransaction=false;cleanupWrites=0;cleanupAvailable=true;}catch(_){}
   throw Error('RETAINED_BACKUP_FIXED_OPERATION_REJECTED');
  }
 }};
}
module.exports={initializeRetained,canonical,hash};
