/** Explicit isolated Docker/PostgreSQL integration. Never run against an existing deployment. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { backupStarterDatabase, restoreStarterDatabase } from "../src/starter-backup";
if(process.env.WORKSPACEX_DATA_TEST!=="1")throw new Error("isolated test opt-in required");
const execute=promisify(execFile);
const container=process.env.STARTER_POSTGRES_CONTAINER??"";
if(!/^wsx-cp05-[a-z]+$/.test(container))throw new Error("owned test container required");
const source=`wsx_backup_${randomBytes(5).toString("hex")}`, restored=`${source}_restored`;
const target={container,database:source,user:"postgres",password:process.env.MIGRATION_DB_PASSWORD??""};
const root=await mkdtemp(join(tmpdir(),"starter-backup-live-"));
const sql=async(database:string,command:string)=>(await execute("docker",["exec",container,"psql","-U","postgres","-d",database,"-A","-t","--set=ON_ERROR_STOP=1","--command",command])).stdout.trim();
try{
  await sql("postgres",`CREATE DATABASE "${source}"`);
  await execute(process.execPath,["--import","tsx","apps/api/src/infrastructure/db/migrate-cli.ts"],{env:{...process.env,PGDATABASE:source},timeout:120000});
  await sql(source,"CREATE TABLE backup_probe (id integer PRIMARY KEY, message text); INSERT INTO backup_probe VALUES(1,'restore-check'); ALTER TABLE backup_probe ENABLE ROW LEVEL SECURITY; ALTER TABLE backup_probe FORCE ROW LEVEL SECURITY;");
  const migrationCount=await sql(source,"SELECT count(*) FROM _kernel_migrations");assert(Number(migrationCount)>0);
  const manifest=await backupStarterDatabase(target,root);assert(manifest.bytes>0);assert.equal(manifest.postgresMajor,16);
  const result=await restoreStarterDatabase({...target,database:restored},root);assert.equal(result.restored,true);
  assert.equal(await sql(restored,"SELECT message FROM backup_probe WHERE id=1"),"restore-check");
  assert.equal(await sql(restored,"SELECT count(*) FROM _kernel_migrations"),migrationCount);
  assert.equal(await sql(restored,"SELECT relforcerowsecurity FROM pg_class WHERE relname='backup_probe'"),"t");
  await assert.rejects(restoreStarterDatabase({...target,database:restored},root));
  assert.equal(await sql(restored,"SELECT count(*) FROM backup_probe"),"1");
  await assert.rejects(restoreStarterDatabase(target,root),/RESTORE_REQUIRES_NEW_DATABASE/);
  const archive=await readFile(join(root,"database.dump"));archive[archive.length-1]=archive[archive.length-1]!^1;await writeFile(join(root,"database.dump"),archive);
  await assert.rejects(restoreStarterDatabase({...target,database:`${source}_tampered`},root),/BACKUP_CHECKSUM_MISMATCH/);
  assert.equal(await sql("postgres",`SELECT count(*) FROM pg_database WHERE datname='${source}_tampered'`),"0");
  console.log(JSON.stringify({ok:true,restoredMigrations:Number(migrationCount),data:true,rls:true,existingDatabasePreserved:true,sameDatabaseRejected:true,tamperRejectedBeforeCreate:true,cloudVerified:false}));
}finally{
  await sql("postgres",`DROP DATABASE IF EXISTS "${restored}" WITH(FORCE)`);
  await sql("postgres",`DROP DATABASE IF EXISTS "${source}" WITH(FORCE)`);
  await rm(root,{recursive:true,force:true});
}
