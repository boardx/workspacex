'use strict';
// Offline authority verifier. Root supplies its protected reader/profile in code.
// No SQL, process, network or caller-supplied executable is accepted here.
const crypto=require('node:crypto');
const {targets,digest}=require('./held_candidate_queries.cjs');
const APP='9b25bfa65662b96c0826fe67506b562ea46aa6d0',BASE='ba6343199f3c834d6a198f83d0c771614292c82b';
const BIND=['identity','toolRevision','host','epoch','holdGeneration'];
const SOURCE_PATHS=['packages/contracts/src/agent-defaults.ts','apps/api/src/application/agent-run/ports.ts',
 'apps/api/src/application/agent/ensure-deep-research-agent.ts','apps/api/src/application/agent/ensure-image-gen-agent.ts',
 'apps/api/src/infrastructure/agent/pg-default-agent-repository.ts','apps/api/src/infrastructure/agent/pg-deep-research-agent-repository.ts',
 'apps/api/src/infrastructure/agent/pg-image-gen-agent-repository.ts','apps/api/src/infrastructure/deploy/bootstrap-write-columns.ts'];
function need(v,c){if(!v)throw Error(c);}
function exact(v,k,c){need(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...k].sort().join(','),c);}
const rawhash=b=>crypto.createHash('sha256').update(b).digest('hex');
const same=(a,b)=>digest(a)===digest(b);
function deriveFixedAppSource(source,read){
 exact(source,['schemaVersion','sourceRevision','files'],'HELD_QUALIFIER_APP_SOURCE');need(source.schemaVersion===1&&source.sourceRevision===APP,'HELD_QUALIFIER_APP_SOURCE');
  const text={};for(const path of SOURCE_PATHS){need(source.files[path],'HELD_QUALIFIER_APP_SOURCE_CLOSURE');text[path]=read(source.files[path]).toString('utf8');}
  function literal(path,name){const matches=[...text[path].matchAll(new RegExp('export const '+name+'\\s*=\\s*"([^"\\r\\n]+)"\\s*;','g'))];need(matches.length===1,'HELD_QUALIFIER_SOURCE_LITERAL');return matches[0][1];}
  const seeds=[['DEFAULT_AGENT','DEEP_AGENT_PROVIDER_NAME',SOURCE_PATHS[1]],['DEEP_RESEARCH_AGENT','DEEP_RESEARCH_AGENT_PROVIDER',SOURCE_PATHS[2]],['IMAGE_GEN_AGENT','IMAGE_GEN_AGENT_PROVIDER',SOURCE_PATHS[3]]].map(([stem,p,path])=>({stableName:literal(SOURCE_PATHS[0],stem+'_STABLE_NAME'),provider:literal(path,p)}));
  for(const [idx,stem] of ['DEFAULT_AGENT','DEEP_RESEARCH_AGENT','IMAGE_GEN_AGENT'].entries()){const t=text[SOURCE_PATHS[4+idx]];need(t.includes('stableName: '+stem+'_STABLE_NAME')&&(idx? t.includes('provider: '+stem+'_PROVIDER'):t.includes('provider: DEEP_AGENT_PROVIDER_NAME')&&t.includes('resolveModel: resolveDeepAgentModel')),'HELD_QUALIFIER_TEMPLATE_CLOSURE');}
  const writeColumns={auth_bootstrap_state:'marker',credentials:'credential',organizations:'organization',org_memberships:'membership',agents:'agentInsertColumns',agent_versions:'version',capability_listings:'listing'};
  const requiredColumns={};for(const [table,name] of Object.entries(writeColumns)){const m=text[SOURCE_PATHS[7]].match(new RegExp('\\b'+name+':\\s*\\[([^\\]]+)\\]'));need(m,'HELD_QUALIFIER_BOOTSTRAP_COLUMNS_SOURCE');const cols=[...m[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]);need(cols.length>0,'HELD_QUALIFIER_BOOTSTRAP_COLUMNS_SOURCE');requiredColumns[table]=cols;}
 return {seeds,requiredColumns};
}
function createQualifiedExpectedVerifier(authority){
 need(authority&&typeof authority.readProtected==='function'&&authority.profile,'HELD_QUALIFIER_ROOT_AUTHORITY');
 const profile=authority.profile,entry=profile.heldCandidateExpected;
 exact(entry,['expected','aggregate','qualification','qualificationInput','sourcePolicy','migrationCompletion','appSourceManifest','aggregatePolicy','sourcePath','sha256'],'HELD_QUALIFIER_PROFILE');
 need(entry.sourcePath==='.harness/scripts/vm/held_candidate_expected.cjs'&&profile.filesSha256?.[entry.sourcePath]===entry.sha256&&/^[a-f0-9]{64}$/.test(entry.sha256),'HELD_QUALIFIER_SOURCE_PIN');
 const read=ref=>{exact(ref,['path','sha256'],'HELD_QUALIFIER_REF');need(typeof ref.path==='string'&&ref.path.startsWith('/etc/workspacex-cn/')&&!ref.path.split('/').includes('..')&&/^[a-f0-9]{64}$/.test(ref.sha256),'HELD_QUALIFIER_REF');const b=authority.readProtected(ref);need(Buffer.isBuffer(b)&&rawhash(b)===ref.sha256,'HELD_QUALIFIER_RAW_HASH');return b;};
 const json=ref=>JSON.parse(read(ref).toString('utf8'));
 return function verifyQualifiedExpected(ref,expected){
  need(same(ref,entry.expected)&&same(json(ref),expected),'HELD_QUALIFIER_EXPECTED_PIN');
  const binding=Object.fromEntries(BIND.map(k=>[k,expected[k]]));
  need(binding.identity?.sourceRevision===APP&&binding.identity.baselineRevision===BASE&&binding.toolRevision===profile.toolRevision,'HELD_QUALIFIER_FIXED_APP');
  const prefix=`/etc/workspacex-cn/maintenance-evidence/${APP}/${binding.identity.attemptId}/`;
  need(entry.qualificationInput.path===prefix+'qualification-input.json'&&entry.qualification.path===prefix+'qualified-current-epoch/epoch.json','HELD_QUALIFIER_CURRENT_EPOCH_PATH');
  const input=json(entry.qualificationInput),policy=json(entry.sourcePolicy),qualified=json(entry.qualification);
  need(input.schemaVersion===2&&input.kind==='current-held-epoch-qualification'&&same(input.sourcePolicy,entry.sourcePolicy)&&same(input.binding,policy.binding)&&policy.kind==='source-approved-epoch-policy'&&policy.schemaVersion===2,'HELD_QUALIFIER_POLICY');
  need(BIND.every(k=>same(input.binding[k],binding[k]))&&qualified.kind==='held-current-epoch-manifest'&&qualified.toolRevision===binding.toolRevision&&same(qualified.identity,binding.identity)&&qualified.holdGeneration===binding.holdGeneration&&expected.qualificationEvidenceSha256===entry.qualification.sha256,'HELD_QUALIFIER_EPOCH_BINDING');
  exact(qualified.databases,['workspacex','workspacex_agent','workspacex_memory'],'HELD_QUALIFIER_DATABASES');
  for(const r of Object.values(qualified.databases)){const db=json(r);need(db.kind==='qualified-held-database-evidence'&&same(db.binding,input.binding)&&same(db.sourcePolicy,entry.sourcePolicy),'HELD_QUALIFIER_DATABASE_BINDING');}
  const aggregate=json(entry.aggregate);exact(aggregate,['schemaVersion','kind','binding','qualification','migrationCompletion','appSourceManifest','targets'],'HELD_QUALIFIER_AGGREGATE');
  need(aggregate.schemaVersion===1&&aggregate.kind==='qualified-held-readback-aggregate'&&same(aggregate.binding,input.binding)&&same(aggregate.qualification,entry.qualification)&&same(aggregate.migrationCompletion,entry.migrationCompletion)&&same(aggregate.appSourceManifest,entry.appSourceManifest),'HELD_QUALIFIER_AGGREGATE_BINDING');
  // Actual aggregate invocation is source-approved, fully read back, and joined.
  const aggregatePolicy=json(entry.aggregatePolicy);exact(aggregatePolicy,['schemaVersion','kind','binding','producer','invocation','isolatedStageReceipts'],'HELD_QUALIFIER_AGGREGATE_POLICY');need(aggregatePolicy.schemaVersion===1&&aggregatePolicy.kind==='source-approved-held-readback-policy'&&same(aggregatePolicy.binding,input.binding),'HELD_QUALIFIER_AGGREGATE_POLICY');const invocation=json(aggregatePolicy.invocation);const producer=aggregatePolicy.producer;
  need(invocation.kind==='held-readback-aggregate'&&invocation.schemaVersion===2&&same(invocation.binding,input.binding)&&same(invocation.output,entry.aggregate)&&producer&&same(invocation.source,producer.source)&&same(invocation.executable,producer.executable)&&same(invocation.namespaces,producer.namespaces)&&producer.sourcePath==='.harness/scripts/vm/held_candidate_expected_producer.cjs'&&profile.filesSha256?.[producer.sourcePath]===producer.source.sha256&&invocation.exitCode===0&&invocation.ownedChildrenJoined===true&&Number.isSafeInteger(invocation.pid)&&invocation.pid>1&&/^[0-9]+$/.test(invocation.processStart)&&Number.isFinite(invocation.startedAt)&&invocation.startedAt<=invocation.endedAt,'HELD_QUALIFIER_INVOCATION');
  read(invocation.source);read(invocation.executable);need(invocation.inputs.some(r=>same(r,entry.qualification))&&invocation.inputs.some(r=>same(r,entry.migrationCompletion))&&invocation.inputs.some(r=>same(r,entry.appSourceManifest)),'HELD_QUALIFIER_INVOCATION_INPUTS');for(const r of invocation.inputs)read(r);
  const completion=json(entry.migrationCompletion);
  need(completion.schemaVersion===1&&completion.scope==='validated-production-migration-completion'&&completion.sourceRevision===APP&&completion.baselineRevision===BASE&&completion.attemptId===binding.identity.attemptId&&completion.originalPlanSha256===binding.identity.migrationPlanSha256&&completion.release==='2026.10.3-cn.1'&&completion.pendingCount===0&&completion.driftCount===0&&completion.unknownAppliedCount===0&&Number.isSafeInteger(completion.appliedSqlCount)&&completion.appliedSqlCount>0&&Date.parse(completion.expiresAt)>Date.now(),'HELD_QUALIFIER_MIGRATION_COMPLETION');
  const source=json(entry.appSourceManifest);exact(source,['schemaVersion','sourceRevision','files'],'HELD_QUALIFIER_APP_SOURCE');need(source.schemaVersion===1&&source.sourceRevision===APP,'HELD_QUALIFIER_APP_SOURCE');
  const {seeds,requiredColumns}=deriveFixedAppSource(source,read);
  exact(aggregate.targets,['workspacex','workspacex_agent','workspacex_memory'],'HELD_QUALIFIER_TARGET_DATABASES');exact(expected.targets,Object.keys(aggregate.targets),'HELD_QUALIFIER_TARGET_DATABASES');
  const seen=new Set(),observedSeeds=[];
  for(const db of Object.keys(aggregate.targets)){
   const rows=aggregate.targets[db];need(Array.isArray(rows)&&rows.length>0,'HELD_QUALIFIER_TARGETS');const derived=[];
   for(const row of rows){exact(row,['targetId','keyValues','factsRef','stageReceipt'],'HELD_QUALIFIER_TARGET');need(Object.values(aggregatePolicy.isolatedStageReceipts).some(r=>same(r,row.stageReceipt))&&invocation.inputs.some(r=>same(r,row.factsRef)),'HELD_QUALIFIER_FACT_SOURCE_REF');const stage=json(row.stageReceipt);need(stage.schemaVersion===1&&stage.stage==='held-candidate-fixed-projections'&&same(stage.epochBinding,input.binding)&&stage.database===db&&stage.readOnlyTransaction===true&&stage.rollbackComplete===true&&stage.binding?.candidateSha===APP&&stage.binding?.targetInstanceId===input.binding.targetInstanceId&&stage.proofRefs&&Object.values(stage.proofRefs).some(r=>same(r,row.factsRef)),'HELD_QUALIFIER_ISOLATED_STAGE_LINEAGE');row.facts=json(row.factsRef);const spec=targets[row.targetId];need(spec?.db===db&&Array.isArray(row.facts)&&row.facts.length>0,'HELD_QUALIFIER_TARGET_SOURCE');exact(row.keyValues,spec.keys,'HELD_QUALIFIER_TARGET_KEYS');const key=row.targetId+':'+digest(row.keyValues);need(!seen.has(key),'HELD_QUALIFIER_TARGET_DUPLICATE');seen.add(key);
    if(spec.kind==='system-agent-seed'){need(row.facts.length===1&&seeds.some(s=>same(s,{stableName:row.keyValues.stableName,provider:row.keyValues.provider})),'HELD_QUALIFIER_SEED_SOURCE');const a=row.facts[0];need(a.org_id===row.keyValues.orgId&&a.stable_name===row.keyValues.stableName&&a.agent_id===a.id&&a.version_org===a.org_id&&a.model_provider===row.keyValues.provider&&a.published_at&&a.listing_id===a.id&&a.listing_org===a.org_id&&a.listing_kind==='agent','HELD_QUALIFIER_SEED_FACT');observedSeeds.push(row.keyValues);}
    else if(spec.tables){const catalog=spec.kind==='initialization-schema-projection'?row.facts[0]?.catalog:row.facts;need(row.keyValues.scope===spec.schema&&Array.isArray(catalog)&&same(catalog.filter(r=>r.kind==='relation').map(r=>r.fact.table).sort(),[...spec.tables].sort()),'HELD_QUALIFIER_TABLE_CLOSURE');for(const table of spec.tables)need(catalog.some(r=>r.kind==='column'&&r.fact.table===table),'HELD_QUALIFIER_COLUMN_CLOSURE');for(const table of spec.tables)for(const column of requiredColumns[table]||[])need(catalog.some(r=>r.kind==='column'&&r.fact.table===table&&r.fact.column===column),'HELD_QUALIFIER_BOOTSTRAP_COLUMN_MISSING');if(spec.kind==='initialization-schema-projection')need(row.facts.length===1&&row.facts[0].extensions?.length>0,'HELD_QUALIFIER_INIT_CLOSURE');}
    else need(row.facts.length===1&&row.facts[0].role?.name===row.keyValues.role&&row.facts[0].diagnosticPrivileges,'HELD_QUALIFIER_PERMISSION_CLOSURE');
    derived.push({targetId:row.targetId,keyValues:row.keyValues,expectedCount:row.facts.length,expectedDigest:digest(row.facts)});
   }
   need(same(derived,expected.targets[db]),'HELD_QUALIFIER_EXPECTED_DERIVATION');
  }
  for(const id of Object.keys(targets))need([...seen].some(k=>k.startsWith(id+':')),'HELD_QUALIFIER_NINE_TARGET_CLOSURE');
  need(observedSeeds.length===3&&new Set(observedSeeds.map(s=>s.orgId)).size===1&&same(observedSeeds.map(s=>s.stableName).sort(),seeds.map(s=>s.stableName).sort()),'HELD_QUALIFIER_THREE_SEEDS');
  // Re-read authority outputs to detect changing protected facts.
  for(const r of [ref,entry.aggregate,entry.qualification,entry.sourcePolicy,entry.migrationCompletion,entry.appSourceManifest,entry.aggregatePolicy])read(r);
  return true;
 };
}
module.exports={createQualifiedExpectedVerifier,deriveFixedAppSource,SOURCE_PATHS};
