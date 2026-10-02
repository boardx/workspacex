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
 must(!x.columns.some(c=>c.name===additions[table].name),'ROLE_SCOPE_PREEXISTING_COLUMN_REQUIRES_REVIEW');
 must(!checks[table]||!x.constraints.some(c=>c.name===checks[table].name),'ROLE_SCOPE_PREEXISTING_CHECK_REQUIRES_REVIEW');}
}
async function captureRoleScopeBaseline(client,readRetainedIds){
 must(typeof readRetainedIds==='function','ROLE_SCOPE_COHORT_REQUIRED');const baseline={};
 for(const table of TABLES){const x=await readCatalog(client,table);const ids=await readRetainedIds(table);must(Array.isArray(ids),'ROLE_SCOPE_COHORT_REQUIRED');x.legacyIds=ids.map(row=>row.id);baseline[table]=x;}
 validateBaseline(baseline);return baseline;
}
function validateLaws(laws){for(const[name,expected]of Object.entries(LAWS)){const law=laws?.[name];must(law?.kind===expected.kind&&stable(law.relation||law.relations)===stable(expected.relation||expected.relations),'ROLE_SCOPE_LAW_REQUIRED');}}
async function validateRoleScope(client,laws,baseline){
 validateLaws(laws);validateBaseline(baseline);const proofs={};
 for(const table of TABLES){const before=baseline[table],after=await readCatalog(client,table);const added={num:before.maxnum[0].maxnum+1,...additions[table]};
 must(stable(after.columns)===stable([...before.columns,added])&&after.maxnum.length===1&&after.maxnum[0].maxnum===added.num,'ROLE_SCOPE_COLUMN_DELTA');
 const expected=checks[table];const actual=expected?after.constraints.filter(c=>c.name===expected.name):[];
 if(expected){must(actual.length===1,'ROLE_SCOPE_CHECK_DELTA');const c=actual[0];must(c.type==='c'&&c.validated===true&&stable(c.keys)===stable([added.num])&&c.deferrable===false&&c.deferred===false&&c.local===true&&c.inherited===0&&c.noinherit===false&&c.expression===expected.expression&&c.definition==='CHECK ('+expected.expression+')','ROLE_SCOPE_CHECK_DELTA');}
 must(same(after.constraints.filter(c=>!expected||c.name!==expected.name),before.constraints),'ROLE_SCOPE_OLD_CONSTRAINT_DRIFT');
 must(same(after.policies,before.policies)&&same(after.acl,before.acl),'ROLE_SCOPE_SECURITY_DRIFT');
 const invalid=table==='agent_versions'?"pending_skill_bindings IS DISTINCT FROM '[]'::jsonb":additions[table].name+' IS NOT NULL';
 const sql=`SELECT count(*)::text total,count(*) FILTER (WHERE ${invalid})::text changed FROM ONLY public."${table}" WHERE id::text=ANY($1::text[])`;
 const rows=(await client.query(sql,[before.legacyIds])).rows;
 must(rows.length===1&&rows[0].total===String(before.legacyIds.length)&&rows[0].changed==='0','ROLE_SCOPE_LEGACY_VALUES_DRIFT');
 proofs[table]={catalogVerified:true,retainedLegacyRows:before.legacyIds.length,legacyValuesVerified:true};
 }
 return {catalogLawVerified:true,originalColumnMultisetStillRequired:true,liveRuntimeJourneysVerified:false,tables:proofs};
}
const SAFE_CODES=['ROLE_SCOPE_TABLE_CLOSURE','ROLE_SCOPE_QUERY_KIND','ROLE_SCOPE_BASELINE_REQUIRED','ROLE_SCOPE_COHORT_REQUIRED','ROLE_SCOPE_PREEXISTING_COLUMN_REQUIRES_REVIEW','ROLE_SCOPE_PREEXISTING_CHECK_REQUIRES_REVIEW','ROLE_SCOPE_LAW_REQUIRED','ROLE_SCOPE_COLUMN_DELTA','ROLE_SCOPE_CHECK_DELTA','ROLE_SCOPE_OLD_CONSTRAINT_DRIFT','ROLE_SCOPE_SECURITY_DRIFT','ROLE_SCOPE_LEGACY_VALUES_DRIFT'];
module.exports={TABLES,LAWS,queryFor,captureRoleScopeBaseline,validateRoleScope,SAFE_CODES};
