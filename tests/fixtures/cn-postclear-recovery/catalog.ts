/** Isolated fixture adapter. Original facts algorithm; not production capture authority. */
import assert from 'node:assert/strict';
import {createRequire}from'node:module';
const require=createRequire(import.meta.url);
const catalog=require('../../../.harness/scripts/vm/cn_restore_catalog.cjs');
const pg=createRequire(new URL('../../../apps/api/package.json',import.meta.url))('pg');
const roles=['fixture_owner','app','lane','migration_admin'];
const names=['workspacex','workspacex_agent','workspacex_memory'];
export interface CatalogBinding{database:string;port:number;systemIdentifier:string}
function checkBinding(b:CatalogBinding){
 assert([...names,...names.map(x=>'recovered_'+x)].includes(b.database),'FIXTURE_DATABASE');
 assert(Number.isSafeInteger(b.port)&&b.port>1024&&b.port<65536,'FIXTURE_PORT');
 assert(/^[0-9]+$/.test(b.systemIdentifier),'FIXTURE_CLUSTER');
}
export function assertCatalogEquivalent(left:unknown,right:unknown){
 assert.deepEqual(catalog.canonical(left),catalog.canonical(right),'ORIGINAL_CATALOG_FACTS_DIFFER');
}
/** Injectable already-created client is a fixture test seam, never a production export. */
export async function readFixtureCatalog(client:any,binding:CatalogBinding){
 checkBinding(binding);let begun=false;
 try{
  await client.connect();
  const socket=client.connection?.stream;
  assert(socket&&String(socket.remoteAddress).replace(/^::ffff:/,'')==='127.0.0.1'&&socket.remotePort===binding.port,'FIXTURE_ACTUAL_SOCKET');
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');begun=true;
  await client.query("SET LOCAL search_path='pg_catalog'");
  const check=async()=>{
   const rows=(await client.query(catalog.identitySql)).rows;
   assert(rows.length===1&&rows[0].database===binding.database&&rows[0].username==='fixture_owner'&&rows[0].readonly==='on'&&rows[0].isolation==='repeatable read','FIXTURE_SQL_IDENTITY');
   const cluster=(await client.query('SELECT system_identifier::text AS id FROM pg_control_system()')).rows;
   assert(cluster.length===1&&cluster[0].id===binding.systemIdentifier,'FIXTURE_ACTUAL_CLUSTER');
  };
  await check();
  // No copied query/comparator subset: actual production algorithm performs all
  // categories and recursive role/membership closure, with its canonicalization.
  const facts=await catalog.collectFacts(client,roles);await check();
  await client.query('ROLLBACK');begun=false;
  return{facts,catalogSha256:catalog.hash(JSON.stringify(facts)),sqlSha256:catalog.sqlSha256,
   originalCatalogFactsVerified:true,originalCaptureProtocolExecuted:false,providerBindingVerified:false};
 }finally{
  try{if(begun)await client.query('ROLLBACK');}finally{await client.end();}
 }
}
export async function captureFixtureCatalog(config:{port:number;systemIdentifier:string},database:string){
 return readFixtureCatalog(new pg.Client({host:'127.0.0.1',port:config.port,user:'fixture_owner',database,
  connectionTimeoutMillis:5000,statement_timeout:15000}),{...config,database});
}
