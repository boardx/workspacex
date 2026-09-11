/** Run only in an explicitly owned disposable PostgreSQL instance. Fixed Agent DB required by deployment. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { migrationConfig } from "../../src/infrastructure/db/pg-config";
if(process.env.WORKSPACEX_DATA_TEST!=="1")throw new Error("isolated test opt-in required");
const execute=promisify(execFile);
const owner=new pg.Client(migrationConfig());await owner.connect();
const existing=await owner.query("SELECT 1 FROM pg_database WHERE datname='workspacex_agent'");
assert.equal(existing.rows.length,0,"requires fresh disposable Agent database");
const env={...process.env,WORKSPACEX_DEPLOY_PROFILE:"starter",AGENT_DB_USER:"agent_server",AGENT_DB_PASSWORD:"agent-isolated-strong-password",AGENT_DB_DATABASE:"workspacex_agent"};
const run=(extra={})=>execute(process.execPath,["--import","tsx","apps/api/scripts/prepare-starter-roles.ts"],{env:{...env,...extra},timeout:30000});
try{
 assert.equal(JSON.parse((await run()).stdout).agentDatabasePrepared,true);
 const role=await owner.query("SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='agent_server'");
 assert.deepEqual(role.rows[0],{rolsuper:false,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false});
 const probe=new pg.Client({...migrationConfig(),database:"workspacex_agent",user:"agent_server",password:env.AGENT_DB_PASSWORD});await probe.connect();
 try{await probe.query("CREATE TABLE durable_agent_checkpoint(id integer PRIMARY KEY); INSERT INTO durable_agent_checkpoint VALUES(1)");}finally{await probe.end();}
 await Promise.all([run(),run()]);
 await assert.rejects(run({AGENT_DB_PASSWORD:"incorrect-stable-password"}));
 await assert.rejects(run({AGENT_DB_USER:"app_rw"}));
 await assert.rejects(run({AGENT_DB_DATABASE:"workspacex"}));
 await assert.rejects(run({AGENT_DB_PASSWORD:""}));
 await assert.rejects(run({WORKSPACEX_DEPLOY_PROFILE:"production"}));
 await owner.query('GRANT app_rw TO agent_server');
 await assert.rejects(run());
 await owner.query('REVOKE app_rw FROM agent_server');
 await owner.query('GRANT agent_server TO app_rw');
 await assert.rejects(run());
 await owner.query('REVOKE agent_server FROM app_rw');
 await run();
 const replay=new pg.Client({...migrationConfig(),database:"workspacex_agent",user:"agent_server",password:env.AGENT_DB_PASSWORD});await replay.connect();
 try{assert.equal((await replay.query("SELECT count(*)::int AS n FROM durable_agent_checkpoint")).rows[0].n,1);}finally{await replay.end();}
 await owner.query('ALTER DATABASE "workspacex_agent" OWNER TO postgres');
 await assert.rejects(run());
 console.log(JSON.stringify({ok:true,agentDatabase:true,independentRole:true,concurrentReplay:true,wrongPasswordRejected:true,wrongOwnerRejected:true,appRoleRejected:true,productionRejected:true,checkpointPreserved:true,roleMembershipRejected:true,cloudVerified:false}));
}finally{await owner.query('DROP DATABASE IF EXISTS "workspacex_agent" WITH(FORCE)');await owner.query('DROP ROLE IF EXISTS "agent_server"');await owner.end();}
