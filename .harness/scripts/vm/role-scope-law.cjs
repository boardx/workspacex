'use strict';
const must=(v,c)=>{if(!v)throw Error(c)};
const stable=v=>JSON.stringify(v);
const same=(a,b)=>stable(a.map(stable).sort())===stable(b.map(stable).sort());
const TABLES=['agent_versions','agent_runs','thread_message_queue'];
const LAWS={
 '20261001094500_official_role_pending_skill_bindings.sql':{kind:'official-role-pending-skill-bindings',relation:'public.agent_versions'},
 '20261001095000_agent_run_skill_scope.sql':{kind:'agent-run-skill-scope',relations:['public.agent_runs','public.thread_message_queue']}
};
const additions={agent_versions:{name:'pending_skill_bindings',type:'jsonb',notnull:true,default_expr:"'[]'::jsonb"},agent_runs:{name:'skill_scope',type:'text',notnull:false,default_expr:null},thread_message_queue:{name:'explicit_agent',type:'boolean',notnull:false,default_expr:null}};
const checks={agent_versions:{name:'agent_versions_pending_skill_bindings_array',expression:"(jsonb_typeof(pending_skill_bindings) = 'array'::text)"},agent_runs:{name:'agent_runs_skill_scope_check',expression:"((skill_scope IS NULL) OR (skill_scope = ANY (ARRAY['agent_pins'::text, 'general'::text])))"}};

// Exact pending catalog transforms observed by name/checksum against the historical
// restored ledger. This is a supported baseline shape, never a fresh-target proof.
const PRIOR_SQL={"20260926090000_i4227_agent_run_cited_sources.sql":"156d4cb526346c26cf84da1388766b7b97b7755f15551f592e994056b5139e85","20260928230000_ag01_agent_role_frozen_fields.sql":"8197fc60d1c6fc7ea0e2fe4ea8787042fa17c1d55a19c6eda73d617bd715354a","20260928240000_ag02_starter_pack_tool_policy_categories.sql":"95e110926e36bc674e6402ea095f73cbfae24c4613ab2f38d3a70abf4eedc4d0","20260929150000_dh_portrait_avatars.sql":"25679c6f642d8b46d34f56f7cbeef19d9c43eb79dd4cceec80a547c1b104d0fb","20260929160000_agent_tags.sql":"f91f4b3f742d7d355f1790b80c857cbac7fdc382287242fe55cf3d6ade6589e4","20260930121000_ag07_official_role_delegation.sql":"90f35ab028c04b8de9cf44f648dfc9a605732ee9a9ccf57f72948f86729801e7","20260930124000_ag06_official_escalation_rules.sql":"3b4a4425866565f5b983e782959f1fa7cdb12ab1dd89ee4640279f5d3852ddbc","20260930130000_agent_role_category_batch2.sql":"c473581a1f28ee189470b67239985d807534a17ff39448dfdb8d938c210f7b1f","20260930141000_rp_b2_official_role_pack_1_5_0.sql":"fc2be35f043862571556ebf835c19de70c11f89505ce9d550dd2c78f039a030c"};
const priorColumns={
 agent_versions:[
 {name:'avatar',type:'jsonb',notnull:false,default_expr:null},
 {name:'role_category',type:'text',notnull:false,default_expr:null},
 {name:'catalog_source',type:'text',notnull:true,default_expr:"'org'::text"},
 {name:'workflow_allowlist',type:'text[]',notnull:true,default_expr:"'{}'::text[]"},
 {name:'delegation_policy',type:'jsonb',notnull:true,default_expr:'\'{"maxDepth": 0, "allowedTargets": [], "requireApproval": true}\'::jsonb'},
 {name:'escalation_policy',type:'jsonb',notnull:true,default_expr:'\'{"rules": []}\'::jsonb'},
 {name:'kpi',type:'jsonb',notnull:true,default_expr:"'[]'::jsonb"},
 {name:'tags',type:'text[]',notnull:true,default_expr:"'{}'::text[]"}],
 agent_runs:[{name:'cited_sources',type:'jsonb',notnull:true,default_expr:"'[]'::jsonb"}],thread_message_queue:[]
};
const priorChecks=[
 {name:'agent_versions_role_category_check',columns:['role_category'],expression:"((role_category IS NULL) OR (role_category = ANY (ARRAY['research'::text, 'product'::text, 'sales'::text, 'design'::text, 'general'::text, 'executive'::text, 'customer_success'::text, 'operations'::text])))"},
 {name:'agent_versions_catalog_source_check',columns:['catalog_source'],expression:"(catalog_source = ANY (ARRAY['official'::text, 'org'::text]))"},
 {name:'agent_versions_role_fields_ok',columns:['avatar','workflow_allowlist','delegation_policy','escalation_policy','kpi'],expression:'agent_role_fields_ok(avatar, workflow_allowlist, delegation_policy, escalation_policy, kpi)'},
 {name:'agent_versions_tags_ok',columns:['tags'],expression:'((cardinality(tags) <= 10) AND (array_position(tags, NULL::text) IS NULL))'},
 {name:'agent_versions_tool_policy_check',columns:['tool_policy'],expression:'agent_tool_policy_ok(tool_policy)'}
];
const oldToolExpression="((jsonb_typeof(tool_policy) = 'array'::text) AND (jsonb_array_length(tool_policy) = 0))";
function checkDescriptor(check,columns){return {name:check.name,type:'c',validated:true,keys:check.columns.map(n=>{const c=columns.find(x=>x.name===n);must(c,'ROLE_SCOPE_PRIOR_CATALOG_REQUIRED');return c.num}).sort((a,b)=>a-b),deferrable:false,deferred:false,local:true,inherited:0,noinherit:false,expression:check.expression,definition:'CHECK ('+check.expression+')'};}

