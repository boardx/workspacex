'use strict';
const crypto=require('node:crypto');const must=(x,c)=>{if(!x)throw Error(c)};
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
async function validateCanvasAudit(client,law){
 must(law?.kind==='canvas-template-audit','CANVAS_LAW_REQUIRED');
 const facts=(await client.query(`SELECT c.relrowsecurity enabled,c.relforcerowsecurity forced,(SELECT count(*)::int FROM public.canvas_template_audit) rows,(SELECT array_agg(privilege_type ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='canvas_template_audit' AND grantee='app_rw') privileges FROM pg_class c WHERE c.oid=to_regclass('public.canvas_template_audit')`)).rows;
 must(facts.length===1&&facts[0].enabled&&facts[0].forced&&facts[0].rows===0&&JSON.stringify(facts[0].privileges)===JSON.stringify(law.appRwPrivileges),'CANVAS_TABLE_RLS_ACL_ROWS');
 const cols=(await client.query("SELECT a.attname name,format_type(a.atttypid,a.atttypmod) type,a.attnotnull notnull,pg_get_expr(d.adbin,d.adrelid) default_expr FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.canvas_template_audit'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum")).rows;
 must(JSON.stringify(cols.map(c=>c.name))===JSON.stringify(law.requiredColumns),'CANVAS_COLUMN_CLOSURE');
 for(const[name,expected]of Object.entries(law.functions)){
  const rows=(await client.query("SELECT prosrc,prosecdef,proconfig,NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(proacl,acldefault('f',proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') no_public_execute FROM pg_proc WHERE oid=to_regprocedure($1)",['public.'+name+'()'])).rows;
  must(rows.length===1&&hash(rows[0].prosrc)===expected.prosrcSha256&&JSON.stringify(rows[0].proconfig)===JSON.stringify(['search_path=public, pg_temp']),'CANVAS_FUNCTION_BODY_CONFIG');
  must(rows[0].prosecdef===(name==='record_canvas_template_audit'),'CANVAS_FUNCTION_SECURITY');
  if(name==='record_canvas_template_audit')must(rows[0].no_public_execute,'CANVAS_PUBLIC_EXECUTE');
 }
 for(const[name,e]of Object.entries(law.triggers)){
  const rows=(await client.query("SELECT tgtype,tgenabled,tgfoid=to_regprocedure($3) correct_function FROM pg_trigger WHERE tgrelid=to_regclass($1) AND tgname=$2 AND NOT tgisinternal",['public.'+e.table,name,'public.'+e.function+'()'])).rows;
  must(rows.length===1&&rows[0].tgtype===e.tgtype&&rows[0].tgenabled==='O'&&rows[0].correct_function,'CANVAS_TRIGGER_BINDING');
 }
 const expectedTypes=['bigint','text','text','integer','text','text','text','text','text','timestamp with time zone','text[]'];const nullable=new Set(['from_status','actor_id']);
 must(cols.every((c,i)=>c.type===expectedTypes[i]&&c.notnull===!nullable.has(c.name)&&(c.name==='occurred_at'?c.default_expr==='clock_timestamp()':c.default_expr===null)),'CANVAS_COLUMN_TYPE_NULL_DEFAULT');
 const constraints=(await client.query("SELECT contype,convalidated,confdeltype,confrelid=to_regclass('public.organizations') organization_fk,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='public.canvas_template_audit'::regclass ORDER BY contype,conname")).rows;
 must(constraints.length===4&&constraints.every(c=>c.convalidated)&&constraints.filter(c=>c.contype==='p').length===1&&constraints.filter(c=>c.contype==='f'&&c.confdeltype==='c'&&c.organization_fk).length===1&&constraints.filter(c=>c.contype==='c').length===2,'CANVAS_CONSTRAINT_INVENTORY');
 const compact=x=>x.replace(/::text(?:\[\])?/g,'').replace(/[\s()]/g,'');
 const defs=constraints.map(c=>compact(c.definition));
 must(defs.includes("CHECKactor_source=ANYARRAY['principal','host']")&&defs.includes("CHECKactor_source='principal'=actor_idISNOTNULL")&&defs.includes('PRIMARYKEYid')&&defs.includes('FOREIGNKEYorg_idREFERENCESorganizationsidONDELETECASCADE'),'CANVAS_CHECK_FK_PK_LAWS');
 const identity=(await client.query("SELECT attidentity FROM pg_attribute WHERE attrelid='public.canvas_template_audit'::regclass AND attname='id' AND NOT attisdropped")).rows;
 must(identity.length===1&&identity[0].attidentity==='a','CANVAS_IDENTITY_ALWAYS');
 const policies=(await client.query("SELECT polname,polcmd,polpermissive,polroles=ARRAY[0::oid] public_roles,pg_get_expr(polqual,polrelid) using_expr,pg_get_expr(polwithcheck,polrelid) check_expr FROM pg_policy WHERE polrelid='public.canvas_template_audit'::regclass")).rows;
 const normalize=x=>x.replace(/::text/g,'').replace(/[\s()]/g,'');
 must(policies.length===1&&policies[0].polname===law.rls.policy&&policies[0].polcmd==='*'&&policies[0].polpermissive&&policies[0].public_roles&&normalize(policies[0].using_expr)===normalize(law.rls.using)&&normalize(policies[0].check_expr)===normalize(law.rls.withCheck),'CANVAS_POLICY_IDENTITY');
 const indexes=(await client.query("SELECT i.indisvalid,i.indisready,i.indisunique,i.indpred IS NULL no_predicate,i.indexprs IS NULL no_expression,array_agg(a.attname ORDER BY keys.ordinality) columns FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY keys(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=keys.attnum WHERE i.indrelid='public.canvas_template_audit'::regclass AND c.relname=$1 GROUP BY i.indisvalid,i.indisready,i.indisunique,i.indpred,i.indexprs",[law.index.name])).rows;
 must(indexes.length===1&&indexes[0].indisvalid&&indexes[0].indisready&&!indexes[0].indisunique&&indexes[0].no_predicate&&indexes[0].no_expression&&JSON.stringify(indexes[0].columns)===JSON.stringify(law.index.columns),'CANVAS_INDEX_IDENTITY');
 return {tableRlsAclRowsVerified:true,functionBodiesVerified:true,triggersVerified:true,constraintsVerified:true,indexVerified:true,policyIdentityVerified:true,completeLawVerified:true};
}
module.exports={validateCanvasAudit};
