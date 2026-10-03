'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events');const {Readable}=require('node:stream');
function load(){
 const files=new Map(),descriptors=new Map();let fd=0,cleanupFailure=false;const io={constants:fs.constants,lstatSync:()=>({isDirectory:()=>true,isSymbolicLink:()=>false,uid:0,gid:0,mode:0o700}),mkdirSync(){},rmdirSync(){},rmSync(){files.clear();if(cleanupFailure){cleanupFailure=false;throw Error('fixture cleanup failed');}},openSync(path,flags){if(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR))files.set(path,Buffer.alloc(0));const handle=++fd;descriptors.set(handle,{path,offset:0});return handle;},writeSync(handle,bytes){const entry=descriptors.get(handle);files.set(entry.path,Buffer.concat([files.get(entry.path),bytes]));return bytes.length;},readSync(handle,out,start,length){const entry=descriptors.get(handle),part=files.get(entry.path).subarray(entry.offset,entry.offset+length);part.copy(out,start);entry.offset+=part.length;return part.length;},closeSync(handle){descriptors.delete(handle);},unlinkSync(path){files.delete(path);}};
 const mod={exports:{}};let pgImports=0;
 vm.runInNewContext(fs.readFileSync(__dirname+'/cn-production-recovery-fidelity.cjs','utf8'),{module:mod,exports:mod.exports,require(name){if(name==='pg'){pgImports++;throw Error('new PG runtime forbidden');}return name==='node:fs'?io:require(name);},Buffer,TextDecoder,process:{getuid:()=>0,env:{}}});
 return {api:mod.exports,files,descriptors,pgImports:()=>pgImports,failCleanupOnce:()=>{cleanupFailure=true;}};
}
class Query extends EventEmitter{constructor(text){super();this.text=text;}}
function fixture(fault){const state=load(),calls=[];const binding={role:'migration_admin',pid:123,backendStart:'fixed'};
 const client={connection:{stream:{remoteAddress:'10.0.0.1',remotePort:5432,encrypted:true,authorized:true}},async connect(){throw Error('connect forbidden');},async end(){throw Error('end forbidden');},query(query){
  if(query instanceof Query){queueMicrotask(()=>{query.emit('row',{canonical:fault==='data'?'(wrong,1)':'(fixture,1)'});query.emit('end');});return query;}
  calls.push(query);if(query.startsWith('SELECT current_database()'))return Promise.resolve({rows:[{database:'workspacex',username:fault==='role'?'foreign':'migration_admin',readonly:'off',isolation:'repeatable read',superuser:false,bypass_rls:true}]});
  if(query.startsWith('SET LOCAL'))return Promise.resolve({rows:[]});
  if(query.startsWith('SELECT a.attname'))return Promise.resolve({rows:[{attname:'name',type:'text'},{attname:'n',type:'integer'}]});
  if(query.startsWith('SELECT ROW('))return Promise.resolve({rows:[{canonical:'(fixture,1)'}]});throw Error('unexpected SQL');
 }};
 const request={schemaVersion:1,targetBindingVerified:true,targetRdsInstanceId:'pgm-uf6rg214cp381l49',productionRecoveryIdentity:{attemptId:'test'},attemptId:'test',database:'workspacex',targetSecret:{database:'workspacex',host:'rds',user:'migration_admin'},productionHostname:'rds',sslmode:'verify-full',targetPeerAddressSha256:crypto.createHash('sha256').update('10.0.0.1').digest('hex'),targetPeerPort:5432,toc:'1; 0 0 TABLE DATA public t migration_admin',backupReceiptSha256:'a'.repeat(64),ciphertextSha256:'b'.repeat(64)};
 const input=Readable.from([Buffer.from(JSON.stringify(request)+'\nCOPY public.t (name, n) FROM stdin;\nfixture\t1\n'+(fault==='truncated'?'':'\\.\n'))]);
 const existing={client,Query,binding,identity:async()=>({...binding,pid:fault==='identity'?999:123}),transactionStatus:()=>fault==='state'?'I':'T'};
 return {...state,calls,input,existing};
}
(async()=>{let assertions=0;
 for(const fault of [null,'data','role','identity','state','truncated']){const f=fixture(fault);if(fault)await assert.rejects(f.api.mainExistingSession(f.input,f.existing));else{const result=await f.api.mainExistingSession(f.input,f.existing);assert.equal(result.tables[0].rows,1);assert.equal(result.dataFidelityVerified,true);assert.equal(result.readOnly,false);assert.equal(result.rollbackComplete,false);assert.equal(result.transactionStillOpen,true);}assert.equal(f.pgImports(),0);assert(!f.calls.some(q=>/^(BEGIN|COMMIT|ROLLBACK)/.test(q)));assert.equal(f.files.size,0);assert.equal(f.descriptors.size,0);assertions++;}
 const cleanup=fixture('data');cleanup.failCleanupOnce();await assert.rejects(cleanup.api.mainExistingSession(cleanup.input,cleanup.existing),/cleanup failed/);const retry=fixture();const repaired=await cleanup.api.mainExistingSession(retry.input,retry.existing);assert.equal(repaired.dataFidelityVerified,true);assert.equal(cleanup.pgImports(),0);assert(!cleanup.calls.some(q=>/^(BEGIN|COMMIT|ROLLBACK)/.test(q)));assertions++;
 console.log(`${assertions} borrowed-client data fidelity assertions PASS; synthetic client/fs only; real PG NOT RUN`);
})().catch(e=>{console.error(e);process.exitCode=1;});