const queryFor=(table,kind)=>{
 must(TABLES.includes(table),'ROLE_SCOPE_TABLE_CLOSURE');
 const relation="'public."+table+"'::regclass";
 const sql={
 columns:`SELECT a.attnum num,a.attname name,format_type(a.atttypid,a.atttypmod) type,a.attnotnull notnull,pg_get_expr(d.adbin,d.adrelid) default_expr FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=${relation} AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,
 constraints:`SELECT conname name,contype type,convalidated validated,conkey keys,condeferrable AS "deferrable",condeferred AS "deferred",conislocal AS "local",coninhcount AS "inherited",connoinherit AS "noinherit",pg_get_expr(conbin,conrelid) expression,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid=${relation} ORDER BY conname`,
 policies:`SELECT polname name,polcmd cmd,polpermissive permissive,ARRAY(SELECT CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE role_oid::regrole::text END FROM unnest(polroles) role_oid ORDER BY role_oid) roles,pg_get_expr(polqual,polrelid) using_expr,pg_get_expr(polwithcheck,polrelid) check_expr FROM pg_policy WHERE polrelid=${relation} ORDER BY polname`,
 acl:`SELECT owner.rolname owner,c.relrowsecurity enabled,c.relforcerowsecurity forced,acl.grantee::regrole::text grantee,acl.grantor::regrole::text grantor,acl.privilege_type privilege,acl.is_grantable grantable FROM pg_class c JOIN pg_roles owner ON owner.oid=c.relowner CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE c.oid=${relation} ORDER BY acl.grantee,acl.grantor,acl.privilege_type`,
 maxnum:`SELECT max(attnum)::integer maxnum FROM pg_attribute WHERE attrelid=${relation} AND attnum>0`
 };must(Object.hasOwn(sql,kind),'ROLE_SCOPE_QUERY_KIND');return sql[kind];
};
async function readCatalog(client,table){const result={};for(const key of ['columns','constraints','policies','acl','maxnum'])result[key]=(await client.query(queryFor(table,key))).rows;return result;}
function validateBaseline(b){
 must(b&&Object.keys(b).sort().join(',')===TABLES.slice().sort().join(','),'ROLE_SCOPE_BASELINE_REQUIRED');
 for(const table of TABLES){const x=b[table];must(x?.columns?.length&&x?.acl?.length&&x.maxnum?.length===1&&Number.isInteger(x.maxnum[0].maxnum),'ROLE_SCOPE_BASELINE_REQUIRED');
 must(Array.isArray(x.legacyIds)&&x.legacyIds.length<=100000&&x.legacyIds.every(id=>typeof id==='string'&&id.length>0)&&new Set(x.legacyIds).size===x.legacyIds.length,'ROLE_SCOPE_COHORT_REQUIRED');
 must(!x.columns.some(c=>[additions[table].name,...priorColumns[table].map(y=>y.name)].includes(c.name)),'ROLE_SCOPE_PREEXISTING_COLUMN_REQUIRES_REVIEW');
 must(!checks[table]||!x.constraints.some(c=>c.name===checks[table].name),'ROLE_SCOPE_PREEXISTING_CHECK_REQUIRES_REVIEW');
 if(table==='agent_versions'){const old=x.constraints.filter(c=>c.name==='agent_versions_tool_policy_check');must(old.length===1&&same(old,[checkDescriptor({name:'agent_versions_tool_policy_check',columns:['tool_policy'],expression:oldToolExpression},x.columns)]),'ROLE_SCOPE_PRIOR_CATALOG_REQUIRED');must(!x.constraints.some(c=>priorChecks.slice(0,-1).some(y=>y.name===c.name)),'ROLE_SCOPE_PRIOR_CATALOG_REQUIRED');}}
}
async function captureRoleScopeBaseline(client,readRetainedIds){
 must(typeof readRetainedIds==='function','ROLE_SCOPE_COHORT_REQUIRED');const baseline={};
 for(const table of TABLES){const x=await readCatalog(client,table);const ids=await readRetainedIds(table);must(Array.isArray(ids),'ROLE_SCOPE_COHORT_REQUIRED');x.legacyIds=ids.map(row=>row.id);baseline[table]=x;}
 validateBaseline(baseline);return baseline;
}
function validateLaws(laws){for(const[name,expected]of Object.entries(LAWS)){const law=laws?.[name];must(law?.kind===expected.kind&&stable(law.relation||law.relations)===stable(expected.relation||expected.relations),'ROLE_SCOPE_LAW_REQUIRED');must(stable(law.priorCatalogSqlChecksums)===stable(PRIOR_SQL),'ROLE_SCOPE_PRIOR_LAW_REQUIRED');}}
async function validateRoleScope(client,laws,baseline){
 validateLaws(laws);validateBaseline(baseline);const proofs={};
 for(const table of TABLES){const before=baseline[table],after=await readCatalog(client,table);const additionsOrdered=[...priorColumns[table],additions[table]].map((c,i)=>({num:before.maxnum[0].maxnum+i+1,...c}));const added=additionsOrdered.at(-1);
 must(stable(after.columns)===stable([...before.columns,...additionsOrdered])&&after.maxnum.length===1&&after.maxnum[0].maxnum===added.num,'ROLE_SCOPE_COLUMN_DELTA');
 const expected=checks[table];const actual=expected?after.constraints.filter(c=>c.name===expected.name):[];
 if(expected){must(actual.length===1,'ROLE_SCOPE_CHECK_DELTA');const c=actual[0];must(c.type==='c'&&c.validated===true&&stable(c.keys)===stable([added.num])&&c.deferrable===false&&c.deferred===false&&c.local===true&&c.inherited===0&&c.noinherit===false&&c.expression===expected.expression&&c.definition==='CHECK ('+expected.expression+')','ROLE_SCOPE_CHECK_DELTA');}
 const priorExpected=table==='agent_versions'?priorChecks.map(c=>checkDescriptor(c,after.columns)):[];
 const priorNames=new Set(priorExpected.map(c=>c.name));must(same(after.constraints.filter(c=>priorNames.has(c.name)),priorExpected),'ROLE_SCOPE_PRIOR_CATALOG_REQUIRED');
 must(same(after.constraints.filter(c=>(!expected||c.name!==expected.name)&&!priorNames.has(c.name)),before.constraints.filter(c=>!priorNames.has(c.name))),'ROLE_SCOPE_OLD_CONSTRAINT_DRIFT');
 must(same(after.policies,before.policies)&&same(after.acl,before.acl),'ROLE_SCOPE_SECURITY_DRIFT');
 const invalid=table==='agent_versions'?"pending_skill_bindings IS DISTINCT FROM '[]'::jsonb OR avatar IS NOT NULL OR role_category IS NOT NULL OR catalog_source IS DISTINCT FROM 'org'::text OR workflow_allowlist IS DISTINCT FROM '{}'::text[] OR delegation_policy IS DISTINCT FROM '{\"allowedTargets\":[],\"maxDepth\":0,\"requireApproval\":true}'::jsonb OR escalation_policy IS DISTINCT FROM '{\"rules\":[]}'::jsonb OR kpi IS DISTINCT FROM '[]'::jsonb OR tags IS DISTINCT FROM '{}'::text[]":table==='agent_runs'?"skill_scope IS NOT NULL OR cited_sources IS DISTINCT FROM '[]'::jsonb":'explicit_agent IS NOT NULL';
 const sql=`SELECT count(*)::text total,count(*) FILTER (WHERE ${invalid})::text changed FROM ONLY public."${table}" WHERE id::text=ANY($1::text[])`;
 const rows=(await client.query(sql,[before.legacyIds])).rows;
 must(rows.length===1&&rows[0].total===String(before.legacyIds.length)&&rows[0].changed==='0','ROLE_SCOPE_LEGACY_VALUES_DRIFT');
 proofs[table]={catalogVerified:true,retainedLegacyRows:before.legacyIds.length,legacyValuesVerified:true};
 }
 return {catalogLawVerified:true,originalColumnMultisetStillRequired:true,liveRuntimeJourneysVerified:false,tables:proofs};
}
const SAFE_CODES=['ROLE_SCOPE_TABLE_CLOSURE','ROLE_SCOPE_QUERY_KIND','ROLE_SCOPE_BASELINE_REQUIRED','ROLE_SCOPE_COHORT_REQUIRED','ROLE_SCOPE_PREEXISTING_COLUMN_REQUIRES_REVIEW','ROLE_SCOPE_PREEXISTING_CHECK_REQUIRES_REVIEW','ROLE_SCOPE_LAW_REQUIRED','ROLE_SCOPE_COLUMN_DELTA','ROLE_SCOPE_CHECK_DELTA','ROLE_SCOPE_OLD_CONSTRAINT_DRIFT','ROLE_SCOPE_SECURITY_DRIFT','ROLE_SCOPE_LEGACY_VALUES_DRIFT','ROLE_SCOPE_PRIOR_CATALOG_REQUIRED','ROLE_SCOPE_PRIOR_LAW_REQUIRED'];
module.exports={TABLES,LAWS,PRIOR_SQL,queryFor,captureRoleScopeBaseline,validateRoleScope,SAFE_CODES};
