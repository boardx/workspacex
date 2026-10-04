'use strict';
// Caller must attest a root-protected envelope from canonical baseline migrations replayed
// in an isolated schema-only database. Hashes detect drift; they do not authorize evidence.
const {createHash}=require('node:crypto');
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=code=>{throw Error(code);};
const queries={
 columns:`SELECT c.relname AS table_name,a.attname AS column_name,pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_expression FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname COLLATE "C",a.attname COLLATE "C"`,
 constraints:`SELECT c.relname AS table_name,k.conname AS name,k.contype AS type,k.convalidated AS validated,pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname COLLATE "C",k.conname COLLATE "C"`,
 privileges:`SELECT c.relname AS table_name,a.attname AS column_name,r.rolname AS role,p.privilege,has_column_privilege(r.oid,c.oid,a.attnum,p.privilege) AS allowed FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid CROSS JOIN pg_roles r CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege) WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped AND r.rolname IN ('app_rw','app_diag_ro') ORDER BY c.relname COLLATE "C",a.attname COLLATE "C",r.rolname COLLATE "C",p.privilege COLLATE "C"`,
 tablePrivileges:`SELECT c.relname AS table_name,r.rolname AS role,p.privilege,has_table_privilege(r.oid,c.oid,p.privilege) AS allowed FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege) WHERE n.nspname='public' AND c.relkind IN ('r','p') AND r.rolname IN ('app_rw','app_diag_ro') ORDER BY c.relname COLLATE "C",r.rolname COLLATE "C",p.privilege COLLATE "C"`,
 sequencePrivileges:`SELECT c.relname AS sequence_name,r.rolname AS role,p.privilege,has_sequence_privilege(r.oid,c.oid,p.privilege) AS allowed FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r CROSS JOIN (VALUES ('USAGE'),('SELECT'),('UPDATE')) p(privilege) WHERE n.nspname='public' AND c.relkind='S' AND r.rolname IN ('app_rw','app_diag_ro') ORDER BY c.relname COLLATE "C",r.rolname COLLATE "C",p.privilege COLLATE "C"`,
 schemaPrivileges:`SELECT n.nspname AS schema_name,r.rolname AS role,p.privilege,has_schema_privilege(r.oid,n.oid,p.privilege) AS allowed FROM pg_namespace n CROSS JOIN pg_roles r CROSS JOIN (VALUES ('USAGE'),('CREATE')) p(privilege) WHERE n.nspname='public' AND r.rolname IN ('app_rw','app_diag_ro') ORDER BY n.nspname COLLATE "C",r.rolname COLLATE "C",p.privilege COLLATE "C"`,
 functionPrivileges:`SELECT p.proname AS function_name,pg_get_function_identity_arguments(p.oid) AS identity_arguments,r.rolname AS role,has_function_privilege(r.oid,p.oid,'EXECUTE') AS allowed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN pg_roles r WHERE n.nspname='public' AND r.rolname IN ('app_rw','app_diag_ro') ORDER BY p.proname COLLATE "C",pg_get_function_identity_arguments(p.oid) COLLATE "C",r.rolname COLLATE "C"`,
 roles:`SELECT rolname,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname IN ('app_rw','app_diag_ro') ORDER BY rolname COLLATE "C"`
};
function validateIdentity(identity){
 if(!identity||!/^[a-f0-9]{40}$/.test(identity.baselineSha||'')||!/^[a-f0-9]{64}$/.test(identity.sourceInventorySha256||''))fail('BASELINE_SCHEMA_IDENTITY_INVALID');
}
async function read(client,inTransaction=false){
 let began=false;
 try{
  if(!inTransaction){await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');began=true;}
  if((await client.query('SHOW transaction_read_only')).rows[0]?.transaction_read_only!=='on')fail('BASELINE_SCHEMA_READ_ONLY_REQUIRED');
  await client.query("SET LOCAL statement_timeout = '5000ms'");
  const catalog={};
  for(const [kind,sql] of Object.entries(queries))catalog[kind]=(await client.query(sql)).rows;
  if(!catalog.columns.length||catalog.roles.length!==2||catalog.roles.some(r=>r.rolsuper||r.rolbypassrls||r.rolcreatedb||r.rolcreaterole))fail('BASELINE_SCHEMA_CATALOG_INCOMPLETE');
  return catalog;
 }finally{if(began)await client.query('ROLLBACK');}
}
async function capture(client,identity){
 validateIdentity(identity);
 const catalog=await read(client);
 return {schemaVersion:1,scope:'schema-only-isolated-baseline',baselineSha:identity.baselineSha,sourceInventorySha256:identity.sourceInventorySha256,catalog,schemaSha256:digest(catalog)};
}
async function compare(client,envelope,identity,inTransaction=false){
 validateIdentity(identity);
 if(!envelope||Object.keys(envelope).sort().join(',')!=='baselineSha,catalog,schemaSha256,schemaVersion,scope,sourceInventorySha256'||envelope.schemaVersion!==1||envelope.scope!=='schema-only-isolated-baseline'||envelope.baselineSha!==identity.baselineSha||envelope.sourceInventorySha256!==identity.sourceInventorySha256||!envelope.catalog||Object.keys(envelope.catalog).sort().join(',')!==Object.keys(queries).sort().join(',')||envelope.schemaSha256!==digest(envelope.catalog))fail('BASELINE_SCHEMA_EVIDENCE_INVALID');
 const actual=await read(client,inTransaction);
 // Candidate additions may coexist: baseline members must remain exactly intact.
 const keys={columns:r=>[r.table_name,r.column_name],constraints:r=>[r.table_name,r.name],privileges:r=>[r.table_name,r.column_name,r.role,r.privilege],roles:r=>[r.rolname],tablePrivileges:r=>[r.table_name,r.role,r.privilege],sequencePrivileges:r=>[r.sequence_name,r.role,r.privilege],schemaPrivileges:r=>[r.schema_name,r.role,r.privilege],functionPrivileges:r=>[r.function_name,r.identity_arguments,r.role]};
 for(const kind of Object.keys(keys)){
  if(!Array.isArray(envelope.catalog[kind])||(['columns','constraints','privileges','roles','schemaPrivileges','tablePrivileges'].includes(kind)&&!envelope.catalog[kind].length))fail('BASELINE_SCHEMA_EVIDENCE_INVALID');
  const map=new Map(actual[kind].map(row=>[JSON.stringify(keys[kind](row)),row]));
  const seen=new Set();
  for(const row of envelope.catalog[kind]){
   const key=JSON.stringify(keys[kind](row));
   if(seen.has(key))fail('BASELINE_SCHEMA_EVIDENCE_INVALID');seen.add(key);
   if(!map.has(key)||digest(map.get(key))!==digest(row))fail('BASELINE_SCHEMA_'+kind.toUpperCase()+'_DRIFT');
  }
 }
 return {baselineSchemaContract:true,baselineSha:identity.baselineSha,sourceInventorySha256:identity.sourceInventorySha256,schemaSha256:envelope.schemaSha256,readOnlyTransaction:true,productionWriteStatements:0,candidateSchemaContract:false};
}
const compareInTransaction=(client,envelope,identity)=>compare(client,envelope,identity,true);
module.exports={capture,compare,compareInTransaction,queries};
