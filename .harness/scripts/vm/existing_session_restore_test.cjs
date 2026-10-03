'use strict';
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {restoreExistingSession,boundedSql}=require('./existing_session_restore.cjs');
const {decodeSql}=require('./restore_sql_stream.cjs');
class Query{constructor(config,callback){this.text=config.text;this.callback=callback;}}
const binding={database:'workspacex',pid:41,backendStart:'fixed',tls:true};
function fixture(fault){let status='I',copies=[],queries=[],copyQuery,identityCalls=0;const stream=new EventEmitter();stream.writableNeedDrain=false;
 const client={connection:{stream,sendCopyFromChunk:b=>copies.push(Buffer.from(b)),endCopyFrom:()=>copyQuery.callback(null,{rows:[]}),sendCopyFail:()=>copyQuery.callback(Error('source failed'))},query:async q=>{if(q instanceof Query){copyQuery=q;queueMicrotask(()=>{if(fault==='copy-server')q.callback(Error('server failed'));else q.handleCopyInResponse(client.connection);});return;}queries.push(q);if(q==='BEGIN')status='T';if(q==='COMMIT'||q==='ROLLBACK')status='I';if(fault==='commit-ack'&&q==='COMMIT')throw Error('commit acknowledgement lost');if(fault==='rollback'&&q==='ROLLBACK')throw Error('lost connection');if(fault==='sql'&&q.startsWith('CREATE'))throw Error('sql failure');return {rows:[]};}};
 async function* chunks(){yield Buffer.from('one\t1\n');if(fault==='partial-copy')throw Error('decrypt truncated');yield Buffer.from('two\t2\n');}
 async function* operations(){yield {kind:'sql',sql:'CREATE TABLE public.t (name text, n int);'};yield {kind:'copy',sql:'COPY public.t (name, n) FROM stdin;',chunks:chunks()};if(fault==='escape')yield {kind:'sql',sql:'COMMIT;'};}
 return {client,queries,copies,options:{client,Query,binding,identity:async()=>{identityCalls++;return fault==='identity'&&identityCalls>1?{...binding,pid:99}:binding;},transactionStatus:()=>status,operations:operations(),verifyOperation:async()=>{},verifyDecoderCompletion:async()=>{if(['eof','rollback'].includes(fault))throw Error('decoder nonzero');},verifyWithinTransaction:async c=>{assert.equal(c,client);assert.equal(status,'T');if(fault==='privilege')throw Error('diagnostic gained write');},maxCopyBytes:1048576}};
}
(async()=>{let count=0;
 const ok=fixture();assert.deepEqual(await restoreExistingSession(ok.options),{statements:2,copyBytes:12,existingSession:true});assert.equal(ok.queries.filter(q=>q==='COMMIT').length,1);assert.equal(Buffer.concat(ok.copies).toString(),'one\t1\ntwo\t2\n');count++;
 for(const fault of ['partial-copy','copy-server','sql','eof','privilege','identity','escape','rollback']){const f=fixture(fault);await assert.rejects(restoreExistingSession(f.options),e=>{assert.equal(e.message,'RESTORE_EXISTING_SESSION_FAILED');assert.equal(e.recovery.holdMustRemain,true);assert.equal(e.recovery.committed,false);assert.equal(e.recovery.rollbackConfirmed,!['identity','rollback'].includes(fault));return true;});assert(!f.queries.includes('COMMIT'));count++;}
 for(const sql of ['DROP DATABASE workspacex;','CREATE DATABASE workspacex;','ALTER ROLE app LOGIN;','SET ROLE app;','BEGIN;','COMMIT;','DO $$ BEGIN NULL; END $$;']){assert.throws(()=>boundedSql(sql),/RESTORE_/);count++;}
 const oversized=fixture();oversized.options.maxCopyBytes=1;await assert.rejects(restoreExistingSession(oversized.options),e=>e.recovery.holdMustRemain);assert(!oversized.queries.includes('COMMIT'));count++;
 const initial=fixture();initial.options.identity=async()=>({...binding,pid:42});await assert.rejects(restoreExistingSession(initial.options),/EXISTING_SESSION_REQUIRED/);assert.equal(initial.queries.length,0);count++;
 const commit=fixture('commit-ack');await assert.rejects(restoreExistingSession(commit.options),e=>e.recovery.commitOutcomeUnknown===true&&e.recovery.holdMustRemain===true);count++;
 for(const truncated of [false,true]){const streamed=fixture();async function* raw(){yield Buffer.from('CREATE TABLE public.t (name text,n int);\nCOPY public.t (name,n) FROM stdin;\none\t1\n'+(truncated?'':'\\.\n'));}streamed.options.operations=decodeSql(raw());if(truncated){await assert.rejects(restoreExistingSession(streamed.options),e=>e.recovery.holdMustRemain&&!e.recovery.committed);assert(!streamed.queries.includes('COMMIT'));}else{const result=await restoreExistingSession(streamed.options);assert.equal(result.copyBytes,6);assert.equal(result.statements,2);}count++;}
 for(const timing of ['before-data','after-first','error-stalled-source']){
  const f=fixture();let active,ends=0;const originalQuery=f.client.query,originalSend=f.client.connection.sendCopyFromChunk,originalEnd=f.client.connection.endCopyFrom;
  f.client.query=q=>{if(q instanceof Query){active=q;if(timing==='before-data'){const originalResponse=q.handleCopyInResponse;q.handleCopyInResponse=c=>{originalResponse(c);q.callback(null,{rows:[]});};}}return originalQuery(q);};
  f.client.connection.sendCopyFromChunk=chunk=>{originalSend(chunk);queueMicrotask(()=>active.callback(timing==='error-stalled-source'?Error('server stopped'):null,{rows:[]}));};
  f.client.connection.endCopyFrom=()=>{ends++;originalEnd();};
  if(timing==='error-stalled-source'){async function* stalled(){yield Buffer.from('one\t1\n');await new Promise(()=>{});}async function* ops(){yield {kind:'copy',sql:'COPY public.t FROM stdin;',chunks:stalled()};}f.options.operations=ops();}
  await assert.rejects(restoreExistingSession(f.options),e=>e.recovery.holdMustRemain&&!e.recovery.committed);assert.equal(ends,0);assert.equal(f.copies.length,timing==='before-data'?0:1);assert(!f.queries.includes('COMMIT'));count++;
 }
 console.log(`${count} existing-session restore assertions PASS; mock only; production adapter/decoder authorization/real PG NOT RUN`);
})().catch(e=>{console.error(e);process.exitCode=1;});
