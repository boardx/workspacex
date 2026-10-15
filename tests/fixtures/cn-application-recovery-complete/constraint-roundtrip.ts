import assert from 'node:assert/strict';
/** Actual PostgreSQL parser/deparser regression in one owned, private session.
 * All tables are temporary. Definitions and values never enter diagnostics.
 */
export async function constraintRoundtrip(client:{query(sql:string,args?:unknown[]):Promise<{rows:any[]}>}){
 const inspect=async(table:string)=>{
  assert(['cn_roundtrip_source','cn_roundtrip_restore','cn_roundtrip_bound','cn_roundtrip_operator','cn_roundtrip_column','cn_roundtrip_flag'].includes(table));
  const rows=(await client.query('SELECT pg_get_constraintdef(oid,false) nonpretty,pg_get_constraintdef(oid,true) pretty,convalidated validated FROM pg_constraint WHERE conrelid=$1::regclass AND contype=\'c\'',['pg_temp.'+table])).rows;
  assert.equal(rows.length,1);return rows[0];
 };
 await client.query('CREATE TEMP TABLE cn_roundtrip_source(n integer,m integer,CHECK(n BETWEEN 1 AND 40 AND n<>m))');
 const source=await inspect('cn_roundtrip_source');assert.equal(source.validated,true);
 assert.equal(typeof source.nonpretty,'string');assert(source.nonpretty.startsWith('CHECK (')&&source.nonpretty.length<4096);
 // Only the fixed temporary constraint decompiled above is reparsed here.
 await client.query('CREATE TEMP TABLE cn_roundtrip_restore(n integer,m integer,'+source.nonpretty+')');
 const restored=await inspect('cn_roundtrip_restore');
 assert.notEqual(source.nonpretty,restored.nonpretty,'NONPRETTY_ROUNDTRIP_NOT_REPRODUCED');
 assert.equal(source.pretty,restored.pretty,'SERVER_CANONICAL_ROUNDTRIP_CHANGED');
 await client.query('CREATE TEMP TABLE cn_roundtrip_bound(n integer,m integer,CHECK(n BETWEEN 1 AND 41 AND n<>m))');
 await client.query('CREATE TEMP TABLE cn_roundtrip_operator(n integer,m integer,CHECK(n BETWEEN 1 AND 40 OR n<>m))');
 await client.query('CREATE TEMP TABLE cn_roundtrip_column(n integer,m integer,CHECK(m BETWEEN 1 AND 40 AND n<>m))');
 for(const table of ['cn_roundtrip_bound','cn_roundtrip_operator','cn_roundtrip_column'])assert.notEqual(source.pretty,(await inspect(table)).pretty,'SEMANTIC_DRIFT_NOT_REJECTED');
 await client.query('CREATE TEMP TABLE cn_roundtrip_flag(n integer,m integer)');
 await client.query('ALTER TABLE cn_roundtrip_flag ADD CHECK(n BETWEEN 1 AND 40 AND n<>m) NOT VALID');
 const flag=await inspect('cn_roundtrip_flag');assert.equal(flag.validated,false);assert.notEqual(source.pretty,flag.pretty,'NOT_VALID_DRIFT_NOT_REJECTED');
 return {actualPostgres:true,temporaryTablesOnly:true,nonprettyRoundtripDifference:true,serverCanonicalEqual:true,boundDriftRejected:true,operatorDriftRejected:true,columnDriftRejected:true,notValidDriftRejected:true};
}
