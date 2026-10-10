'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const {createQualifiedExpectedVerifier,SOURCE_PATHS}=require('./held_candidate_expected.cjs');
const {targets,digest}=require('./held_candidate_queries.cjs');
function fixture(variant,pair){
 const [APP,BASE]=pair||['9b25bfa65662b96c0826fe67506b562ea46aa6d0','ba6343199f3c834d6a198f83d0c771614292c82b'];
 const binding={identity:{sourceRevision:APP,baselineRevision:BASE,attemptId:'one',migrationPlanSha256:'a'.repeat(64)},toolRevision:'b'.repeat(40),host:{instanceId:'host',bootId:'boot'},epoch:'c'.repeat(64),holdGeneration:'d'.repeat(32),targetInstanceId:'isolated',providerBindingSha256:'e'.repeat(64)};
 const root=`/etc/workspacex-cn/maintenance-evidence/${APP}/one/`,raw=new Map();let n=0;
 const put=(v,path=root+'fact-'+(++n))=>{const b=Buffer.isBuffer(v)?v:Buffer.from(JSON.stringify(v)),ref={path,sha256:crypto.createHash('sha256').update(b).digest('hex')};raw.set(path,b);return ref;};
 const files={};for(const p of SOURCE_PATHS)files[p]=put(fs.readFileSync(p));
 const app=put({schemaVersion:1,sourceRevision:APP,files});
 const completion=put({schemaVersion:1,scope:'validated-production-migration-completion',sourceRevision:APP,baselineRevision:BASE,attemptId:'one',release:'2026.10.3-cn.1',originalPlanSha256:binding.identity.migrationPlanSha256,pendingCount:0,driftCount:0,unknownAppliedCount:0,appliedSqlCount:255,expiresAt:new Date(Date.now()+60000).toISOString()});
 const source=put(Buffer.from('fixture source')),executable=put(Buffer.from('fixture executable'));
 const policy={schemaVersion:2,kind:'source-approved-epoch-policy',binding};
 const policyRef=put(policy);
 const qualified={kind:'held-current-epoch-manifest',identity:binding.identity,toolRevision:binding.toolRevision,holdGeneration:binding.holdGeneration,databases:{}};
 const aggregate={schemaVersion:1,kind:'qualified-held-readback-aggregate',binding,qualification:null,migrationCompletion:completion,appSourceManifest:app,targets:{workspacex:[],workspacex_agent:[],workspacex_memory:[]}};
 const columns=fs.readFileSync(SOURCE_PATHS[7],'utf8');const writeColumns={auth_bootstrap_state:'marker',credentials:'credential',organizations:'organization',org_memberships:'membership',agents:'agentInsertColumns',agent_versions:'version',capability_listings:'listing'};
 const catalog=tables=>tables.flatMap(table=>[{kind:'relation',fact:{table}},...(writeColumns[table]?[...columns.match(new RegExp('\\b'+writeColumns[table]+':\\s*\\[([^\\]]+)\\]'))[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]):['fixture']).map(column=>({kind:'column',fact:{table,column}}))]);
 for(const [targetId,spec] of Object.entries(targets)){
  if(spec.kind==='system-agent-seed')continue;
  const keyValues=spec.keys.includes('scope')?{scope:spec.schema}:{role:'runtime'};
  const facts=spec.kind==='role-permission-projection'?[{role:{name:'runtime'},diagnosticPrivileges:{tableWrite:false}}]:spec.kind==='initialization-schema-projection'?[{catalog:catalog(spec.tables),extensions:[{extname:'plpgsql'}]}]:catalog(spec.tables);
  aggregate.targets[spec.db].push({targetId,keyValues,facts});
 }
 const contracts=fs.readFileSync(SOURCE_PATHS[0],'utf8');const lit=(p,name)=>fs.readFileSync(p,'utf8').match(new RegExp('export const '+name+'\\s*=\\s*"([^"]+)"'))[1];
 for(const [stem,p,name] of [['DEFAULT_AGENT',SOURCE_PATHS[1],'DEEP_AGENT_PROVIDER_NAME'],['DEEP_RESEARCH_AGENT',SOURCE_PATHS[2],'DEEP_RESEARCH_AGENT_PROVIDER'],['IMAGE_GEN_AGENT',SOURCE_PATHS[3],'IMAGE_GEN_AGENT_PROVIDER']]){
  const stableName=contracts.match(new RegExp('export const '+stem+'_STABLE_NAME\\s*=\\s*"([^"]+)"'))[1],provider=lit(p,name),id=stem;
  aggregate.targets.workspacex.push({targetId:'api-system-agent',keyValues:{orgId:'org',stableName,provider},facts:[{id,org_id:'org',stable_name:stableName,agent_id:id,version_org:'org',model_provider:provider,published_at:'today',listing_id:id,listing_org:'org',listing_kind:'agent'}]});
 }
 if(variant==='seed')aggregate.targets.workspacex.pop();
 if(variant==='duplicate-seed'){const rows=aggregate.targets.workspacex.filter(r=>r.targetId==='api-system-agent');rows[1].keyValues=structuredClone(rows[0].keyValues);rows[1].facts=structuredClone(rows[0].facts);}
 if(variant==='empty')aggregate.targets.workspacex[0].facts=[];
 if(variant==='columns')aggregate.targets.workspacex[0].facts=aggregate.targets.workspacex[0].facts.filter(r=>r.kind!=='column'||r.fact.column!=='password_hash');
 if(variant==='provider'){const row=aggregate.targets.workspacex.find(r=>r.targetId==='api-system-agent');row.keyValues.provider='foreign';row.facts[0].model_provider='foreign';}
 if(variant==='database')delete aggregate.targets.workspacex_memory;
 for(const db of Object.keys(aggregate.targets))qualified.databases[db]=put({kind:'qualified-held-database-evidence',binding,sourcePolicy:policyRef});
 const qualification=put(qualified,root+'qualified-current-epoch/epoch.json');aggregate.qualification=qualification;
 const inputs=[qualification,completion,app],stageRefs={};
 for(const [db,rows] of Object.entries(aggregate.targets))for(const row of rows){const factsRef=put(row.facts);delete row.facts;row.factsRef=factsRef;row.stageReceipt=put({schemaVersion:1,stage:'held-candidate-fixed-projections',epochBinding:binding,database:db,readOnlyTransaction:true,rollbackComplete:true,binding:{candidateSha:APP,targetInstanceId:binding.targetInstanceId},proofRefs:{facts:factsRef}});inputs.push(factsRef);stageRefs[row.stageReceipt.path]=row.stageReceipt;}
 const aggregateRef=put(aggregate);
 const invocation=put({schemaVersion:2,kind:'held-readback-aggregate',binding,producerId:'one',source,executable,pid:10,processStart:'12',startedAt:1,endedAt:2,namespaces:{pid:'1',mnt:'2',net:'3'},output:aggregateRef,inputs,exitCode:0,ownedChildrenJoined:true});
 const aggregatePolicy=put({schemaVersion:1,kind:'source-approved-held-readback-policy',binding,producer:{sourcePath:'.harness/scripts/vm/held_candidate_expected_producer.cjs',source,executable,namespaces:{pid:'1',mnt:'2',net:'3'}},invocation,isolatedStageReceipts:stageRefs});
 const qualificationInput=put({schemaVersion:2,kind:'current-held-epoch-qualification',binding,sourcePolicy:policyRef},root+'qualification-input.json');
 const expected={...Object.fromEntries(['identity','toolRevision','host','epoch','holdGeneration'].map(k=>[k,binding[k]])),kind:'source-derived-held-candidate-readback',qualificationEvidenceSha256:qualification.sha256,targets:{}};
 for(const [db,rows] of Object.entries(aggregate.targets))expected.targets[db]=rows.map(row=>{const facts=JSON.parse(raw.get(row.factsRef.path));return {targetId:row.targetId,keyValues:row.keyValues,expectedCount:facts.length,expectedDigest:digest(facts)};});
 const entry={expected:put(expected),aggregate:aggregateRef,qualification,qualificationInput,sourcePolicy:policyRef,migrationCompletion:completion,appSourceManifest:app,aggregatePolicy,sourcePath:'.harness/scripts/vm/held_candidate_expected.cjs',sha256:'f'.repeat(64)};
 const manifestRef=put({sourceRevision:APP,release:'2026.10.3-cn.1'});
 const profile={candidateComposeEmitter:{optionsRef:put({manifestRef}),configRef:put({provision:{release:'2026.10.3-cn.1'}})},toolRevision:binding.toolRevision,heldCandidateExpected:entry,filesSha256:{[entry.sourcePath]:entry.sha256,'.harness/scripts/vm/held_candidate_expected_producer.cjs':source.sha256}};
 const verify=createQualifiedExpectedVerifier({profile,readProtected:ref=>raw.get(ref.path)});
 return {verify,entry,expected,raw,put,aggregate,profile};
}
test('missing source-owned qualification authority rejects; no ambient files are consulted',()=>{
 assert.throws(()=>createQualifiedExpectedVerifier({profile:{},readProtected:()=>Buffer.from('{}')}),/HELD_QUALIFIER_PROFILE/);
});
test('hash mismatch rejects before trusting an expected passed flag',()=>{
 const entry={expected:{path:'/etc/workspacex-cn/expected',sha256:'a'.repeat(64)},aggregate:{},qualification:{},qualificationInput:{},sourcePolicy:{},migrationCompletion:{},appSourceManifest:{},aggregatePolicy:{},sourcePath:'.harness/scripts/vm/held_candidate_expected.cjs',sha256:'b'.repeat(64)};
 const verify=createQualifiedExpectedVerifier({profile:{heldCandidateExpected:entry,filesSha256:{[entry.sourcePath]:entry.sha256}},readProtected:()=>Buffer.from('{"passed":true}')});
 assert.throws(()=>verify(entry.expected,{passed:true}),/HELD_QUALIFIER_RAW_HASH/);
});
test('source-pinned current epoch, completion, nine targets and three templates verify',()=>{const f=fixture();assert.equal(f.verify(f.entry.expected,f.expected),true);});
test('source-rehashed seed omission, empty facts, missing bootstrap column, provider and DB drift reject',()=>{
 for(const variant of ['seed','duplicate-seed','empty','columns','provider','database']){const f=fixture(variant);assert.throws(()=>f.verify(f.entry.expected,f.expected));}
});
module.exports={fixture};

const currentPair=['5285bef9a6c91bbb9857ede42779aafa64b98f32','a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0'];
test('new pair uses the same protected expected verifier',()=>{const f=fixture(undefined,currentPair);assert.equal(f.verify(f.entry.expected,f.expected),true);});
for(const pair of [[currentPair[0],'ba6343199f3c834d6a198f83d0c771614292c82b'],['9b25bfa65662b96c0826fe67506b562ea46aa6d0',currentPair[1]],['f'.repeat(40),'e'.repeat(40)]])test('self-consistent forbidden pair '+pair[0].slice(0,4),()=>{const f=fixture(undefined,pair);assert.throws(()=>f.verify(f.entry.expected,f.expected),/FIXED_APP/);});
