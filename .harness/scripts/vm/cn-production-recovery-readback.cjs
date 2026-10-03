'use strict';
// Root-private caller validates authorization/FD9/hold; this runner independently
// reads the restored live database and original archive. Never prints rows/secrets.
const fs=require('node:fs'),{spawn,spawnSync}=require('node:child_process');
const {Client}=require('pg'),{Readable}=require('node:stream');
const catalog=require('./cn-production-recovery-catalog.cjs');
const fidelity=require('./cn-production-recovery-fidelity.cjs');
const requireFact=(x,c)=>{if(!x)throw Error(c)};
async function run(input){
 let archiveBytes=0;let header=Buffer.alloc(0),archive=fs.openSync('/run/wsx/backup.dump','wx',0o600),request;
 try {
  for await(const b of input){
   if(!request){header=Buffer.concat([header,b]);requireFact(header.length<1024*1024,'METADATA_BOUND');const i=header.indexOf(10);if(i<0)continue;request=JSON.parse(header.subarray(0,i));archiveBytes+=header.length-i-1;requireFact(archiveBytes<=request.plan.databases[request.database].dumpBytes,'ARCHIVE_BOUND');fs.writeSync(archive,header.subarray(i+1));header=undefined;}
   else {archiveBytes+=b.length;requireFact(archiveBytes<=request.plan.databases[request.database].dumpBytes,'ARCHIVE_BOUND');fs.writeSync(archive,b);}
  }
  fs.closeSync(archive);archive=undefined;
  const p=request.plan,db=request.database,item=p.databases[db];requireFact(archiveBytes===item.dumpBytes,'ARCHIVE_TRUNCATED');const secret={...request.credential,database:db};
  requireFact(p.production.instanceId==='pgm-uf6rg214cp381l49'&&Object.keys(p.databases).sort().join(',')==='workspacex,workspacex_agent,workspacex_memory','PRODUCTION_SCOPE');
  requireFact(secret.host===p.production.hostname&&secret.sslmode==='verify-full','SECRET_BINDING');
  const peer=p.production.transportPeers[db];
  const expected={side:'target',attemptId:p.identity.attemptId,database:db,username:secret.user,instanceId:p.production.instanceId,providerBindingSha256:p.production.providerBindingSha256,backupReceiptSha256:item.backupReceiptSha256,peerSha256:peer.peerAddressSha256,port:peer.port};
  const client=new Client({...secret,ssl:{rejectUnauthorized:true,ca:fs.readFileSync('/run/wsx/ca.pem','utf8')},connectionTimeoutMillis:5000,statement_timeout:300000});
  let captured,version;
  try {await client.connect();requireFact(client.connection.stream.authorized===true,'TLS_REQUIRED');const identity=(await client.query("SELECT current_setting('server_version_num') AS version, current_database() AS database,inet_server_addr()::text AS \"serverAddr\",inet_server_port() AS \"serverPort\",(SELECT system_identifier::text FROM pg_control_system()) AS \"systemIdentifier\"")).rows[0];version=Number(identity.version);const sqlPeer={database:identity.database,serverAddr:identity.serverAddr,serverPort:identity.serverPort,systemIdentifier:identity.systemIdentifier};requireFact(JSON.stringify(sqlPeer)===JSON.stringify(p.production.databasePeers[db]),'SQL_PROVIDER_PEER');requireFact(version===item.serverVersionNum,'SERVER_VERSION');const roles=(await client.query('SELECT rolname FROM pg_roles ORDER BY rolname')).rows.map(x=>x.rolname);requireFact(JSON.stringify(roles)===JSON.stringify([...item.completeClusterRoleNames].sort()),'COMPLETE_ROLE_CLOSURE');captured=await catalog.capture(client,expected,roles);}finally{await client.end();}
  const source=JSON.parse(fs.readFileSync('/opt/wsx/source-catalog.json','utf8'));
  requireFact(source.catalogSha256===item.sourceCatalogSha256&&captured.catalogSha256===item.sourceCatalogSha256&&JSON.stringify(catalog.canonical(source.facts))===JSON.stringify(captured.facts),'FULL_CATALOG_MISMATCH');
  const toc=spawnSync('pg_restore',['--list','/run/wsx/backup.dump'],{encoding:'utf8',stdio:['ignore','pipe','ignore'],maxBuffer:16*1024*1024});requireFact(toc.status===0,'TOC_READ');
  const req={schemaVersion:1,targetBindingVerified:true,targetRdsInstanceId:p.production.instanceId,productionRecoveryIdentity:p.identity,attemptId:p.identity.attemptId,database:db,targetSecret:secret,productionHostname:p.production.hostname,sslmode:'verify-full',caPem:fs.readFileSync('/run/wsx/ca.pem','utf8'),targetPeerAddressSha256:peer.peerAddressSha256,targetPeerPort:peer.port,toc:toc.stdout,backupReceiptSha256:item.backupReceiptSha256,ciphertextSha256:item.ciphertext.sha256};
  const dump=spawn('pg_restore',['--data-only','--file=-','/run/wsx/backup.dump'],{stdio:['ignore','pipe','ignore']});
  const done=new Promise((resolve,reject)=>{dump.once('error',reject);dump.once('exit',c=>c===0?resolve():reject(Error('ARCHIVE_READ_FAILED')))});
  async function* joined(){yield Buffer.from(JSON.stringify(req)+'\n');yield* dump.stdout;}
  let result;try{result=await fidelity.main(Readable.from(joined()));await done;}finally{if(dump.exitCode===null)dump.kill('SIGKILL');}
  return {...result,catalogSha256:captured.catalogSha256,catalog:captured,serverVersionNum:version};
 } finally {if(archive!==undefined)fs.closeSync(archive);try{fs.unlinkSync('/run/wsx/backup.dump')}catch{}}
}
if(require.main===module)run(process.stdin).then(r=>process.stdout.write(JSON.stringify(r)+'\n')).catch(()=>{process.stderr.write('RECOVERY_READBACK_FAILED\n');process.exitCode=1});
module.exports={run};
