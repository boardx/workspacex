import test from'node:test';
import assert from'node:assert/strict';
import {createRequire}from'node:module';
import {readFixtureCatalog,assertCatalogEquivalent}from'./catalog';
const original=createRequire(import.meta.url)('../../../.harness/scripts/vm/cn_restore_catalog.cjs');
const binding={database:'workspacex',port:23456,systemIdentifier:'1234567'};
function fixture(){
 const calls:{sql:string;params?:any[]}[]=[];let ended=false;
 const client={connection:{stream:{remoteAddress:'127.0.0.1',remotePort:binding.port}},connect:async()=>{},end:async()=>{ended=true;},query:async(sql:string,params?:any[])=>{
  calls.push({sql,params});
  if(sql===original.identitySql)return{rows:[{database:binding.database,username:'fixture_owner',readonly:'on',isolation:'repeatable read'}]};
  if(sql==='SELECT system_identifier::text AS id FROM pg_control_system()')return{rows:[{id:binding.systemIdentifier}]};
  if(sql===original.QUERIES.database)return{rows:[{owner:'fixture_owner',acl:[]}]};
  if(sql===original.QUERIES.agePresence)return{rows:[{graphs:false,labels:false}]};
  if(sql===original.QUERIES.memberships)return{rows:[{role:'extra_fixture_group',member:'lane',grantor:'fixture_owner'}]};
  if(sql===original.QUERIES.roles)return{rows:params![0].map((name:string)=>({name,rolconfig:['search_path=public']}))};
  return{rows:[]};
 }};
 return{client,calls,ended:()=>ended};
}
test('original complete queries and recursive roles with explicit client fixture',async()=>{
 const f=fixture();const result=await readFixtureCatalog(f.client,binding);
 assert.equal(f.calls[0].sql,'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 for(const[key,sql]of Object.entries(original.QUERIES))if(!['graphs','labels'].includes(key))assert(f.calls.some(x=>x.sql===sql),key);
 assert.equal(f.calls.filter(x=>x.sql===original.QUERIES.memberships).length,2);
 assert(f.calls.find(x=>x.sql===original.QUERIES.roles)?.params?.[0].includes('extra_fixture_group'));
 assert.equal(f.calls.at(-1)?.sql,'ROLLBACK');assert(f.ended());
 assert.equal(result.sqlSha256,original.sqlSha256);assert.equal(result.catalogSha256,original.hash(JSON.stringify(original.canonical(result.facts))));
 assert.equal(result.providerBindingVerified,false);assert.equal(result.originalCaptureProtocolExecuted,false);
});
test('original facts comparator rejects omitted ACL and functions',async()=>{
 const f=fixture();const a=(await readFixtureCatalog(f.client,binding)).facts;
 const changed=structuredClone(a);changed.functions=[{name:'unexpected_function',acl:[{grantee:'PUBLIC',privilege:'EXECUTE'}]}];
 assert.throws(()=>assertCatalogEquivalent(a,changed),/ORIGINAL_CATALOG_FACTS_DIFFER/);
 const changedAcl=structuredClone(a);changedAcl.database[0].acl=[{grantee:'lane',privilege:'CONNECT'}];
 assert.throws(()=>assertCatalogEquivalent(a,changedAcl),/ORIGINAL_CATALOG_FACTS_DIFFER/);
});
test('query failure rolls back and closes without successful facts',async()=>{
 const f=fixture(),query=f.client.query;f.client.query=async(sql,params)=>{if(sql===original.QUERIES.constraints)throw Error('QUERY_FAILED');return query(sql,params);};
 await assert.rejects(readFixtureCatalog(f.client,binding),/QUERY_FAILED/);assert.equal(f.calls.at(-1)?.sql,'ROLLBACK');assert(f.ended());
});
test('wrong actual socket is rejected before begin and closes',async()=>{
 const f=fixture();f.client.connection.stream.remotePort++;
 await assert.rejects(readFixtureCatalog(f.client,binding),/FIXTURE_ACTUAL_SOCKET/);assert.equal(f.calls.length,0);assert(f.ended());
});
test('original production capture retains its port and provider binding gates',()=>{
 assert.throws(()=>original.binding({side:'source',attemptId:'fixture',database:'workspacex',username:'fixture_owner',instanceId:'fixture',providerBindingSha256:'a'.repeat(64),backupReceiptSha256:'b'.repeat(64),peerSha256:'c'.repeat(64),port:23456}),/PORT/);
 assert.throws(()=>original.binding({side:'source',port:5432}),/BINDING/);
});
