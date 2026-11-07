import test from'node:test';import assert from'node:assert/strict';
import{isolated,transactionFault}from'./transaction';
test('actual original migrator import rejects foreign connection before DB',async()=>{
 const cfg={host:'/tmp/wsx-pg-fixture-fixture/socket',port:5432,user:'fixture_owner',database:'app_test'};isolated(cfg,'/tmp/wsx-pg-fixture-fixture');
 for(const change of [{host:'production.invalid'},{port:5433},{user:'app_rw'},{database:'workspacex'}])await assert.rejects(transactionFault({...cfg,...change},'/tmp/wsx-pg-fixture-fixture'),assert.AssertionError);
});
