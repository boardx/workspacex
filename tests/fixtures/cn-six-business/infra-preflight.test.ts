import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boundedClientConfig,main,validateDatabaseEnvironment,postgresCommand,validatePostgresCommand,validateDatabaseReadback} from './infra-preflight';
const db='wsx_'+'a'.repeat(20);
const env={PGHOST:'127.0.0.1',CN_RELEASE_FULLSTACK_FIXTURE:'1',PGDATABASE:db,WORKSPACEX_DB:db};
test('loopback identity required before any infrastructure access',async()=>{
 validateDatabaseEnvironment(env);
 for(const host of [undefined,'remote.invalid','localhost','::1','127.0.0.2'])assert.throws(()=>validateDatabaseEnvironment({...env,PGHOST:host}),/EXPLICIT_LOOPBACK/);
 const before=process.env.PGHOST;process.env.PGHOST='remote.invalid';
 try{await assert.rejects(main(),/EXPLICIT_LOOPBACK/);}finally{if(before===undefined)delete process.env.PGHOST;else process.env.PGHOST=before;}
});
test('database must be exact fresh isolated name',()=>{
 for(const changed of [{PGDATABASE:'production'},{WORKSPACEX_DB:'wsx_'+'b'.repeat(20)},{WORKSPACEX_REUSE_INFRA:'1'}])assert.throws(()=>validateDatabaseEnvironment({...env,...changed}));
});
test('exact postgres command requires AGE preload and loopback',()=>{
 validatePostgresCommand(postgresCommand(23456),23456);
 assert.throws(()=>validatePostgresCommand(['postgres','-c','listen_addresses=127.0.0.1','-p','23456'],23456));
 assert.throws(()=>validatePostgresCommand(postgresCommand(23456).map(v=>v==='shared_preload_libraries=age'?'shared_preload_libraries=other':v),23456));
 assert.throws(()=>validatePostgresCommand(postgresCommand(23457),23456));
});
test('actual SQL readback must bind database server address port and loaded AGE',()=>{
 const row={database:db,address:'127.0.0.1',port:23456,preload:'age'};validateDatabaseReadback(row,db,23456);
 for(const bad of [{database:'other'},{address:'10.0.0.1'},{port:23457},{preload:''},{preload:'other'},{preload:'age,other'}])assert.throws(()=>validateDatabaseReadback({...row,...bad},db,23456));
});

test('pg client receives separate connect server and protocol-response timeouts',async()=>{
 const {createRequire}=await import('node:module');const require=createRequire(new URL('../../../apps/api/package.json',import.meta.url));
 const cfg=boundedClientConfig({host:'127.0.0.1',query_timeout:0,statement_timeout:0,connectionTimeoutMillis:0});
 assert.equal(cfg.connectionTimeoutMillis,5000);assert.equal(cfg.statement_timeout,5000);assert.equal(cfg.query_timeout,5000);
 const client=new (require('pg').Client)(cfg);
 // Actual installed pg consumes query_timeout through connectionParameters.
 assert.equal(client.connectionParameters.query_timeout,5000);
 assert.equal(client.connectionParameters.statement_timeout,5000);
 assert.equal(client.connectionParameters.host,'127.0.0.1');
});

test('failure projection emits only fixed stage and exact known codes, never arbitrary secret text',async()=>{
 const {safeFailure}=await import('./infra-preflight');
 const secret='token-password-sentinel-DO-NOT-LOG';
 assert.deepEqual(safeFailure(new Error('INFRA_IDENTITY_MISMATCH'),'receipt-identity'),{kind:'cn-six-preflight-failure-v1',verified:false,stage:'receipt-identity',code:'INFRA_IDENTITY_MISMATCH'});
 assert.equal(safeFailure({code:'ECONNREFUSED',message:secret},'pg-connect').code,'ECONNREFUSED');
 const bad=safeFailure({code:secret,message:secret,stack:secret},secret);
 assert.equal(bad.stage,'OTHER');assert.equal(bad.code,'OTHER');assert.ok(!JSON.stringify(bad).includes(secret));
});
