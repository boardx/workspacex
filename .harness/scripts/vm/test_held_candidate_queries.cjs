'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {readHeldCandidate,digest,CATALOG_SQL,EXTENSION_SQL,AGENT_SEED_SQL,targets}=require('./held_candidate_queries.cjs');
const DBS=['workspacex','workspacex_agent','workspacex_memory'];const PROBES=['held-candidate-schema','held-candidate-permissions','held-candidate-seed'];
function fixture(db='workspacex'){
 const identity={sourceRevision:'9b25bfa65662b96c0826fe67506b562ea46aa6d0',baselineRevision:'ba6343199f3c834d6a198f83d0c771614292c82b',attemptId:'one',migrationPlanSha256:'a'.repeat(64)};
 const connection={peer:{database:db},role:'diagnostic',pid:100,backendStart:'2026-10-04T00:00:00Z'};
 const catalog=tables=>tables.map(table=>({kind:'relation',fact:{table,rls:false,forced:false}})),extensions=[{extname:'plpgsql',extversion:'1.0'}];
 const role={name:'runtime',login:false,superuser:false};const privileges={tableWrite:false};
 const seed={id:'agent-one',org_id:'org-one',stable_name:'source-default',published_version_id:'version-one',agent_id:'agent-one',version_org:'org-one',model_provider:'source-provider',published_at:'2026-10-04T00:00:00Z',listing_id:'agent-one',listing_org:'org-one',listing_kind:'agent'};
 const expected={identity,toolRevision:'b'.repeat(40),host:{instanceId:'host',bootId:'boot'},epoch:'c'.repeat(64),holdGeneration:'d'.repeat(32),
  kind:'source-derived-held-candidate-readback',qualificationEvidenceSha256:'e'.repeat(64),targets:Object.fromEntries(DBS.map(db=>[db,[]]))};
 for(const [targetId,spec] of Object.entries(targets)){
  let facts,keys;
  if(spec.kind==='role-permission-projection'){keys={role:'runtime'};facts=[{kind:spec.kind,role,diagnosticPrivileges:privileges}];}
  else if(spec.kind==='system-agent-seed'){keys={orgId:'org-one',stableName:'source-default',provider:'source-provider'};facts=[seed];}
  else{keys={scope:spec.schema};facts=spec.kind==='initialization-schema-projection'?[{kind:spec.kind,catalog:catalog(spec.tables),extensions}]:catalog(spec.tables);}
  expected.targets[spec.db].push({targetId,keyValues:keys,expectedCount:facts.length,expectedDigest:digest(facts)});
 }
 const ref={path:`/etc/workspacex-cn/maintenance-readback/${identity.sourceRevision}/one/expected.json`,sha256:''};let bytes;
 const rehash=()=>{bytes=Buffer.from(JSON.stringify(expected));ref.sha256=crypto.createHash('sha256').update(bytes).digest('hex');};rehash();
 const calls=[];const control={binding:connection,identityBinding:identity,toolRevision:expected.toolRevision,mode:'diagnostic',transactionStatus:'I',identity:async()=>structuredClone(connection),
  client:{query:async(sql,params)=>{calls.push([sql,params]);if(sql==='BEGIN TRANSACTION READ ONLY'){control.transactionStatus='T';return {rows:[]};}
   if(sql==='ROLLBACK'){control.transactionStatus='I';return {rows:[]};}if(sql==='SHOW transaction_read_only')return {rows:[{transaction_read_only:'on'}]};
   if(sql===CATALOG_SQL)return {rows:catalog(params[1])};if(sql===EXTENSION_SQL)return {rows:structuredClone(extensions)};
   if(sql===AGENT_SEED_SQL)return {rows:structuredClone([seed])};if(sql.startsWith('SELECT json_build_object'))return {rows:[{json_build_object:{roles:[role],diagnosticPrivileges:privileges}}]};
   if(sql==="SET LOCAL statement_timeout = '5000ms'")return {rows:[]};throw Error('unexpected SQL');}}};
 const context={identity,connection,binding:Object.fromEntries(['identity','toolRevision','host','epoch','holdGeneration'].map(k=>[k,structuredClone(expected[k])])),expectedReadbackRef:ref,readPrivate:async()=>Buffer.from(bytes),verifyQualifiedExpected:async()=>true};
 return {control,context,expected,ref,calls,rehash,seed};
}
test('nine fixed existing-session probes prove read-only rollback and stable identity',async()=>{
 for(const db of DBS)for(const probe of PROBES){const f=fixture(db);const v=await readHeldCandidate(f.control,probe,{expectedReadbackSha256:f.ref.sha256},f.context);
  assert.equal(v.probe,probe);assert.equal(v.rollbackComplete,true);assert.equal(v.readOnlyTransaction,true);assert.deepEqual(v.connection,f.context.connection);
  assert.ok(/^[a-f0-9]{64}$/.test(v.evidenceSha256));assert.equal(f.calls[0][0],'BEGIN TRANSACTION READ ONLY');assert.equal(f.calls.at(-1)[0],'ROLLBACK');
  assert.equal(f.control.transactionStatus,'I');assert.ok(!JSON.stringify(v).includes('org-one'));
 }
});
test('SQL, unsupported targets, missing source qualification and default-empty targets reject before BEGIN',async()=>{
 for(const variant of ['sql','unknown','unqualified','empty','params','rawhash','epoch','generation']){const f=fixture();
  if(variant==='epoch')f.expected.epoch='f'.repeat(64);if(variant==='generation')f.expected.holdGeneration='f'.repeat(32);
  if(variant==='sql')f.expected.targets.workspacex[0].sql='SELECT evil';if(variant==='unknown')f.expected.targets.workspacex[0].targetId='caller-table';
  if(variant==='unqualified')f.context.verifyQualifiedExpected=async()=>false;if(variant==='empty')f.expected.targets.workspacex=[];
  f.rehash();const params={expectedReadbackSha256:variant==='rawhash'?'f'.repeat(64):f.ref.sha256};if(variant==='params')params.table='agents';
  await assert.rejects(readHeldCandidate(f.control,PROBES[0],params,f.context));assert.equal(f.calls.length,0);
 }
});
test('seed join semantic drift or digest/count mismatch always rolls back',async()=>{
 for(const variant of ['provider','agentid','listing','count','digest','absent']){const f=fixture();
  if(variant==='provider')f.seed.model_provider='foreign';if(variant==='agentid')f.seed.agent_id='foreign';if(variant==='listing')f.seed.listing_kind='skill';
  const target=f.expected.targets.workspacex.find(t=>t.targetId==='api-system-agent');if(variant==='count')target.expectedCount=0;if(variant==='digest')target.expectedDigest='0'.repeat(64);
  if(variant==='absent'){const q=f.control.client.query;f.control.client.query=async(s,p)=>s===AGENT_SEED_SQL?{rows:[]}:q(s,p);}f.rehash();
  await assert.rejects(readHeldCandidate(f.control,PROBES[2],{expectedReadbackSha256:f.ref.sha256},f.context));assert.equal(f.calls.at(-1)[0],'ROLLBACK');
 }
});
test('read-only, failed SELECT, ROLLBACK, session and expected-byte drift cannot produce proof',async()=>{
 for(const variant of ['readonly','select','rollback','session','bytes','missing-table','lost-begin']){const f=fixture();const q=f.control.client.query;
  f.control.client.query=async(s,p)=>{if(variant==='lost-begin'&&s==='BEGIN TRANSACTION READ ONLY'){await q(s,p);throw Error('lost begin reply');}if(variant==='readonly'&&s==='SHOW transaction_read_only')return {rows:[{transaction_read_only:'off'}]};if(variant==='select'&&s===CATALOG_SQL)throw Error('query fail');if(variant==='rollback'&&s==='ROLLBACK'){f.calls.push([s,p]);throw Error('rollback fail');}const value=await q(s,p);if(variant==='missing-table'&&s===CATALOG_SQL)value.rows.pop();return value;};
  if(variant==='session'){let n=0;f.control.identity=async()=>++n===1?f.context.connection:{...f.context.connection,pid:999};}
  if(variant==='bytes'){let n=0;const read=f.context.readPrivate;f.context.readPrivate=async()=>++n===1?read():Buffer.from('changed');}
  await assert.rejects(readHeldCandidate(f.control,PROBES[0],{expectedReadbackSha256:f.ref.sha256},f.context));
  assert.ok(f.calls.some(([s])=>s==='ROLLBACK'));
 }
});
test('initialization projections are named as schema facts and Date facts preserve timestamp digest',async()=>{
 const f=fixture('workspacex_memory');const out=await readHeldCandidate(f.control,PROBES[2],{expectedReadbackSha256:f.ref.sha256},f.context);
 assert.equal(out.verified,true);assert.equal(targets['memory-init-schema'].kind,'initialization-schema-projection');
 assert.equal(digest([new Date('2026-10-04T00:00:00Z')]),digest(['2026-10-04T00:00:00.000Z']));
 assert.notEqual(digest([new Date('2026-10-04T00:00:00Z')]),digest([new Date('2026-10-05T00:00:00Z')]));
});
test('three same source seed target ids with distinct source keys succeed; duplicate composite rejects',async()=>{
 const f=fixture();const rows=[];
 for(let n=0;n<3;n++){
  const seed={...f.seed,id:`agent-${n}`,agent_id:`agent-${n}`,listing_id:`agent-${n}`,stable_name:`source-seed-${n}`,model_provider:`source-provider-${n}`};rows.push(seed);
 }
 const other=f.expected.targets.workspacex.filter(t=>t.targetId!=='api-system-agent');
 f.expected.targets.workspacex=[...other,...rows.map(seed=>({targetId:'api-system-agent',keyValues:{orgId:seed.org_id,stableName:seed.stable_name,provider:seed.model_provider},expectedCount:1,expectedDigest:digest([seed])}))];
 const q=f.control.client.query;f.control.client.query=async(s,p)=>s===AGENT_SEED_SQL?{rows:[structuredClone(rows.find(r=>r.org_id===p[0]&&r.stable_name===p[1]))]}:q(s,p);
 f.rehash();assert.equal((await readHeldCandidate(f.control,PROBES[2],{expectedReadbackSha256:f.ref.sha256},f.context)).verified,true);
 f.expected.targets.workspacex.push(structuredClone(f.expected.targets.workspacex.at(-1)));f.rehash();
 await assert.rejects(readHeldCandidate(f.control,PROBES[2],{expectedReadbackSha256:f.ref.sha256},f.context),/HELD_TARGET_DUPLICATE/);
});
