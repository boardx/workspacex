'use strict';
// Inert execution primitive. No Client factory, credentials, decoder, or executable entrypoint.
// The host must supply a hash-verified offline decoder and independently verified authority.
// This is not yet reachable from the production recovery transport.
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
function proof(ok,code){if(!ok)throw Error(code);}
function boundedSql(sql){
 proof(typeof sql==='string'&&Buffer.byteLength(sql)>0&&Buffer.byteLength(sql)<=16*1024*1024&&!sql.includes('\0'),'RESTORE_SQL_BOUND');
 // A decoder must provide exactly one complete statement, validated by the host.
 // These checks additionally refuse operations that invalidate an existing-session lane.
 const prefix=sql.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/,'').toUpperCase();
 proof(!/^(?:BEGIN|START|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|PREPARE|DO|CALL|VACUUM|DISCARD|\\)\b/.test(prefix),'RESTORE_TRANSACTION_ESCAPE');
 proof(!/^(?:CREATE|DROP|ALTER)\s+(?:DATABASE|ROLE|USER|TABLESPACE|SYSTEM)\b/.test(prefix)&&!/^SET\s+(?:SESSION\s+AUTHORIZATION|ROLE)\b/.test(prefix),'RESTORE_CLUSTER_OPERATION');
 return sql;
}
async function copyOnExistingClient(client,Query,sql,chunks,budget){
 proof(typeof Query==='function'&&client.connection&&typeof client.connection.sendCopyFromChunk==='function'&&typeof client.connection.endCopyFrom==='function'&&typeof client.connection.sendCopyFail==='function','RESTORE_COPY_RUNTIME');
 let readyResolve,readyReject,doneResolve,doneReject,copyStarted=false,finishing=false,terminal=false;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const done=new Promise((resolve,reject)=>{doneResolve=resolve;doneReject=reject;});
 done.catch(()=>{});ready.catch(()=>{});
 const interrupted=done.then(()=>{throw Error('RESTORE_COPY_ALREADY_COMPLETED');},error=>{throw error;});interrupted.catch(()=>{});
 const query=new Query({text:sql},(error,result)=>{
  terminal=true;
  if(error){readyReject(error);doneReject(error);}
  else if(!copyStarted||!finishing){const failure=Error('RESTORE_COPY_EARLY_DONE');readyReject(failure);doneReject(failure);}
  else doneResolve(result);
 });
 query.handleCopyInResponse=connection=>{if(connection!==client.connection){const e=Error('RESTORE_COPY_CONNECTION_CHANGED');readyReject(e);connection.sendCopyFail('restore binding rejected');return;}copyStarted=true;readyResolve();};
 const iterator=chunks[Symbol.asyncIterator]();
 client.query(query);
 try{
  await ready;
  while(true){
   proof(!terminal,'RESTORE_COPY_EARLY_DONE');
   const item=await Promise.race([iterator.next(),interrupted]);
   proof(!terminal,'RESTORE_COPY_EARLY_DONE');if(item.done)break;
   const chunk=item.value;
   proof(Buffer.isBuffer(chunk)&&chunk.length>0&&chunk.length<=65536,'RESTORE_COPY_CHUNK_BOUND');
   budget.bytes+=chunk.length;proof(budget.bytes<=budget.limit,'RESTORE_COPY_TOTAL_BOUND');budget.hash.update(chunk);
   client.connection.sendCopyFromChunk(chunk);
   proof(!terminal,'RESTORE_COPY_EARLY_DONE');
   // pg 8.22 sendCopyFromChunk does not return stream.write's boolean.
   if(client.connection.stream?.writableNeedDrain)await Promise.race([once(client.connection.stream,'drain'),interrupted]);
  }
  finishing=true;client.connection.endCopyFrom();await done;
 }catch(error){
  if(copyStarted&&!terminal){try{client.connection.sendCopyFail('restore source rejected');await done;}catch{}}
  // Do not await iterator.return(): a pending source read can be blocked indefinitely.
  // The host owns terminating and joining the decoder process on every rejection.
  throw error;
 }
}
async function restoreExistingSession({client,Query,identity,binding,transactionStatus,operations,verifyOperation,verifyDecoderCompletion,verifyWithinTransaction,maxCopyBytes,abortDecoder}){
 proof(client&&typeof client.query==='function'&&typeof identity==='function'&&typeof transactionStatus==='function'&&typeof verifyOperation==='function'&&typeof verifyDecoderCompletion==='function'&&typeof verifyWithinTransaction==='function','RESTORE_HOST_CONTRACT');
 proof(Number.isSafeInteger(maxCopyBytes)&&maxCopyBytes>0&&maxCopyBytes<=8*1024*1024*1024,'RESTORE_TOTAL_BOUND');
 proof(transactionStatus()==='I'&&canonical(await identity())===canonical(binding),'RESTORE_EXISTING_SESSION_REQUIRED');
 const budget={bytes:0,limit:maxCopyBytes,hash:createHash('sha256')};const hash=createHash('sha256');let statements=0,committed=false,commitAttempted=false;
 try{
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ');proof(transactionStatus()==='T','RESTORE_TRANSACTION_REQUIRED');
  for await(const operation of operations){
   proof(operation&&['sql','copy'].includes(operation.kind)&&Object.keys(operation).every(k=>['kind','sql','chunks'].includes(k)),'RESTORE_OPERATION_SCHEMA');
   const sql=boundedSql(operation.sql);await verifyOperation(operation);
   proof(++statements<=1000000,'RESTORE_STATEMENT_BOUND');hash.update(JSON.stringify({kind:operation.kind,sql})+'\n');
   if(operation.kind==='copy'){
    proof(/^COPY\s[\s\S]+\sFROM\s+stdin;\s*$/i.test(sql)&&operation.chunks?.[Symbol.asyncIterator],'RESTORE_COPY_COMMAND');
    await copyOnExistingClient(client,Query,sql,operation.chunks,budget);
   }else{proof(!/^\s*COPY\b/i.test(sql)&&!Object.hasOwn(operation,'chunks'),'RESTORE_SQL_OPERATION');await client.query(sql);}
   proof(transactionStatus()==='T','RESTORE_TRANSACTION_CHANGED');
  }
  // Completion must attest decrypt + decoder success and full EOF, not just TOC exit.
  await verifyDecoderCompletion({statements,copyBytes:budget.bytes,statementSha256:hash.digest('hex'),copySha256:budget.hash.digest('hex')});
  proof(canonical(await identity())===canonical(binding)&&transactionStatus()==='T','RESTORE_CONNECTION_CHANGED');
  // Host checks catalog/data/sequence conservation and diagnostic effective write privileges
  // before commit. It must not open a replacement connection or enable LOGIN.
  await verifyWithinTransaction(client);
  proof(canonical(await identity())===canonical(binding)&&transactionStatus()==='T','RESTORE_PRECOMMIT_BINDING');
  commitAttempted=true;await client.query('COMMIT');committed=true;
  proof(transactionStatus()==='I'&&canonical(await identity())===canonical(binding),'RESTORE_POSTCOMMIT_BINDING');
  return {statements,copyBytes:budget.bytes,existingSession:true};
 }catch(error){
  // The host must cancel blocked plaintext reads and join both offline processes
  // before rollback. Unknown cleanup cannot release the writer fence.
  let decoderCleanupConfirmed=abortDecoder===undefined;
  if(abortDecoder){try{await abortDecoder();decoderCleanupConfirmed=true;}catch{}}
  let rollbackConfirmed=false;
  if(!committed){try{await client.query('ROLLBACK');rollbackConfirmed=transactionStatus()==='I'&&canonical(await identity())===canonical(binding);}catch{}}
  // Never embed SQL, COPY bytes, provider errors, or credentials in this evidence.
  const failure=Error('RESTORE_EXISTING_SESSION_FAILED');failure.recovery={committed,commitAttempted,commitOutcomeUnknown:commitAttempted&&!committed,rollbackConfirmed,decoderCleanupConfirmed,holdMustRemain:true};throw failure;
 }
}
async function verifyCatalogOnExistingRestore(client,{sourceRaw,sourceBinding,sourceArtifactSha256,sourceCatalogSha256,targetBinding,recoveryIdentity,databaseMapping,requiredRoles,transactionStatus}){
 proof(recoveryIdentity?.sourceRevision==='9b25bfa65662b96c0826fe67506b562ea46aa6d0'&&recoveryIdentity?.baselineRevision==='ba6343199f3c834d6a198f83d0c771614292c82b'&&recoveryIdentity?.attemptId===targetBinding.attemptId,'RESTORE_CATALOG_RECOVERY_IDENTITY');
 const catalog=require('./cn-production-recovery-catalog.cjs');
 const source=catalog.verifyCaptureArtifact(sourceRaw,sourceBinding,sourceArtifactSha256,sourceCatalogSha256);
 proof(databaseMapping?.source===sourceBinding.database&&databaseMapping?.target===targetBinding.database&&sourceBinding.side==='source'&&targetBinding.side==='target'&&sourceBinding.backupReceiptSha256===targetBinding.backupReceiptSha256,'RESTORE_CATALOG_PAIR_BINDING');
 const target=await catalog.captureExistingRestoreTransaction(client,targetBinding,requiredRoles,transactionStatus);
 proof(canonical(source.facts)===canonical(target.facts),'RESTORE_CATALOG_MISMATCH');
 return {scope:'existing-restore-transaction-catalog-only',sourceCatalogSha256,targetCatalogSha256:target.catalogSha256,catalogEquivalent:true,rowDataVerified:false,transactionStillOpen:true,productionMutationAuthorized:false};
}
module.exports={restoreExistingSession,copyOnExistingClient,boundedSql,verifyCatalogOnExistingRestore};
