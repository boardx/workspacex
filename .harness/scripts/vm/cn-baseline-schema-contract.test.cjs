'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {capture,compare,compareInTransaction,queries}=require('./cn-baseline-schema-contract.cjs');
const identity={baselineSha:'b'.repeat(40),sourceInventorySha256:'a'.repeat(64)};
const catalog={columns:[{table_name:'agents',column_name:'id',type:'text',not_null:true,default_expression:null}],constraints:[{table_name:'agents',name:'agents_pkey',type:'p',validated:true,definition:'PRIMARY KEY (id)'}],privileges:[{table_name:'agents',column_name:'id',role:'app_rw',privilege:'SELECT',allowed:true}],roles:['app_diag_ro','app_rw'].map(rolname=>({rolname,rolsuper:false,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false}))};
Object.assign(catalog,{tablePrivileges:[{table_name:'agents',role:'app_rw',privilege:'DELETE',allowed:true}],sequencePrivileges:[{sequence_name:'agents_seq',role:'app_rw',privilege:'USAGE',allowed:true}],schemaPrivileges:[{schema_name:'public',role:'app_rw',privilege:'USAGE',allowed:true}],functionPrivileges:[]});
function fake(data=catalog,readonly='on'){
 const calls=[];return {calls,async query(sql){calls.push(sql);if(sql==='SHOW transaction_read_only')return {rows:[{transaction_read_only:readonly}]};const kind=Object.keys(queries).find(k=>queries[k]===sql);return {rows:kind?structuredClone(data[kind]):[]};}};
}
test('capture binds exact baseline/inventory and rolls back read-only transaction',async()=>{const c=fake();const e=await capture(c,identity);assert.equal(e.scope,'schema-only-isolated-baseline');assert.equal(e.baselineSha,identity.baselineSha);assert.equal(c.calls.at(-1),'ROLLBACK');assert.match(c.calls[0],/READ ONLY/);assert.equal((await compare(fake(),e,identity)).candidateSchemaContract,false);});
for(const [name,mutate,code] of [
 ['missing column',x=>x.columns=[],/COLUMNS_DRIFT|CATALOG_INCOMPLETE/],
 ['type changed',x=>x.columns[0].type='integer',/COLUMNS_DRIFT/],
 ['nullability changed',x=>x.columns[0].not_null=false,/COLUMNS_DRIFT/],
 ['default changed',x=>x.columns[0].default_expression="'x'::text",/COLUMNS_DRIFT/],
 ['constraint missing',x=>x.constraints=[],/CONSTRAINTS_DRIFT/],
 ['constraint changed',x=>x.constraints[0].definition='UNIQUE (id)',/CONSTRAINTS_DRIFT/],
 ['grant revoked',x=>x.privileges[0].allowed=false,/PRIVILEGES_DRIFT/],
 ['role unsafe',x=>x.roles[0].rolbypassrls=true,/CATALOG_INCOMPLETE/]
])test('unchanged migration identity rejects '+name,async()=>{const e=await capture(fake(),identity);const x=structuredClone(catalog);mutate(x);const c=fake(x);await assert.rejects(compare(c,e,identity),code);assert.equal(c.calls.at(-1),'ROLLBACK');});
test('candidate extra column is allowed only as baseline comparison',async()=>{const e=await capture(fake(),identity),x=structuredClone(catalog);x.columns.push({...x.columns[0],column_name:'candidate_new'});assert.equal((await compare(fake(x),e,identity)).candidateSchemaContract,false);});
test('reject evidence tampering and wrong source identity before querying',async()=>{const e=await capture(fake(),identity);e.catalog.columns[0].type='integer';const c=fake();await assert.rejects(compare(c,e,identity),/EVIDENCE_INVALID/);assert.equal(c.calls.length,0);await assert.rejects(compare(c,await capture(fake(),identity),{...identity,baselineSha:'c'.repeat(40)}),/EVIDENCE_INVALID/);});
test('reject writable transaction and roll back',async()=>{const c=fake(catalog,'off');await assert.rejects(capture(c,identity),/READ_ONLY_REQUIRED/);assert.equal(c.calls.at(-1),'ROLLBACK');});

test("in-transaction consumer asserts readonly without nested BEGIN or ROLLBACK",async()=>{const e=await capture(fake(),identity),c=fake();await compareInTransaction(c,e,identity);assert.equal(c.calls[0],"SHOW transaction_read_only");assert.ok(!c.calls.some(sql=>/^(BEGIN|ROLLBACK)/.test(sql)));});
test('in-transaction consumer rejects writable transaction without taking ownership',async()=>{const e=await capture(fake(),identity),c=fake(catalog,'off');await assert.rejects(compareInTransaction(c,e,identity),/READ_ONLY_REQUIRED/);assert.ok(!c.calls.some(sql=>/^(BEGIN|ROLLBACK)/.test(sql)));});

for(const [kind,label] of [['tablePrivileges','DELETE'],['sequencePrivileges','sequence USAGE'],['schemaPrivileges','schema USAGE']])test('reject revoked '+label,async()=>{const e=await capture(fake(),identity),x=structuredClone(catalog);x[kind][0].allowed=false;await assert.rejects(compare(fake(x),e,identity),/DRIFT/);});
test('function overload EXECUTE grant is preserved',async()=>{const x=structuredClone(catalog);x.functionPrivileges=[{function_name:'f',identity_arguments:'x text',role:'app_rw',allowed:true}];const e=await capture(fake(x),identity);x.functionPrivileges[0].identity_arguments='x integer';await assert.rejects(compare(fake(x),e,identity),/FUNCTIONPRIVILEGES_DRIFT/);});
