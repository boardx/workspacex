/** Explicitly owned disposable PG16 instance only; never pointed at shared infrastructure. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { migrationConfig } from "../../src/infrastructure/db/pg-config";
if(process.env.WORKSPACEX_DATA_TEST!=="1")throw new Error("isolated test opt-in required");
const execute=promisify(execFile),owner=new pg.Client(migrationConfig());await owner.connect();
assert.equal((await owner.query("SELECT 1 FROM pg_database WHERE datname='workspacex_memory'")).rows.length,0,"fresh disposable memory database required");
for(const name of ["memory_rw","memory_owner"])assert.equal((await owner.query("SELECT 1 FROM pg_roles WHERE rolname=$1",[name])).rows.length,0,"fresh disposable roles required");
const env={...process.env,WORKSPACEX_DEPLOY_PROFILE:"starter",MEMORY_DB_USER:"memory_rw",MEMORY_DB_OWNER:"memory_owner",MEMORY_DB_PASSWORD:"isolated-memory-runtime-password",MEMORY_DB_OWNER_PASSWORD:"isolated-memory-owner-password",MEMORY_DB_DATABASE:"workspacex_memory"};
const run=(extra={})=>execute(process.execPath,["--import","tsx","apps/api/scripts/prepare-starter-roles.ts"],{env:{...env,...extra},timeout:30000});
try{
 assert.equal(JSON.parse((await run()).stdout).memoryDatabasePrepared,true);
 const flags=await owner.query("SELECT rolname,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname IN ('memory_rw','memory_owner') ORDER BY rolname");
 assert.equal(flags.rows.length,2);for(const row of flags.rows)for(const flag of ["rolsuper","rolbypassrls","rolcreatedb","rolcreaterole"])assert.equal(row[flag],false);
 const migration=new pg.Client({...migrationConfig(),database:"workspacex_memory",user:"memory_owner",password:env.MEMORY_DB_OWNER_PASSWORD});await migration.connect();
 try{await migration.query('CREATE SCHEMA workspacex_memory; CREATE TABLE workspacex_memory.store(key text PRIMARY KEY); INSERT INTO workspacex_memory.store VALUES(\'preserved\'); GRANT USAGE ON SCHEMA workspacex_memory TO memory_rw; GRANT SELECT,INSERT,UPDATE,DELETE ON workspacex_memory.store TO memory_rw');}finally{await migration.end();}
 await Promise.all([run(),run()]);
 const runtime=new pg.Client({...migrationConfig(),database:"workspacex_memory",user:"memory_rw",password:env.MEMORY_DB_PASSWORD});await runtime.connect();
 try{assert.equal((await runtime.query("SELECT key FROM workspacex_memory.store")).rows[0].key,"preserved");await assert.rejects(runtime.query("CREATE TABLE workspacex_memory.unauthorized(id int)"));await assert.rejects(runtime.query("CREATE SCHEMA unauthorized"));}finally{await runtime.end();}
 for(const extra of [{MEMORY_DB_PASSWORD:"wrong-stable-password"},{MEMORY_DB_OWNER_PASSWORD:"wrong-owner-password"},{MEMORY_DB_PASSWORD:env.MEMORY_DB_OWNER_PASSWORD},{MEMORY_DB_USER:"app_rw"},{MEMORY_DB_OWNER:"agent_server"},{MEMORY_DB_DATABASE:"workspacex"},{MEMORY_DB_PASSWORD:""},{WORKSPACEX_DEPLOY_PROFILE:"production"}])await assert.rejects(run(extra));
 await owner.query("GRANT memory_owner TO memory_rw");await assert.rejects(run());await owner.query("REVOKE memory_owner FROM memory_rw");await run();
 await owner.query('ALTER DATABASE workspacex_memory OWNER TO postgres');await assert.rejects(run());
 console.log(JSON.stringify({ok:true,memoryDatabase:true,separateMigrationAndRuntime:true,runtimeDdlRejected:true,concurrentReplay:true,wrongPasswordsRejected:true,roleMembershipRejected:true,wrongOwnerRejected:true,cloudVerified:false}));
}finally{await owner.query('DROP DATABASE IF EXISTS workspacex_memory WITH(FORCE)');await owner.query('DROP ROLE IF EXISTS memory_rw');await owner.query('DROP ROLE IF EXISTS memory_owner');await owner.end();}
