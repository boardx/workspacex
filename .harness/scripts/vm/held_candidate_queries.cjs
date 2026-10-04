'use strict';
// Existing diagnostic client only. Importing opens no database or host connection.
const crypto=require('node:crypto');
const APP='9b25bfa65662b96c0826fe67506b562ea46aa6d0';
const DBS=['workspacex','workspacex_agent','workspacex_memory'];
const PROBES=['held-candidate-schema','held-candidate-permissions','held-candidate-seed'];
const BIND=['identity','toolRevision','host','epoch','holdGeneration'];
function need(ok,code){if(!ok)throw Error(code);}
function exact(v,keys,code){need(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(','),code);}
function canonical(v){if(v instanceof Date)return canonical(v.toISOString());if(v===null||typeof v!=='object')return JSON.stringify(v).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>canonical(k)+':'+canonical(v[k])).join(',')+'}';}
const digest=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
const same=(a,b)=>digest(a)===digest(b);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const API_TABLES=['auth_bootstrap_state','credentials','organizations','org_memberships','agents','agent_versions','capability_listings'];
const AGENT_TABLES=['checkpoints','checkpoint_blobs','checkpoint_writes','checkpoint_migrations'];
const MEMORY_TABLES=['store','store_migrations'];
const CATALOG_SQL=`SELECT kind,fact FROM (SELECT 'column' AS kind,jsonb_build_object('table',table_name,'column',column_name,'type',udt_name,'nullable',is_nullable,'ordinal',ordinal_position) AS fact FROM information_schema.columns WHERE table_schema=$1 AND table_name=ANY($2::text[])
UNION ALL SELECT 'relation',jsonb_build_object('table',c.relname,'rls',c.relrowsecurity,'forced',c.relforcerowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=ANY($2::text[])
UNION ALL SELECT 'policy',jsonb_build_object('table',tablename,'policy',policyname,'roles',roles,'cmd',cmd,'qual',qual,'check',with_check) FROM pg_policies WHERE schemaname=$1 AND tablename=ANY($2::text[])) AS projection ORDER BY kind,fact::text LIMIT 10001`;
const EXTENSION_SQL='SELECT extname,extversion FROM pg_extension ORDER BY extname COLLATE "C" LIMIT 10001';
const AGENT_SEED_SQL=`SELECT a.id,a.org_id,a.stable_name,a.published_version_id,v.agent_id,v.org_id AS version_org,v.model_provider,v.published_at,c.id AS listing_id,c.org_id AS listing_org,c.kind AS listing_kind FROM public.agents a LEFT JOIN public.agent_versions v ON v.id=a.published_version_id AND v.org_id=a.org_id LEFT JOIN public.capability_listings c ON c.id=a.id WHERE a.org_id=$1 AND a.stable_name=$2 ORDER BY a.id LIMIT 3`;
// Load on invocation so control_connection can import this module without a cycle.
function sourceRoleSelect(){
 const {READ_QUERIES}=require('./control_connection.cjs');
 need(READ_QUERIES.roles.startsWith('BEGIN TRANSACTION READ ONLY; ')&&READ_QUERIES.roles.endsWith('; ROLLBACK;'),'HELD_ROLE_SOURCE_BOUNDARY');
 const sql=READ_QUERIES.roles.slice('BEGIN TRANSACTION READ ONLY; '.length,-'; ROLLBACK;'.length);
 need(/^SELECT\b/.test(sql)&&!/;|\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|COPY|CALL|DO)\b/i.test(sql.replace(/'(?:''|[^'])*'/g,"''")),'HELD_ROLE_SOURCE_READONLY');
 return sql;
}
const targets={
 'api-schema':{db:DBS[0],probe:PROBES[0],kind:'schema-projection',schema:'public',tables:API_TABLES,keys:['scope']},
 'agent-schema':{db:DBS[1],probe:PROBES[0],kind:'schema-projection',schema:'public',tables:AGENT_TABLES,keys:['scope']},
 'memory-schema':{db:DBS[2],probe:PROBES[0],kind:'schema-projection',schema:'workspacex_memory',tables:MEMORY_TABLES,keys:['scope']},
 'api-permissions':{db:DBS[0],probe:PROBES[1],kind:'role-permission-projection',keys:['role']},
 'agent-permissions':{db:DBS[1],probe:PROBES[1],kind:'role-permission-projection',keys:['role']},
 'memory-permissions':{db:DBS[2],probe:PROBES[1],kind:'role-permission-projection',keys:['role']},
 'api-system-agent':{db:DBS[0],probe:PROBES[2],kind:'system-agent-seed',keys:['orgId','stableName','provider']},
 'agent-init-schema':{db:DBS[1],probe:PROBES[2],kind:'initialization-schema-projection',schema:'public',tables:AGENT_TABLES,keys:['scope']},
 'memory-init-schema':{db:DBS[2],probe:PROBES[2],kind:'initialization-schema-projection',schema:'workspacex_memory',tables:MEMORY_TABLES,keys:['scope']},
};
for(const spec of Object.values(targets)){Object.freeze(spec.keys);if(spec.tables)Object.freeze(spec.tables);Object.freeze(spec);}Object.freeze(targets);
async function readHeldCandidate(control,queryId,params,context){
 need(control?.client&&typeof control.client.query==='function'&&typeof control.identity==='function'&&control.mode==='diagnostic'&&control.transactionStatus==='I','HELD_EXISTING_DIAGNOSTIC_REQUIRED');
 need(PROBES.includes(queryId),'HELD_QUERY_ID');exact(params,['expectedReadbackSha256'],'HELD_QUERY_PARAMETERS');
 exact(context?.binding,BIND,'HELD_SOURCE_BINDING');
 need(same(control.identityBinding,context.identity)&&control.toolRevision===context.binding.toolRevision,'HELD_SOURCE_TOOL_IDENTITY');
 const ref=context?.expectedReadbackRef;exact(ref,['path','sha256'],'HELD_EXPECTED_REF');
 need(hash(ref.sha256)&&params.expectedReadbackSha256===ref.sha256&&context.identity?.sourceRevision===APP&&
  ref.path===`/etc/workspacex-cn/maintenance-readback/${APP}/${context.identity.attemptId}/expected.json`&&
  typeof context.readPrivate==='function'&&typeof context.verifyQualifiedExpected==='function','HELD_EXPECTED_AUTHORITY');
 const read=async()=>{const bytes=await context.readPrivate(ref);need(Buffer.isBuffer(bytes)&&crypto.createHash('sha256').update(bytes).digest('hex')===ref.sha256,'HELD_EXPECTED_RAW_HASH');return bytes;};
 const raw=await read(),expected=JSON.parse(raw.toString('utf8'));
 exact(expected,[...BIND,'kind','qualificationEvidenceSha256','targets'],'HELD_EXPECTED_SCHEMA');
 need(expected.kind==='source-derived-held-candidate-readback'&&same(expected.identity,context.identity)&&
  BIND.every(k=>same(expected[k],context.binding?.[k]))&&hash(expected.qualificationEvidenceSha256)&&
  await context.verifyQualifiedExpected(ref,expected)===true,'HELD_EXPECTED_QUALIFICATION');
 exact(expected.targets,DBS,'HELD_EXPECTED_DATABASES');
 const connection=context.connection,db=connection?.peer?.database;
 need(DBS.includes(db)&&same(control.binding,connection),'HELD_EXPECTED_CONNECTION');
 const selected=[];
 for(const database of DBS){
  const rows=expected.targets[database];need(Array.isArray(rows)&&rows.length>0,'HELD_EXPECTED_TARGETS');const seen=new Set();
  for(const target of rows){
   exact(target,['targetId','keyValues','expectedCount','expectedDigest'],'HELD_TARGET_SCHEMA');const spec=targets[target.targetId];
   need(spec&&spec.db===database,'HELD_TARGET_SOURCE_CLOSED');exact(target.keyValues,spec.keys,'HELD_TARGET_KEY_VALUES');
   need(Object.values(target.keyValues).every(v=>typeof v==='string'&&v.length>0&&v.length<=1024&&!/[\r\n\0]/.test(v))&&
    Number.isSafeInteger(target.expectedCount)&&target.expectedCount>=0&&hash(target.expectedDigest),'HELD_TARGET_EXPECTATION');
   if(spec.keys.includes('scope'))need(target.keyValues.scope===spec.schema,'HELD_TARGET_FIXED_SCOPE');
   const key=target.targetId+':'+canonical(target.keyValues);need(!seen.has(key),'HELD_TARGET_DUPLICATE');seen.add(key);
   if(database===db&&spec.probe===queryId)selected.push({target,spec});
  }
 }
 need(selected.length>0,'HELD_TARGET_PROBE_EMPTY');
 // Qualifier owns source-template/provider closure; direct caller values cannot replace it.
 const client=control.client;const observe=async()=>need(same(await control.identity(),connection),'HELD_CONNECTION_CHANGED');
 await observe();let began=false,failed;const observations=[];
 try{
  began=true;await client.query('BEGIN TRANSACTION READ ONLY');
  const ro=await client.query('SHOW transaction_read_only');need(ro.rows?.length===1&&ro.rows[0].transaction_read_only==='on','HELD_TRANSACTION_NOT_READONLY');
  await client.query("SET LOCAL statement_timeout = '5000ms'");
  for(const {target,spec} of selected){
   let facts;
   if(spec.kind==='role-permission-projection'){
    const r=await client.query(sourceRoleSelect());need(r.rows?.length===1,'HELD_ROLE_PROJECTION');const full=Object.values(r.rows[0])[0];
    const role=full.roles?.find(r=>r.name===target.keyValues.role);need(role&&full.diagnosticPrivileges,'HELD_ROLE_PROJECTION');
    facts=[{kind:spec.kind,role,diagnosticPrivileges:full.diagnosticPrivileges}];
   }else if(spec.kind==='system-agent-seed'){
    facts=(await client.query(AGENT_SEED_SQL,[target.keyValues.orgId,target.keyValues.stableName])).rows;
    need(Array.isArray(facts)&&facts.length===1,'HELD_SYSTEM_AGENT_ABSENT_OR_ALIAS');const a=facts[0];
    need(a.org_id===target.keyValues.orgId&&a.stable_name===target.keyValues.stableName&&a.agent_id===a.id&&a.version_org===a.org_id&&
     a.model_provider===target.keyValues.provider&&a.published_at&&a.listing_id===a.id&&a.listing_org===a.org_id&&a.listing_kind==='agent',
     'HELD_SYSTEM_AGENT_SEED_IDENTITY');
   }else{
    const rows=(await client.query(CATALOG_SQL,[spec.schema,spec.tables])).rows;need(Array.isArray(rows)&&rows.length>0&&rows.length<=10000,'HELD_CATALOG_COMPLETENESS');
    const relations=rows.filter(r=>r.kind==='relation').map(r=>r.fact?.table);
    need(relations.length===spec.tables.length&&same([...relations].sort(),[...spec.tables].sort()),'HELD_FIXED_TABLE_CLOSURE');
    if(spec.kind==='initialization-schema-projection'){
     const extensions=(await client.query(EXTENSION_SQL)).rows;need(Array.isArray(extensions)&&extensions.length>0&&extensions.length<=10000,'HELD_EXTENSION_COMPLETENESS');
     facts=[{kind:spec.kind,catalog:rows,extensions}];
    }else facts=rows;
   }
   need(Array.isArray(facts)&&facts.length===target.expectedCount&&digest(facts)===target.expectedDigest,'HELD_TARGET_COUNT_OR_DIGEST');
   observations.push({targetId:target.targetId,kind:spec.kind,count:facts.length,digest:digest(facts)});
  }
  await observe();need((await read()).equals(raw),'HELD_EXPECTED_REF_DRIFT');
 }catch(error){failed=error;}finally{
  if(began){try{await client.query('ROLLBACK');need(control.transactionStatus==='I','HELD_ROLLBACK_STATE');await observe();}catch{failed=Error('HELD_ROLLBACK_UNPROVEN');}}
 }
 if(failed)throw failed;
 need((await read()).equals(raw),'HELD_EXPECTED_REF_DRIFT');
 return {identity:context.identity,connection,probe:queryId,readOnlyTransaction:true,rollbackComplete:true,verified:true,
  evidenceSha256:digest({expectedReadbackSha256:ref.sha256,queryId,connection,observations})};
}
module.exports={readHeldCandidate,digest,CATALOG_SQL,EXTENSION_SQL,AGENT_SEED_SQL,targets,sourceRoleSelect};
