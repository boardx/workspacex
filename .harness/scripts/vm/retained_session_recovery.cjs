'use strict';
// BEGIN GENERATED RELEASE IDENTITIES
const admittedReleaseIdentity = i => !!i && ((i.sourceRevision === "9b25bfa65662b96c0826fe67506b562ea46aa6d0" && i.baselineRevision === "ba6343199f3c834d6a198f83d0c771614292c82b") || (i.sourceRevision === "5285bef9a6c91bbb9857ede42779aafa64b98f32" && i.baselineRevision === "a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0"));
// END GENERATED RELEASE IDENTITIES
// Only called by the persistent control helper with a root-sealed authorization.
// No Client factory, LOGIN operation, database replacement, or standalone CLI.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const {Readable}=require('node:stream');
const {superviseOfflinePipeline,restoreFromOfflinePipeline}=require('./offline_restore_pipeline.cjs');
const {verifyCatalogOnExistingRestore}=require('./existing_session_restore.cjs');
const fidelity=require('./cn-production-recovery-fidelity.cjs');
const catalog=require('./cn-production-recovery-catalog.cjs');
const DBS=['workspacex','workspacex_agent','workspacex_memory'];
const APP='9b25bfa65662b96c0826fe67506b562ea46aa6d0',BASE='ba6343199f3c834d6a198f83d0c771614292c82b',RDS='pgm-uf6rg214cp381l49';
const ENV={PATH:'/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/nonexistent',LC_ALL:'C'};
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
function proof(ok,code){if(!ok)throw Error(code);}
function validateAuthority(auth,identity,toolRevision,now=Date.now()/1000){
 const keys=['schemaVersion','kind','identity','toolRevision','planPath','planSha256','librarySha256','opensslSha256','dockerSha256','operationTimeoutMs','maxCopyBytes','notBefore','expiresAt'];
 proof(auth&&Object.keys(auth).sort().join(',')===keys.sort().join(','),'RECOVERY_AUTHORITY_SCHEMA');
 proof(auth.schemaVersion===1&&(auth.kind==='exact-source-retained-session-recovery'||auth.kind==='exact-9b-retained-session-recovery'&&identity.sourceRevision===APP)&&canonical(auth.identity)===canonical(identity)&&admittedReleaseIdentity(identity)&&/^[A-Za-z0-9-]{1,128}$/.test(identity.attemptId)&&auth.toolRevision===toolRevision&&/^[a-f0-9]{40}$/.test(toolRevision),'RECOVERY_AUTHORITY_IDENTITY');
 proof(auth.planPath===`/etc/workspacex-cn/maintenance-recovery/${identity.sourceRevision}/${identity.attemptId}/recovery-plan.json`,'RECOVERY_AUTHORITY_PATH');
 for(const key of ['planSha256','librarySha256','opensslSha256','dockerSha256'])proof(/^[a-f0-9]{64}$/.test(auth[key]),'RECOVERY_AUTHORITY_HASH');
 proof(Number.isSafeInteger(auth.operationTimeoutMs)&&auth.operationTimeoutMs>=10000&&auth.operationTimeoutMs<=1800000&&Number.isSafeInteger(auth.maxCopyBytes)&&auth.maxCopyBytes>0&&auth.maxCopyBytes<=8*1024**3,'RECOVERY_AUTHORITY_LIMIT');
 proof(Number.isFinite(auth.notBefore)&&Number.isFinite(auth.expiresAt)&&auth.notBefore<=now&&now<auth.expiresAt&&auth.expiresAt-auth.notBefore<=3600,'RECOVERY_AUTHORITY_TIME');return auth;
}
function openPinned(ref,privateFile=false){
 proof(ref&&typeof ref.path==='string'&&ref.path.startsWith('/')&&!ref.path.split('/').includes('..')&&/^[a-f0-9]{64}$/.test(ref.sha256),'RECOVERY_FILE_REF');
 for(let parent=path.dirname(ref.path);;parent=path.dirname(parent)){const s=fs.lstatSync(parent);proof(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===0&&s.gid===0&&!(s.mode&0o022),'RECOVERY_PARENT_TRUST');if(parent==='/')break;}
 const fd=fs.openSync(ref.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const s=fs.fstatSync(fd);proof(s.isFile()&&s.uid===0&&s.gid===0&&s.nlink===1&&!(s.mode&0o022)&&(!privateFile||(s.mode&0o777)===0o600),'RECOVERY_FILE_TRUST');proof(s.size>0&&s.size<=16*1024**3&&(ref.bytes===undefined||ref.bytes===s.size),'RECOVERY_FILE_SIZE');const h=crypto.createHash('sha256'),buf=Buffer.alloc(1024*1024);let offset=0,n;while((n=fs.readSync(fd,buf,0,buf.length,offset))>0){h.update(buf.subarray(0,n));offset+=n;}proof(h.digest('hex')===ref.sha256,'RECOVERY_FILE_HASH');const end=fs.fstatSync(fd);proof(end.size===s.size&&end.mtimeMs===s.mtimeMs&&end.ctimeMs===s.ctimeMs,'RECOVERY_FILE_CHANGED');return fd;}catch(error){fs.closeSync(fd);throw error;}
}
function readPinned(ref,privateFile=false,max=16*1024*1024){const fd=openPinned(ref,privateFile);try{proof(fs.fstatSync(fd).size<=max,'RECOVERY_READ_BOUND');return fs.readFileSync(fd);}finally{fs.closeSync(fd);}}
// Parameterize the single compiled diagnostic privilege SQL. It is read inside
// the restoring transaction so uncommitted ACL changes are visible before COMMIT.
async function verifyDiagnosticPrivileges(client,diagnosticRole){
 proof(typeof diagnosticRole==='string'&&diagnosticRole.length>0,'RECOVERY_DIAGNOSTIC_ROLE');
 const {READ_QUERIES}=require('./control_connection.cjs');
 const sql=READ_QUERIES.roles.replace(/^BEGIN TRANSACTION READ ONLY; /,'').replace(/; ROLLBACK;$/,'').replaceAll('current_user','$1');
 const result=await client.query(sql,[diagnosticRole]);const value=Object.values(result.rows[0]||{})[0];
 proof(result.rows.length===1&&value?.currentRole===diagnosticRole&&value.diagnosticPrivileges&&Object.values(value.diagnosticPrivileges).every(x=>x===false),'RECOVERY_DIAGNOSTIC_WRITE_PRIVILEGE');
 const role=value.roles?.find(r=>r.name===diagnosticRole);proof(role&&role.login===true&&['superuser','createRole','createDb','replication','bypassRls'].every(k=>role[k]===false),'RECOVERY_DIAGNOSTIC_ROLE_PRIVILEGE');
 return {diagnosticRole,writePrivilegesAbsent:true};
}
async function recoverExistingSession(context,auth,fixture){
 const io=fixture||{spawn,execFileSync,readPinned,openPinned,close:fs.closeSync,assertHost:()=>{
  proof(!fs.existsSync('/nonexistent'),'RECOVERY_DOCKER_CONFIG_MUST_BE_ABSENT');
  const inherited=fs.fstatSync(9),current=fs.lstatSync('/var/lib/workspacex-cn/runtime/release.lock');proof(current.isFile()&&!current.isSymbolicLink()&&current.uid===0&&current.gid===0&&(current.mode&0o777)===0o600&&current.nlink===1&&inherited.dev===current.dev&&inherited.ino===current.ino,'RECOVERY_CANONICAL_FD9');
 }};
 validateAuthority(auth,context.identityBinding,context.toolRevision);proof(context.mode==='control'&&DBS.includes(context.binding.peer.database)&&context.transactionStatus()==='I','RECOVERY_RETAINED_SESSION');
 const p=JSON.parse(io.readPinned({path:auth.planPath,sha256:auth.planSha256},true));const db=context.binding.peer.database,item=p.databases?.[db];
 proof(canonical(p.identity)===canonical(auth.identity)&&p.toolRevision===auth.toolRevision&&p.production?.instanceId===RDS&&Object.keys(p.databases).sort().join(',')===[...DBS].sort().join(',')&&item?.database===db&&item.sourceRdsInstanceId===RDS&&item.baselineRevision===auth.identity.baselineRevision,'RECOVERY_PLAN_IDENTITY');
 proof(p.authorization?.action==='replace-three-production-databases-with-exact-baseline'&&canonical(p.authorization.identity)===canonical(auth.identity)&&p.authorization.productionInstanceId===RDS&&p.authorization.notBefore<=Date.now()/1000&&Date.now()/1000<p.authorization.expiresAt,'RECOVERY_PLAN_ACTION');
 proof(canonical(p.production.databasePeers[db])===canonical(context.binding.peer)&&context.binding.role==='migration_admin'&&((context.binding.socket?.authorized===true&&context.binding.tls?.ssl===true)||(context.binding.transport?.sslMode==='disable'&&context.binding.socket?.encrypted===false&&context.binding.socket?.authorized===false&&context.binding.socket?.localAddress==='192.168.100.40'&&context.binding.tls?.ssl===false)),'RECOVERY_PEER_BINDING');
 const stream=context.client.connection.stream,peer=p.production.transportPeers[db];proof(hash(stream.remoteAddress.replace(/^::ffff:/,''))===peer.peerAddressSha256&&stream.remotePort===peer.port,'RECOVERY_TRANSPORT_PEER');
 await catalog.verifyBorrowedTransport(context.client,{peerSha256:peer.peerAddressSha256,port:peer.port,username:context.binding.role,database:db},async()=>{const live=await context.identity();proof(canonical(live)===canonical(context.binding),'RECOVERY_TRANSPORT_CHANGED');return live;});
 proof(/^sha256:[a-f0-9]{64}$/.test(p.clientImage)&&Array.isArray(item.completeClusterRoleNames)&&item.completeClusterRoleNames.length>0&&item.dumpExitCode===0&&item.encryptionExitCode===0&&Number.isSafeInteger(item.dumpBytes)&&item.dumpBytes>0&&item.dumpBytes<=16*1024**3&&item.recipientCertificateSha256===p.recipientCertificate.sha256,'RECOVERY_BACKUP_BINDING');
 const binaries=[];try{binaries.push(io.openPinned({path:'/usr/bin/openssl',sha256:auth.opensslSha256}));binaries.push(io.openPinned({path:'/usr/bin/docker',sha256:auth.dockerSha256}));}catch(error){for(const fd of binaries)io.close(fd);throw error;}
 const [opensslFd,dockerFd]=binaries;
 const children=new Set(),processes=[];let catalogResult,dataResult;
 const deadline=Math.min(Date.now()+auth.operationTimeoutMs,auth.expiresAt*1000,p.authorization.expiresAt*1000);
 const dockerArgs=args=>['--config','/nonexistent','--host','unix:///var/run/docker.sock',...args];
 const command=(args)=>io.execFileSync('/proc/self/fd/3',dockerArgs(args),{env:ENV,stdio:['ignore','pipe','ignore',dockerFd],encoding:'utf8',timeout:Math.max(1,Math.min(10000,deadline-Date.now())),maxBuffer:1024*1024});
 const remaining=()=>{const n=deadline-Date.now();proof(n>=100,'RECOVERY_OPERATION_DEADLINE');return n;};
 async function cleanup(name){
  if(!children.has(name))return;
  const args=['ps','--all','--no-trunc','--filter','name=^/'+name+'$','--format','{{.ID}}'],id=command(args).trim();
  if(id){proof(/^[a-f0-9]{64}$/.test(id),'RECOVERY_OFFLINE_CONTAINER_ID');const actual=JSON.parse(command(['inspect','--type','container',id]));proof(actual.length===1&&actual[0].Id===id&&actual[0].Name==='/'+name&&actual[0].Image===p.clientImage&&actual[0].HostConfig.NetworkMode==='none'&&actual[0].HostConfig.ReadonlyRootfs===true,'RECOVERY_OFFLINE_CONTAINER_OWNERSHIP');command(['rm','--force',id]);}
  proof(command(args).trim()==='','RECOVERY_OFFLINE_CONTAINER_RETAINED');children.delete(name);
 }
 function pipeline(mode){
  const name='wsx-offline-restore-'+crypto.randomUUID();children.add(name);let decrypt,decoder;
  const descriptors=[];
  // Inherited opened descriptors prevent pathname substitution for CMS inputs.
  try{
   // Each decode gets independently opened descriptions at offset zero. dup of
   // one consumed archive/key FD would silently start a later decode at EOF.
   for(const [ref,privateFile] of [[p.recipientCertificate,false],[p.recipientKey,true],[item.ciphertext,true]])descriptors.push(io.openPinned(ref,privateFile));
   const [certFd,keyFd,archiveFd]=descriptors;const deadlineMs=remaining();
   decrypt=io.spawn('/proc/self/fd/5',['cms','-decrypt','-binary','-inform','DER','-recip','/proc/self/fd/3','-inkey','/proc/self/fd/4'],{env:ENV,stdio:[archiveFd,'pipe','ignore',certFd,keyFd,opensslFd]});
   decrypt.on('error',()=>{});processes.push({child:decrypt,closed:new Promise(resolve=>decrypt.once('close',resolve))});
   const args=['run','--rm','--pull','never','--name',name,'-i','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--log-driver','none','--pids-limit','128','--memory','512m','--cpus','1','--tmpfs','/tmp:rw,noexec,nosuid,size=67108864','--entrypoint','/bin/sh',p.clientImage,'-c'];
   // TOC-only pg_restore may leave unread archive bytes. Drain the remaining input
   // so decrypt EOF+exit still proves the complete CMS stream was consumed.
   if(mode==='toc')args.push('pg_restore --list; result=$?; cat >/dev/null; exit "$result"');
   else args.push(mode==='restore'?'exec pg_restore --exit-on-error --clean --if-exists --file=-':'exec pg_restore --exit-on-error --data-only --file=-');
   decoder=io.spawn('/proc/self/fd/3',dockerArgs(args),{env:ENV,stdio:['pipe','pipe','ignore',dockerFd]});
   decoder.on('error',()=>{});processes.push({child:decoder,closed:new Promise(resolve=>decoder.once('close',resolve))});
   return {decrypt,decoder,deadlineMs,killGraceMs:2000,expectedInputBytes:item.dumpBytes,afterAbort:()=>cleanup(name),name};
  }finally{for(const fd of descriptors)io.close(fd);}
 }
 async function consume(mode,consumer){const spec=pipeline(mode);let supervisor;try{supervisor=superviseOfflinePipeline(spec);const result=await consumer(supervisor.rawOutput());await supervisor.verifyCompletion();children.delete(spec.name);return result;}catch(error){try{await supervisor?.abortAndJoin();await cleanup(spec.name);}catch{}throw error;}}
 // A total wall deadline covers SQL and precommit fidelity, not just decoding.
 // Losing the retained connection is an unknown recovery outcome; LOGIN stays closed.
 const oldTimeout=context.client.connectionParameters?.query_timeout;
 if(context.client.connectionParameters)context.client.connectionParameters.query_timeout=auth.operationTimeoutMs;
 const timer=setTimeout(()=>context.client.connection.stream.destroy(),Math.max(1,deadline-Date.now()));
 try{
  io.assertHost();
  const image=JSON.parse(command(['image','inspect',p.clientImage]));proof(image.length===1&&image[0].Id===p.clientImage&&image[0].Os==='linux'&&image[0].Architecture==='amd64'&&canonical(image[0].Config.Labels||{})===canonical(p.clientImageLabels),'RECOVERY_OFFLINE_IMAGE_PIN');
  const sourceRaw=io.readPinned(item.sourceCatalog);const sourceBinding=JSON.parse(sourceRaw).binding;
  proof(sourceBinding.side==='source'&&sourceBinding.database===db&&sourceBinding.instanceId===RDS&&sourceBinding.backupReceiptSha256===item.backupReceiptSha256,'RECOVERY_SOURCE_CATALOG_BINDING');
  const targetBinding={side:'target',attemptId:auth.identity.attemptId,database:db,username:context.binding.role,instanceId:RDS,providerBindingSha256:p.production.providerBindingSha256,backupReceiptSha256:item.backupReceiptSha256,peerSha256:peer.peerAddressSha256,port:peer.port};
  const sourceFacts=catalog.verifyCaptureArtifact(sourceRaw,sourceBinding,item.sourceCatalog.sha256,item.sourceCatalogSha256).facts;
  const current=await catalog.capture(context.client,targetBinding,item.completeClusterRoleNames);
  // --clean only drops archive-owned objects. Do not spend a restore and then
  // discover unsupported candidate additions; they need a separately approved,
  // exact object removal plan, not a blanket schema CASCADE.
  for(const [field,keys] of [['namespaces',['name']],['relations',['schema','name','kind']],['types',['schema','name','kind']],['functions',['schema','name','arguments','kind']],['extensions',['name']]]){
   const key=row=>canonical(Object.fromEntries(keys.map(k=>[k,row[k]])));const original=new Set(sourceFacts[field].map(key));
   proof(current.facts[field].every(row=>original.has(key(row))),'RECOVERY_EXTRA_OBJECT_REMOVAL_PLAN_REQUIRED');
  }
  const toc=await consume('toc',async input=>{const chunks=[];let bytes=0;for await(const b of input){bytes+=b.length;proof(bytes<=16*1024*1024,'RECOVERY_TOC_BOUND');chunks.push(b);}return Buffer.concat(chunks).toString('utf8');});
  const spec=pipeline('restore');
  await restoreFromOfflinePipeline({client:context.client,Query:context.Query,binding:context.binding,identity:context.identity,transactionStatus:context.transactionStatus,maxCopyBytes:auth.maxCopyBytes,verifyOperation:async()=>{remaining();validateAuthority(auth,context.identityBinding,context.toolRevision);},verifyDecoderCompletion:async()=>{remaining();},verifyWithinTransaction:async client=>{
   catalogResult=await verifyCatalogOnExistingRestore(client,{sourceRaw,sourceBinding,sourceArtifactSha256:item.sourceCatalog.sha256,sourceCatalogSha256:item.sourceCatalogSha256,targetBinding,recoveryIdentity:auth.identity,databaseMapping:{source:db,target:db},requiredRoles:item.completeClusterRoleNames,transactionStatus:context.transactionStatus,verifyTransport:async()=>{const live=await context.identity();proof(canonical(live)===canonical(context.binding),'RECOVERY_TRANSPORT_CHANGED');return live;}});
   const request={schemaVersion:1,targetBindingVerified:true,targetRdsInstanceId:RDS,productionRecoveryIdentity:auth.identity,attemptId:auth.identity.attemptId,database:db,targetSecret:{database:db,host:p.production.hostname,user:context.binding.role},productionHostname:p.production.hostname,sslmode:context.binding.transport?.sslMode??'verify-full',targetPeerAddressSha256:peer.peerAddressSha256,targetPeerPort:peer.port,toc,backupReceiptSha256:item.backupReceiptSha256,ciphertextSha256:item.ciphertext.sha256};
   dataResult=await consume('data',input=>fidelity.mainExistingSession(Readable.from((async function*(){yield Buffer.from(JSON.stringify(request)+'\n');yield* input;})()),{client,Query:context.Query,binding:context.binding,identity:context.identity,transactionStatus:context.transactionStatus}));
   await verifyDiagnosticPrivileges(client,context.diagnosticRole);remaining();validateAuthority(auth,context.identityBinding,context.toolRevision);
  }},spec);children.delete(spec.name);
  return {database:db,targetRdsInstanceId:RDS,ciphertextSha256:item.ciphertext.sha256,backupReceiptSha256:item.backupReceiptSha256,catalogSha256:catalogResult.sourceCatalogSha256,dataFidelityVerified:dataResult.dataFidelityVerified,existingSession:true,precommitFidelityVerified:true,restoreCommitted:true,decoderJoined:true,ready:false};
 }finally{
  clearTimeout(timer);if(context.client.connectionParameters)context.client.connectionParameters.query_timeout=oldTimeout;
  for(const {child} of processes)if(child.exitCode===null&&child.signalCode===null){try{child.kill('SIGKILL');}catch{}}
  // Join also covers a second spawn throwing before the supervisor was constructed.
  let timeout;try{const joined=await Promise.race([Promise.all(processes.map(p=>p.closed)).then(()=>true),new Promise(resolve=>{timeout=setTimeout(()=>resolve(false),2000);})]);proof(joined,'RECOVERY_CHILD_CLEANUP_UNKNOWN');}finally{clearTimeout(timeout);try{for(const name of children)await cleanup(name);}finally{for(const fd of binaries)io.close(fd);}}
 }
}
module.exports={recoverExistingSession,validateAuthority,verifyDiagnosticPrivileges};
