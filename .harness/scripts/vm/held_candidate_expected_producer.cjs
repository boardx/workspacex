'use strict';
// Only borrowed, already-open isolated diagnostic sessions. No client constructor.
const crypto=require('node:crypto'),fs=require('node:fs');
const {targets,digest,CATALOG_SQL,EXTENSION_SQL,AGENT_SEED_SQL,sourceRoleSelect}=require('./held_candidate_queries.cjs');
const {deriveFixedAppSource}=require('./held_candidate_expected.cjs');
const APP='9b25bfa65662b96c0826fe67506b562ea46aa6d0',BASE='ba6343199f3c834d6a198f83d0c771614292c82b',RDS='pgm-uf6rg214cp381l49';
const DBS=['workspacex','workspacex_agent','workspacex_memory'],BIND=['identity','toolRevision','host','epoch','holdGeneration'];
const need=(v,c)=>{if(!v)throw Error(c);},same=(a,b)=>digest(a)===digest(b);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function protectedRead(io,ref){need(ref&&Object.keys(ref).sort().join(',')==='path,sha256'&&typeof ref.path==='string'&&/^[a-f0-9]{64}$/.test(ref.sha256),'HELD_PRODUCER_REF');const b=io.readProtected(ref);need(Buffer.isBuffer(b)&&sha(b)===ref.sha256,'HELD_PRODUCER_RAW_HASH');return b;}
function providerPeer(io,reference,control,binding,db,inReadOnly=false){
 const p=JSON.parse(protectedRead(io,reference));const attr=p.attribute?.Items?.DBInstanceAttribute,nets=p.network?.DBInstanceNetInfos?.DBInstanceNetInfo;
 need(same(p.binding,binding)&&Number.isFinite(p.observedAt)&&p.observedAt<=Date.now()/1000&&Date.now()/1000-p.observedAt<=3600,'HELD_PRODUCER_PROVIDER_EPOCH_TTL');
 need(Array.isArray(attr)&&attr.length===1&&attr[0].DBInstanceId===binding.targetInstanceId&&binding.targetInstanceId!==RDS&&/^pgm-[a-z0-9]+$/.test(binding.targetInstanceId)&&Array.isArray(nets),'HELD_PRODUCER_ISOLATED_PROVIDER');
 const peer=control.binding?.peer;need(control.mode==='diagnostic'&&control.client&&typeof control.client.query==='function'&&typeof control.identity==='function'&&control.transactionStatus===(inReadOnly?'T':'I')&&peer?.database===db&&same(control.identityBinding,binding.identity)&&control.toolRevision===binding.toolRevision,'HELD_PRODUCER_BORROWED_DIAGNOSTIC');
 const matches=nets.filter(n=>n.IPType==='Private'&&n.VPCId===attr[0].VpcId&&n.IPAddress===peer.remoteAddress&&Number(n.Port)===peer.remotePort);
 need(matches.length===1&&/^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^192\.168\./.test(peer.remoteAddress)&&peer.remotePort>0&&peer.remotePort<65536&&peer.user&&peer.database===db,'HELD_PRODUCER_ISOLATED_SOCKET');
 return p;
}
async function collectQualifiedExpected(io){
 need(io&&typeof io.readProtected==='function'&&typeof io.writeProtected==='function','HELD_PRODUCER_SOURCE_IO');
 need(io.producer?.sourcePath==='.harness/scripts/vm/held_candidate_expected_producer.cjs'&&protectedRead(io,io.producer.source).equals(fs.readFileSync(__filename))&&protectedRead(io,io.producer.executable).equals(fs.readFileSync(process.execPath)),'HELD_PRODUCER_ACTUAL_EXECUTABLE');
 const b=structuredClone(io.binding);need(b?.identity?.sourceRevision===APP&&b.identity.baselineRevision===BASE&&b.targetInstanceId!==RDS&&/^[a-f0-9]{64}$/.test(b.identity.migrationPlanSha256)&&/^[a-f0-9]{32}$/.test(b.holdGeneration),'HELD_PRODUCER_FIXED_BINDING');
 const qualified=JSON.parse(protectedRead(io,io.qualification)),completion=JSON.parse(protectedRead(io,io.migrationCompletion));
 need(qualified.kind==='held-current-epoch-manifest'&&same(qualified.identity,b.identity)&&qualified.toolRevision===b.toolRevision&&qualified.holdGeneration===b.holdGeneration,'HELD_PRODUCER_QUALIFIED_EPOCH');
 need(completion.scope==='validated-production-migration-completion'&&completion.sourceRevision===APP&&completion.baselineRevision===BASE&&completion.attemptId===b.identity.attemptId&&completion.originalPlanSha256===b.identity.migrationPlanSha256&&completion.pendingCount===0&&completion.driftCount===0&&completion.unknownAppliedCount===0&&completion.appliedSqlCount>0&&Date.parse(completion.expiresAt)>Date.now(),'HELD_PRODUCER_COMPLETION');
 const source=JSON.parse(protectedRead(io,io.appSourceManifest));const {seeds,requiredColumns}=deriveFixedAppSource(source,r=>protectedRead(io,r));
 need(typeof io.orgId==='string'&&io.orgId&&!/[\r\n\0]/.test(io.orgId)&&Object.keys(io.connections||{}).sort().join(',')===[...DBS].sort().join(',')&&Object.keys(io.roles||{}).sort().join(',')===[...DBS].sort().join(','),'HELD_PRODUCER_DB_CLOSURE');
 const root=`/etc/workspacex-cn/maintenance-readback/${APP}/${b.identity.attemptId}/`;let serial=0;
 const outputs=[];const write=(name,v)=>{const raw=Buffer.from(JSON.stringify(v)),path=root+name;const ref=io.writeProtected(path,raw);need(same(ref,{path,sha256:sha(raw)}),'HELD_PRODUCER_OUTPUT_PIN');need(protectedRead(io,ref).equals(raw),'HELD_PRODUCER_OUTPUT_READBACK');outputs.push(ref);return ref;};
 const all={workspacex:[],workspacex_agent:[],workspacex_memory:[]},inputs=[io.qualification,io.migrationCompletion,io.appSourceManifest,...Object.values(source.files)],stages={};
 const startedAt=Date.now()/1000;
 for(const db of DBS){const c=io.connections[db];providerPeer(io,io.providerRefs[db],c,b,db);inputs.push(io.providerRefs[db]);const connection=structuredClone(c.binding);need(same(await c.identity(),connection),'HELD_PRODUCER_CONNECTION_DRIFT');let began=false,failure;const rows=[];
  try{began=true;await c.client.query('BEGIN TRANSACTION READ ONLY');const ro=await c.client.query('SHOW transaction_read_only');need(ro.rows?.length===1&&ro.rows[0].transaction_read_only==='on','HELD_PRODUCER_READ_ONLY');await c.client.query("SET LOCAL statement_timeout = '5000ms'");
   for(const [id,spec] of Object.entries(targets)){if(spec.db!==db)continue;const keys=spec.kind==='system-agent-seed'?seeds.map(s=>({orgId:io.orgId,...s})):spec.keys.includes('scope')?[{scope:spec.schema}]:[{role:io.roles[db]}];
    for(const keyValues of keys){let facts;
     if(spec.kind==='role-permission-projection'){const r=await c.client.query(sourceRoleSelect());need(r.rows?.length===1,'HELD_PRODUCER_ROLE_OUTPUT');const full=Object.values(r.rows[0])[0],role=full.roles?.find(v=>v.name===keyValues.role);need(role&&full.diagnosticPrivileges,'HELD_PRODUCER_ROLE_CLOSURE');facts=[{kind:spec.kind,role,diagnosticPrivileges:full.diagnosticPrivileges}];}
     else if(spec.kind==='system-agent-seed'){facts=(await c.client.query(AGENT_SEED_SQL,[keyValues.orgId,keyValues.stableName])).rows;need(facts?.length===1,'HELD_PRODUCER_SEED_COUNT');const a=facts[0];need(a.org_id===keyValues.orgId&&a.stable_name===keyValues.stableName&&a.agent_id===a.id&&a.version_org===a.org_id&&a.model_provider===keyValues.provider&&a.published_at&&a.published_version_id&&a.listing_id===a.id&&a.listing_org===a.org_id&&a.listing_kind==='agent','HELD_PRODUCER_SEED_JOIN');}
     else{const catalog=(await c.client.query(CATALOG_SQL,[spec.schema,spec.tables])).rows;need(Array.isArray(catalog)&&catalog.length>0&&catalog.length<=10000&&same(catalog.filter(r=>r.kind==='relation').map(r=>r.fact.table).sort(),[...spec.tables].sort()),'HELD_PRODUCER_CATALOG_CLOSURE');for(const table of spec.tables){need(catalog.some(r=>r.kind==='column'&&r.fact.table===table),'HELD_PRODUCER_COLUMN_CLOSURE');for(const column of requiredColumns[table]||[])need(catalog.some(r=>r.kind==='column'&&r.fact.table===table&&r.fact.column===column),'HELD_PRODUCER_BOOTSTRAP_COLUMN');}if(spec.kind==='initialization-schema-projection'){const extensions=(await c.client.query(EXTENSION_SQL)).rows;need(Array.isArray(extensions)&&extensions.length>0&&extensions.length<=10000,'HELD_PRODUCER_EXTENSIONS');facts=[{kind:spec.kind,catalog,extensions}];}else facts=catalog;}
     // JSON normalizes PostgreSQL Date objects identically to the consumer digest.
     facts=JSON.parse(JSON.stringify(facts));rows.push({targetId:id,keyValues,facts});
    }
   }
   need(same(await c.identity(),connection),'HELD_PRODUCER_CONNECTION_DRIFT');providerPeer(io,io.providerRefs[db],c,b,db,true);
  }catch(e){failure=e;}finally{if(began)try{await c.client.query('ROLLBACK');need(c.transactionStatus==='I'&&same(await c.identity(),connection),'HELD_PRODUCER_ROLLBACK_UNPROVEN');}catch{failure=Error('HELD_PRODUCER_ROLLBACK_UNPROVEN');}}
  if(failure)throw failure;
  const refs={};for(const row of rows)refs[String(++serial)]=write('facts-'+serial+'.json',row.facts);
  const stage=write(db+'-fixed-projections.stage.json',{schemaVersion:1,stage:'held-candidate-fixed-projections',binding:{candidateSha:APP,targetInstanceId:b.targetInstanceId},epochBinding:b,database:db,connection,readOnlyTransaction:true,rollbackComplete:true,proofRefs:refs});stages[db]=stage;
  rows.forEach((r,i)=>all[db].push({targetId:r.targetId,keyValues:r.keyValues,factsRef:Object.values(refs)[i],stageReceipt:stage}));inputs.push(...Object.values(refs),stage);
 }
 const aggregate=write('aggregate.json',{schemaVersion:1,kind:'qualified-held-readback-aggregate',binding:b,qualification:io.qualification,migrationCompletion:io.migrationCompletion,appSourceManifest:io.appSourceManifest,targets:all});
 const expected=write('expected.json',{...Object.fromEntries(BIND.map(k=>[k,b[k]])),kind:'source-derived-held-candidate-readback',qualificationEvidenceSha256:io.qualification.sha256,targets:Object.fromEntries(DBS.map(db=>[db,all[db].map(r=>{const facts=JSON.parse(protectedRead(io,r.factsRef));return {targetId:r.targetId,keyValues:r.keyValues,expectedCount:facts.length,expectedDigest:digest(facts)};})]))});
 need(io.producer&&io.producer.sourcePath==='.harness/scripts/vm/held_candidate_expected_producer.cjs','HELD_PRODUCER_SOURCE_DESCRIPTOR');protectedRead(io,io.producer.source);protectedRead(io,io.producer.executable);
 const stat=fs.readFileSync('/proc/self/stat','utf8'),processStart=stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
 const namespaces=Object.fromEntries(['pid','mnt','net'].map(k=>[k,fs.readlinkSync('/proc/self/ns/'+k).match(/\[([0-9]+)\]/)[1]]));need(same(namespaces,io.producer.namespaces),'HELD_PRODUCER_NAMESPACE_DESCRIPTOR');
 const invocation=write('aggregate.invocation.json',{schemaVersion:2,kind:'held-readback-aggregate',binding:b,producerId:'fixed-isolated-projections',source:io.producer.source,executable:io.producer.executable,pid:process.pid,processStart,startedAt,endedAt:Date.now()/1000,namespaces,output:aggregate,inputs,exitCode:0,ownedChildrenJoined:true});
 // This output is evidence only. Root must separately approve/pin aggregatePolicy.
 return {aggregate,expected,invocation,isolatedStageReceipts:stages,producer:structuredClone(io.producer),ready:false,productionAvailabilityProven:false};
}
module.exports={collectQualifiedExpected};
