/** Real disposable PostgreSQL acceptance: explicitly opt in, never use ambient PG*. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {executeMigrations} from '../scripts/unified-migration-driver.mjs';
const {Client}=createRequire(new URL('../apps/api/package.json',import.meta.url))('pg');
test('real PostgreSQL: per-file commits, retries, checksum rejection and lost COMMIT acknowledgement',
 {skip:process.env.WSX_RUN_LOCAL_PG_TEST!=='1',timeout:60000},async()=>{
 const name='wsx-unified-test-'+randomBytes(8).toString('hex');
 const password=randomBytes(24).toString('hex');
 const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],...options});
 try {
  docker(['run','--detach','--rm','--name',name,'--label','wsx.test.owner=unified-release-6187','--memory=384m','--cpus=1','--env','POSTGRES_PASSWORD','--publish','127.0.0.1::5432','postgres:16'],{env:{...process.env,POSTGRES_PASSWORD:password}});
  const port=Number(docker(['port',name,'5432/tcp']).trim().split(':').at(-1));
  const connect=async()=>{const c=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',password,connectionTimeoutMillis:1000});await c.connect();return c;};
  let ready=false;
  for(let i=0;i<80;i++){try{const c=await connect();await c.end();ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}
  assert(ready,'disposable PostgreSQL started');
  const run=async(files,mode='apply',loseCommit=false)=>{
   const c=await connect();let lost=false;
   const wrapped={query:async(sql,args)=>{const result=await c.query(sql,args);if(loseCommit&&sql==='COMMIT'&&!lost){lost=true;throw Error('simulated lost acknowledgement');}return result;}};
   try{return await executeMigrations({client:wrapped,files,mode,expectedDatabase:'postgres',expectedUser:'postgres'});}finally{await c.end();}
  };
  const files={'001.sql':'CREATE TABLE release_probe(id integer PRIMARY KEY);','002.sql':'INSERT INTO missing_table VALUES (1);'};
  let r=await run(files);assert.equal(r.status,'FAILED');assert.deepEqual(r.applied,['001.sql']);assert.equal(r.sqlState,'42P01');
  files['002.sql']='INSERT INTO release_probe VALUES(1);';r=await run(files);assert.equal(r.status,'COMPLETE');assert.deepEqual(r.applied,['002.sql']);
  r=await run(files);assert.equal(r.status,'COMPLETE');assert.deepEqual(r.applied,[]);
  const drift=await run({...files,'001.sql':'SELECT 1;'});assert.equal(drift.status,'COMPLETE');assert.deepEqual(drift.historicalDrift,['001.sql']);assert.deepEqual(drift.applied,[]);
  files['003.sql']='INSERT INTO release_probe VALUES(2);';files['004.sql']='INSERT INTO release_probe VALUES(3);';
  r=await run(files,'apply',true);assert.equal(r.status,'RECONCILE_REQUIRED');assert.equal(r.failedMigration,'003.sql');
  assert.deepEqual((await run(files,'plan')).pending,['004.sql']);assert.deepEqual((await run(files)).applied,['004.sql']);
  const c=await connect();try{assert.equal((await c.query('SELECT count(*)::integer AS n FROM release_probe')).rows[0].n,3);}finally{await c.end();}
 } finally {
  docker(['rm','--force',name]);
 }
});
