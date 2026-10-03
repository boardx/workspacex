'use strict';
const {strict:assert}=require('node:assert');
const c=require('./cn_restore_catalog.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
const b=side=>({side,attemptId:'local-fixture',database:side==='source'?'workspacex':'restored_fixture',username:'migration_admin',instanceId:side==='source'?'pgm-source':'pgm-target',providerBindingSha256:'a'.repeat(64),backupReceiptSha256:'b'.repeat(64),peerSha256:c.hash('10.0.0.1'),port:5432});
function mock(binding,{age=false,identity=false,rollback=false,queryError=false}={}){const calls=[];return {calls,connection:{stream:{remoteAddress:'10.0.0.1',remotePort:5432}},query:async(sql,params)=>{calls.push({sql,params});if(sql.startsWith('BEGIN')||sql.startsWith('SET LOCAL'))return {rows:[]};if(sql==='ROLLBACK'){if(rollback)throw Error('simulated');return {rows:[]};}if(sql===c.identitySql)return {rows:[{database:identity?'wrong':binding.database,username:binding.username,readonly:'on',isolation:'repeatable read'}]};const key=Object.keys(c.QUERIES).find(k=>c.QUERIES[k]===sql);assert(key,'only fixed authoritative SQL');if(queryError&&key==='relations')throw Error('fixture-fail');const data={columns:[{schema:'public',relation:'t',ordinal:1,name:'org_id',type:'uuid',not_null:true,default_expression:null}],constraints:[{schema:'public',relation:'t',name:'t_pk',definition:'PRIMARY KEY (org_id)'}],indexes:[{schema:'public',relation:'t',name:'t_pk',definition:'CREATE UNIQUE INDEX t_pk ON public.t USING btree (org_id)'}],triggers:[],views:[],rules:[],inheritance:[],types:[],enumLabels:[],collations:[],database:[{encoding:'UTF8',datcollate:'C',datctype:'C',owner:'migration_admin',acl:[{grantee:'app_rw',grantor:'migration_admin',privilege:'CONNECT',grantable:false}]}],namespaces:[{name:'public',owner:'migration_admin',acl:[]}],relations:[{schema:'public',name:'t',kind:'r',owner:'migration_admin',rls:true,force_rls:true,acl:[]}],sequences:[],functions:[{schema:'public',name:'f',arguments:'',owner:'migration_admin',security_definer:false,proconfig:['search_path=public'],acl:[]}],policies:[{schema:'public',relation:'t',name:'tenant',roles:['app_rw'],using_expression:'org_id = current_org()'}],defaultAcl:[],extensions:age?[{name:'age',version:'1.5.0',schema:'ag_catalog',owner:'migration_admin'}]:[],agePresence:[{graphs:age,labels:age}],graphs:age?[{name:'g',namespace:'g'}]:[],labels:age?[{name:'N',graph:'g',label_id:'1',kind:'v',relation_schema:'g',relation_name:'N',metadata:{seq_name:'N_id_seq'}}]:[],memberships:[{role:'app_rw',member:'migration_admin',grantor:'migration_admin',admin_option:false,inherit_option:null,set_option:null}],roles:params?.[0].map(name=>({name,superuser:false,inherit:true,bypass_rls:name==='migration_admin',rolconfig:null}))};return {rows:clone(data[key])};}};}
async function pair(age=false){const sourceBinding=b('source'),targetBinding=b('target');const source=await c.capture(mock(sourceBinding,{age}),sourceBinding,['app_rw','migration_admin']);const target=await c.capture(mock(targetBinding,{age}),targetBinding,['app_rw','migration_admin']);const expected={source:sourceBinding,target:targetBinding,databaseMapping:{source:sourceBinding.database,target:targetBinding.database},sourceCatalogSha256:source.catalogSha256,targetCatalogSha256:target.catalogSha256};return {source,target,expected};}
(async()=>{let tests=0;const pass=()=>tests++;
for(const age of [false,true]){const p=await pair(age);const result=c.compare(p.source,p.target,p.expected);assert(result.catalogEquivalent);assert.equal(result.rowDataVerified,false);assert.equal(result.productionMutationAuthorized,false);assert(!('ready' in result));pass();}
const p=await pair(true);for(const key of ['database','namespaces','relations','columns','constraints','indexes','triggers','views','rules','inheritance','types','enumLabels','collations','sequences','functions','policies','defaultAcl','extensions','roles','memberships','graphs','labels']){const changed=clone(p.target);if(changed.facts[key].length)changed.facts[key][0].changed='drift';else changed.facts[key].push({changed:'drift'});changed.facts=c.canonical(changed.facts);changed.catalogSha256=c.hash(JSON.stringify(changed.facts));assert.throws(()=>c.compare(p.source,changed,{...p.expected,targetCatalogSha256:changed.catalogSha256}),/MISMATCH/);pass();}
for(const key of ['attemptId','backupReceiptSha256','instanceId']){const e=clone(p.expected);e.target[key]=key==='instanceId'?e.source.instanceId:'wrong';assert.throws(()=>c.compare(p.source,p.target,e),/PAIR_BINDING/);pass();}
assert.throws(()=>c.compare(p.source,p.target,{...p.expected,databaseMapping:{source:'wrong',target:'restored_fixture'}}),/MAPPING/);pass();
assert.throws(()=>c.compare(p.source,p.target,{...p.expected,sourceCatalogSha256:'0'.repeat(64)}),/HASH/);pass();
const tampered=clone(p.target);tampered.sqlSha256='0'.repeat(64);assert.throws(()=>c.compare(p.source,tampered,p.expected),/CAPTURE/);pass();
const wrong=b('target');wrong.peerSha256='0'.repeat(64);await assert.rejects(c.capture(mock(wrong),wrong,['app_rw']),/TRANSPORT/);pass();
for(const fault of ['identity','queryError','rollback']){const client=mock(b('target'),{[fault]:true});await assert.rejects(c.capture(client,b('target'),['app_rw','migration_admin']));assert(client.calls.some(x=>x.sql==='ROLLBACK'));pass();}
const client=mock(b('source'));await c.capture(client,b('source'),['app_rw','migration_admin']);assert.equal(client.calls[0].sql,'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(client.calls.at(-1).sql,'ROLLBACK');assert(!JSON.stringify(p.source).includes('search_path=public'));pass();
// Actual capture JSON wrapper has its own hash, different from canonical facts.
const raw=Buffer.from(JSON.stringify(p.source,null,2)+'\n');
const artifactHash=c.hash(raw);assert.notEqual(artifactHash,p.source.catalogSha256);
assert.deepEqual(c.verifyCaptureArtifact(raw,p.expected.source,artifactHash,p.source.catalogSha256).facts,p.source.facts);pass();
assert.throws(()=>c.verifyCaptureArtifact(raw,p.expected.source,p.source.catalogSha256,p.source.catalogSha256),/ARTIFACT_HASH/);pass();
assert.throws(()=>c.verifyCaptureArtifact(raw,p.expected.source,artifactHash,artifactHash),/CAPTURE_HASH/);pass();
assert.throws(()=>c.verifyCaptureArtifact(Buffer.concat([raw,Buffer.from(' ')]),p.expected.source,artifactHash,p.source.catalogSha256),/ARTIFACT_HASH/);pass();
const {verifyCatalogReadback}=require('./cn-production-recovery-readback.cjs');
// Production rollback restores to the same provider instance: isolate only source side.
const productionTarget=clone(p.target);productionTarget.binding.instanceId=p.source.binding.instanceId;
productionTarget.binding=c.binding(productionTarget.binding);productionTarget.bindingSha256=c.hash(JSON.stringify(productionTarget.binding));
const expectedProduction=productionTarget.binding;
const sourceProduction=clone(p.source);sourceProduction.binding.attemptId=expectedProduction.attemptId;sourceProduction.binding.database=expectedProduction.database;
sourceProduction.binding=c.binding(sourceProduction.binding);sourceProduction.bindingSha256=c.hash(JSON.stringify(sourceProduction.binding));
const productionRaw=Buffer.from(JSON.stringify(sourceProduction,null,2)+'\n');
const item={sourceCatalog:{sha256:c.hash(productionRaw)},sourceCatalogSha256:sourceProduction.catalogSha256};
assert.deepEqual(verifyCatalogReadback(productionRaw,item,productionTarget,expectedProduction),{artifactSha256:item.sourceCatalog.sha256,catalogSha256:item.sourceCatalogSha256});pass();
assert.throws(()=>verifyCatalogReadback(productionRaw,{...item,sourceCatalog:{sha256:item.sourceCatalogSha256}},productionTarget,expectedProduction),/ARTIFACT_HASH/);pass();
assert.throws(()=>verifyCatalogReadback(productionRaw,{...item,sourceCatalogSha256:item.sourceCatalog.sha256},productionTarget,expectedProduction),/CAPTURE_HASH/);pass();
// Prior capture attempts are preserved in their artifact rather than relabelled.
const priorSource=clone(sourceProduction);priorSource.binding.attemptId='prior-backup';priorSource.binding=c.binding(priorSource.binding);priorSource.bindingSha256=c.hash(JSON.stringify(priorSource.binding));
const priorRaw=Buffer.from(JSON.stringify(priorSource));
assert.doesNotThrow(()=>verifyCatalogReadback(priorRaw,{...item,sourceCatalog:{sha256:c.hash(priorRaw)}},productionTarget,expectedProduction));pass();
assert.throws(()=>verifyCatalogReadback(priorRaw,{...item,sourceCatalog:{sha256:c.hash(priorRaw)}},productionTarget,{...expectedProduction,database:'foreign'}),/SOURCE_CATALOG_BINDING/);pass();
const reversed=clone(p.target);for(const k of Object.keys(reversed.facts))reversed.facts[k].reverse();reversed.facts=c.canonical(reversed.facts);assert.equal(c.hash(JSON.stringify(reversed.facts)),p.target.catalogSha256);pass();
// Borrowed restore transaction must remain open: no nested BEGIN or ROLLBACK.
for(const fault of [null,'readonly','identity','state']){
 const expected=b('target'),borrowed=mock(expected,{age:true});Object.assign(borrowed.connection.stream,{encrypted:true,authorized:true});const original=borrowed.query;
 borrowed.query=async(sql,params)=>sql===c.identitySql?{rows:[{database:fault==='identity'?'foreign':expected.database,username:expected.username,readonly:fault==='readonly'?'on':'off',isolation:'repeatable read'}]}:original(sql,params);
 if(fault){await assert.rejects(c.captureExistingRestoreTransaction(borrowed,expected,['app_rw','migration_admin'],()=>fault==='state'?'I':'T'));}
 else{const result=await c.captureExistingRestoreTransaction(borrowed,expected,['app_rw','migration_admin'],()=> 'T');assert.equal(result.kind,'existing-restore-transaction-catalog');assert.equal(result.rollbackComplete,false);assert.deepEqual(result.facts,p.target.facts);const bytes=Buffer.from(JSON.stringify(result));assert.throws(()=>c.verifyCaptureArtifact(bytes,expected,c.hash(bytes),result.catalogSha256),/CAPTURE/);}
 assert(!borrowed.calls.some(x=>/^(BEGIN|ROLLBACK|COMMIT)/.test(x.sql)));pass();
}
// Restore's precommit catalog verifier borrows the same transaction, never opens a Client.
const {verifyCatalogOnExistingRestore}=require('./existing_session_restore.cjs');
for(const drift of [false,true]){
 const expected=b('target'),borrowed=mock(expected,{age:true});Object.assign(borrowed.connection.stream,{encrypted:true,authorized:true});const original=borrowed.query;
 borrowed.query=async(sql,params)=>{if(sql===c.identitySql)return {rows:[{database:expected.database,username:expected.username,readonly:'off',isolation:'repeatable read'}]};const result=await original(sql,params);if(drift&&sql===c.QUERIES.columns)result.rows[0].type='integer';return result;};
 const input={sourceRaw:Buffer.from(JSON.stringify(p.source)),sourceBinding:p.source.binding,sourceArtifactSha256:c.hash(Buffer.from(JSON.stringify(p.source))),sourceCatalogSha256:p.source.catalogSha256,targetBinding:expected,recoveryIdentity:{sourceRevision:'9b25bfa65662b96c0826fe67506b562ea46aa6d0',baselineRevision:'ba6343199f3c834d6a198f83d0c771614292c82b',attemptId:expected.attemptId},databaseMapping:{source:p.source.binding.database,target:expected.database},requiredRoles:['app_rw','migration_admin'],transactionStatus:()=> 'T'};
 if(drift)await assert.rejects(verifyCatalogOnExistingRestore(borrowed,input),/MISMATCH/);else{const result=await verifyCatalogOnExistingRestore(borrowed,input);assert.equal(result.catalogEquivalent,true);assert.equal(result.rowDataVerified,false);assert.equal(result.productionMutationAuthorized,false);}
 await assert.rejects(verifyCatalogOnExistingRestore(borrowed,{...input,recoveryIdentity:{...input.recoveryIdentity,attemptId:'foreign'}}),/RECOVERY_IDENTITY/);
 if(!drift){const prior=clone(p.source);prior.binding.attemptId='prior-capture';prior.binding=c.binding(prior.binding);prior.bindingSha256=c.hash(JSON.stringify(prior.binding));const priorRaw=Buffer.from(JSON.stringify(prior));assert.equal((await verifyCatalogOnExistingRestore(borrowed,{...input,sourceRaw:priorRaw,sourceBinding:prior.binding,sourceArtifactSha256:c.hash(priorRaw)})).catalogEquivalent,true);}
 assert(!borrowed.calls.some(x=>/^(BEGIN|ROLLBACK|COMMIT)/.test(x.sql)));pass();
}
// Plaintext is available only to a borrowed source-owned authority callback.
const stream={remoteAddress:'192.168.100.44',remotePort:5432,localAddress:'192.168.100.40',encrypted:false,authorized:false};
const borrowedClient={connection:{stream}},target={peerSha256:c.hash(stream.remoteAddress),port:5432,username:'migration_admin',database:'workspacex'};
const bound={role:target.username,peer:{database:target.database},tls:{ssl:false},transport:{sslMode:'disable',configurationSha256:'c'.repeat(64),providerEvidenceSha256:'d'.repeat(64)},socket:{...stream}};
await assert.rejects(c.verifyBorrowedTransport(borrowedClient,target),/AUTHORITY/);pass();
await assert.rejects(c.verifyBorrowedTransport(borrowedClient,target,async()=>true),/PROOF/);pass();
await c.verifyBorrowedTransport(borrowedClient,target,async()=>bound);pass();
await assert.rejects(c.verifyBorrowedTransport(borrowedClient,target,async()=>{throw Error('pinned profile changed');}),/profile changed/);pass();
stream.localAddress='192.168.100.41';await assert.rejects(c.verifyBorrowedTransport(borrowedClient,target,async()=>bound),/PROOF/);pass();
console.log(`catalog fixed-query mock + ${tests} positive/fault assertions PASS; real DB execution NOT RUN; no row-data/READY proof`);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
