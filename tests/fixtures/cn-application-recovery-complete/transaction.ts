/** Isolated real migrator transaction probe, never a production migration plan. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire}from'node:module';
const pg=createRequire(new URL('../../../apps/api/package.json',import.meta.url))('pg');
import {migrate,migrationFiles,MIGRATIONS_DIR} from '../../../apps/api/src/infrastructure/db/migrator';
export function isolated(config:any,root:string){
 assert(typeof config.host==='string'&&/^\/.*\/wsx-pg-fixture-[^/]+\/socket$/.test(config.host));
 assert(config.user==='fixture_owner'&&/^app_[a-z_]+$/.test(config.database)&&config.port===5432);
 assert(path.resolve(root)===root&&root===path.dirname(config.host));
}
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
export async function transactionFault(config:any,root:string){
 isolated(config,root);
 const q=async(sql:string,args:any[]=[])=>{const c=new pg.Client(config);await c.connect();try{return(await c.query(sql,args)).rows;}finally{await c.end();}};
 const before=await q('SELECT name,checksum FROM _kernel_migrations ORDER BY name');
 const expected=[];for(const name of migrationFiles())expected.push({name,checksum:sha(await fs.readFile(path.join(MIGRATIONS_DIR,name)))});
 assert.deepEqual(before,expected,'FULL_ORIGINAL_APPLICATION_SCHEMA_REQUIRED');
 const dir=path.join(root,'transaction-fault');await fs.mkdir(dir,{mode:0o700});
 const first='99999999999990_fixture_committed.sql',second='99999999999991_fixture_atomic.sql';
 const a="CREATE TABLE cn_atomic_kept(id integer PRIMARY KEY,value text NOT NULL); INSERT INTO cn_atomic_kept VALUES(1,'original');\n";
 const b="CREATE TABLE cn_atomic_rolled_back(id integer PRIMARY KEY); INSERT INTO cn_atomic_rolled_back VALUES(2); UPDATE cn_atomic_kept SET value='should-rollback'; SELECT 1/0;\n";
 await fs.writeFile(path.join(dir,first),a,{flag:'wx',mode:0o600});await fs.writeFile(path.join(dir,second),b,{flag:'wx',mode:0o600});
 await assert.rejects(migrate(config,{dir}),/migration 99999999999991_fixture_atomic.sql failed/);
 const failedLedger=await q('SELECT name,checksum FROM _kernel_migrations ORDER BY name');
 assert.deepEqual(failedLedger,[...before,{name:first,checksum:sha(a)}]);
 assert.deepEqual(await q('SELECT * FROM cn_atomic_kept'),[{id:1,value:'original'}]);
 assert.deepEqual(await q("SELECT to_regclass('public.cn_atomic_rolled_back')::text AS name"),[{name:null}]);
 // Explicit fixture repair, never an automatic retry of a production migration.
 const repaired=b.replace("UPDATE cn_atomic_kept SET value='should-rollback'; SELECT 1/0;","UPDATE cn_atomic_kept SET value='repaired';");
 await fs.writeFile(path.join(dir,second),repaired,{flag:'w',mode:0o600});
 const repair=await migrate(config,{dir});assert.deepEqual(repair.applied,[second]);assert.deepEqual(repair.skipped,[first]);
 const finalLedger=await q('SELECT name,checksum FROM _kernel_migrations ORDER BY name');
 assert.deepEqual(finalLedger,[...before,{name:first,checksum:sha(a)},{name:second,checksum:sha(repaired)}]);
 const replay=await migrate(config,{dir});assert.deepEqual(replay.applied,[]);assert.deepEqual(replay.skipped,[first,second]);
 assert.deepEqual(await q('SELECT name,checksum FROM _kernel_migrations ORDER BY name'),finalLedger);
 assert.deepEqual(await q('SELECT * FROM cn_atomic_kept'),[{id:1,value:'repaired'}]);
 assert.deepEqual(await q('SELECT * FROM cn_atomic_rolled_back'),[{id:2}]);
 const evidence={kind:'isolated-original-migrator-transaction-v1',fullSchemaCount:before.length,originalLedgerSha256:sha(JSON.stringify(before)),failedLedgerSha256:sha(JSON.stringify(failedLedger)),finalLedgerSha256:sha(JSON.stringify(finalLedger)),sql:{first:sha(a),failed:sha(b),repaired:sha(repaired)},failureRolledBackDDL:true,failureRolledBackRows:true,failureLedgerAbsent:true,explicitRepairApplied:[second],replayApplied:replay.applied,productionAccepted:false,candidateValidation:false};
 await fs.writeFile(path.join(root,'transaction-evidence.json'),JSON.stringify(evidence)+'\n',{flag:'wx',mode:0o600});return evidence;
}
