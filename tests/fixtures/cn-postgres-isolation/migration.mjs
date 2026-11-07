// Actual application migrator, copied byte-for-byte beside this fixture by the
// Linux harness. Only synthetic SQL is supplied through its existing dir option.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { migrate } from './migrator.ts';
const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
assert.equal(config.host,path.dirname(process.argv[2])+'/socket');
assert.equal(config.database,'cn_fixture');
const root=path.dirname(process.argv[2]);
const client=new pg.Client(config);await client.connect();
const tests=[];
try {
 const baseline=await client.query('SELECT * FROM old_data ORDER BY id');
 const broken=path.join(root,'broken');await fs.mkdir(broken);
 await fs.writeFile(path.join(broken,'001_bad.sql'),"INSERT INTO old_data VALUES(2,'not committed'); ALTER TABLE old_data ADD COLUMN bad text; SELECT 1/0;");
 for(let n=0;n<2;n++) {
  await assert.rejects(migrate(config,{dir:broken}),/migration 001_bad.sql failed/);
  assert.deepEqual((await client.query('SELECT * FROM old_data ORDER BY id')).rows,baseline.rows);
  assert.equal((await client.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='old_data' AND column_name='bad'")).rows[0].n,0);
  assert.equal((await client.query('SELECT count(*)::int n FROM _kernel_migrations')).rows[0].n,0);
 }
 tests.push('failed_file_rolls_back_schema_rows_and_ledger','failed_retry_preserves_old_schema_and_rows');
 const good=path.join(root,'good');await fs.mkdir(good);
 await fs.writeFile(path.join(good,'001_good.sql'),"CREATE TABLE once_probe(id integer PRIMARY KEY); INSERT INTO once_probe VALUES(1);");
 const results=await Promise.all([migrate(config,{dir:good}),migrate(config,{dir:good})]);
 assert.equal(results.reduce((n,r)=>n+r.applied.length,0),1);
 assert.equal(results.reduce((n,r)=>n+r.skipped.length,0),1);
 assert.equal((await client.query('SELECT count(*)::int n FROM once_probe')).rows[0].n,1);
 assert.equal((await client.query('SELECT count(*)::int n FROM _kernel_migrations')).rows[0].n,1);
 assert.deepEqual(await migrate(config,{dir:good}),{applied:[],skipped:['001_good.sql']});
 tests.push('concurrent_real_migrators_apply_once','sequential_migration_replay_is_noop');
 const waiting=path.join(root,'waiting');await fs.mkdir(waiting);
 await fs.writeFile(path.join(waiting,'002_wait.sql'),'CREATE TABLE must_not_exist(id integer);');
 await client.query('SELECT pg_advisory_lock($1)',[8014530119003001]);
 try{await assert.rejects(migrate(config,{dir:waiting,lockTimeoutMs:50}),/lock timeout/);}
 finally{await client.query('SELECT pg_advisory_unlock($1)',[8014530119003001]);}
 assert.equal((await client.query("SELECT to_regclass('public.must_not_exist') AS x")).rows[0].x,null);
 assert.deepEqual((await client.query('SELECT * FROM old_data ORDER BY id')).rows,baseline.rows);
 tests.push('advisory_lock_timeout_performs_no_migration','old_application_query_remains_valid');
 console.log(JSON.stringify({tests,actualApplicationMigrator:true,providerCalls:0}));
} finally {await client.end();}
