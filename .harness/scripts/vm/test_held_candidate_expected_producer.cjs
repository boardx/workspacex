'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture}=require('./test_held_candidate_expected.cjs');
const {collectQualifiedExpected}=require('./held_candidate_expected_producer.cjs');
const {createQualifiedExpectedVerifier}=require('./held_candidate_expected.cjs');
const {CATALOG_SQL,EXTENSION_SQL,AGENT_SEED_SQL,sourceRoleSelect,readHeldCandidate}=require('./held_candidate_queries.cjs');
function borrowed(variant){
 const f=fixture(),b=JSON.parse(f.raw.get(f.entry.aggregate.path)).binding;b.targetInstanceId='pgm-isolated';
 // Bind the immutable qualifier input and DB artifacts to this isolated identity.
 const q=JSON.parse(f.raw.get(f.entry.qualification.path));for(const [db,r] of Object.entries(q.databases)){const d=JSON.parse(f.raw.get(r.path));d.binding=b;q.databases[db]=f.put(d);}
 const qualification=f.put(q,f.entry.qualification.path),policy=JSON.parse(f.raw.get(f.entry.sourcePolicy.path));policy.binding=b;const sourcePolicy=f.put(policy);
 for(const [db,r] of Object.entries(q.databases)){const d=JSON.parse(f.raw.get(r.path));d.sourcePolicy=sourcePolicy;q.databases[db]=f.put(d);}const qualified=f.put(q,qualification.path);
 const qualificationInput=f.put({schemaVersion:2,kind:'current-held-epoch-qualification',binding:b,sourcePolicy},f.entry.qualificationInput.path);
 const connections={},providerRefs={},calls=[];
 const facts=db=>f.aggregate.targets[db].map(r=>({...r,facts:JSON.parse(f.raw.get(r.factsRef.path))}));
 for(const db of Object.keys(f.aggregate.targets)){const binding={peer:{database:db,remoteAddress:'10.0.0.2',remotePort:5432,user:'diag'},pid:1};const c={binding,identityBinding:b.identity,toolRevision:b.toolRevision,mode:'diagnostic',transactionStatus:'I',identity:async()=>structuredClone(binding)};
  c.client={query:async(sql,params)=>{calls.push([db,sql]);if(sql==='BEGIN TRANSACTION READ ONLY'){c.transactionStatus='T';if(variant==='begin')throw Error('lost begin');return {rows:[]};}if(sql==='ROLLBACK'){if(variant==='rollback')throw Error('lost rollback');c.transactionStatus='I';return {rows:[]};}if(sql==='SHOW transaction_read_only')return {rows:[{transaction_read_only:variant==='readonly'?'off':'on'}]};if(sql==="SET LOCAL statement_timeout = '5000ms'")return {rows:[]};
   const rows=facts(db);if(sql===CATALOG_SQL)return {rows:rows.find(r=>r.targetId.endsWith('-schema')).facts};
   if(sql===EXTENSION_SQL)return {rows:[{extname:'plpgsql',extversion:'1.0'}]};
   if(sql===AGENT_SEED_SQL){const a=rows.find(r=>r.targetId==='api-system-agent'&&r.keyValues.stableName===params[1]).facts[0];a.published_version_id='version';if(variant==='provider')a.model_provider='foreign';return {rows:[a]};}
   if(sql===sourceRoleSelect())return {rows:[{projection:{roles:[{name:'runtime'}],diagnosticPrivileges:{tableWrite:false}}}]};throw Error('unexpected query');}};
  connections[db]=c;providerRefs[db]=f.put({binding:b,observedAt:Date.now()/1000,attribute:{Items:{DBInstanceAttribute:[{DBInstanceId:variant==='production'?'pgm-uf6rg214cp381l49':b.targetInstanceId,VpcId:'vpc'}]}},network:{DBInstanceNetInfos:{DBInstanceNetInfo:[{IPType:'Private',VPCId:'vpc',IPAddress:variant==='socket'?'10.0.0.3':'10.0.0.2',Port:5432}]}}});
 }
 const source=f.put(fs.readFileSync('.harness/scripts/vm/held_candidate_expected_producer.cjs')),executable=f.put(fs.readFileSync(process.execPath));
 const namespaces=Object.fromEntries(['pid','mnt','net'].map(k=>[k,fs.readlinkSync('/proc/self/ns/'+k).match(/\[([0-9]+)\]/)[1]]));
 const io={binding:b,qualification:qualified,migrationCompletion:f.entry.migrationCompletion,appSourceManifest:f.entry.appSourceManifest,connections,roles:Object.fromEntries(Object.keys(connections).map(db=>[db,'runtime'])),orgId:'org',providerRefs,producer:{sourcePath:'.harness/scripts/vm/held_candidate_expected_producer.cjs',source,executable,namespaces},readProtected:r=>f.raw.get(r.path),writeProtected:(path,raw)=>f.put(raw,path)};
 return {f,io,calls,qualificationInput,sourcePolicy};
}
test('actual source collector uses only borrowed isolated sessions, rolls back and emits hash-bound expected',async()=>{
 const {f,io,calls,qualificationInput,sourcePolicy}=borrowed();const result=await collectQualifiedExpected(io);
 assert.equal(result.ready,false);assert.equal(calls.filter(r=>r[1]==='ROLLBACK').length,3);
 const aggregatePolicy=f.put({schemaVersion:1,kind:'source-approved-held-readback-policy',binding:io.binding,producer:result.producer,invocation:result.invocation,isolatedStageReceipts:result.isolatedStageReceipts});
 const entry={...f.entry,expected:result.expected,aggregate:result.aggregate,qualification:io.qualification,qualificationInput,sourcePolicy,aggregatePolicy};
 const profile={...f.profile,heldCandidateExpected:entry,filesSha256:{...f.profile.filesSha256,[io.producer.sourcePath]:io.producer.source.sha256}};
 const verify=createQualifiedExpectedVerifier({profile,readProtected:io.readProtected});const expected=JSON.parse(io.readProtected(result.expected));assert.equal(verify(result.expected,expected),true);
 const sourceBinding=Object.fromEntries(['identity','toolRevision','host','epoch','holdGeneration'].map(k=>[k,io.binding[k]]));
 for(const [db,control] of Object.entries(io.connections))for(const probe of ['held-candidate-schema','held-candidate-permissions','held-candidate-seed']){const out=await readHeldCandidate(control,probe,{expectedReadbackSha256:result.expected.sha256},{identity:io.binding.identity,connection:control.binding,binding:sourceBinding,expectedReadbackRef:result.expected,readPrivate:io.readProtected,verifyQualifiedExpected:verify});assert.equal(out.verified,true);}
 assert.equal(calls.filter(r=>r[1]===AGENT_SEED_SQL).length,6); // Actual producer three + actual consumer three.
 assert.equal(expected.targets.workspacex.filter(r=>r.targetId==='api-system-agent').length,3);
});
test('production target/socket mismatch rejects before BEGIN; bad read-only, seed, lost BEGIN/ROLLBACK reject',async()=>{
 for(const variant of ['production','socket','readonly','provider','begin','rollback']){const {io,calls}=borrowed(variant);await assert.rejects(collectQualifiedExpected(io));if(['production','socket'].includes(variant))assert.equal(calls.length,0);else assert.ok(calls.some(r=>r[1]==='ROLLBACK'));}
});
