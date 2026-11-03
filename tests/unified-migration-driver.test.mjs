import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {executeMigrations} from '../scripts/unified-migration-driver.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
function client({ledger={},failSql,loseCommit=false}={}) {
 const rows={...ledger};let staged;const calls=[];let lost=false;
 return {rows,calls,async query(sql,args=[]) {
  calls.push(sql);
  if(sql.includes('current_database()'))return {rows:[{database:'app',role:'migration_admin'}]};
  if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};
  if(sql.includes('to_regclass'))return {rows:[{present:true}]};
  if(sql.startsWith('SELECT name,checksum'))return {rows:Object.entries(staged??rows).map(([name,checksum])=>({name,checksum}))};
  if(sql==='BEGIN'){staged={...rows};return {rows:[]};}
  if(sql==='COMMIT') {Object.assign(rows,staged);staged=undefined;if(loseCommit&&!lost){lost=true;throw Error('private provider details');}return {rows:[]};}
  if(sql==='ROLLBACK'){staged=undefined;return {rows:[]};}
  if(sql.startsWith('INSERT INTO public._kernel_migrations')){staged[args[0]]=args[1];return {rows:[]};}
  if(sql===failSql)throw Object.assign(Error('secret database details'),{code:'42501'});
  return {rows:[]};
 }};
}
const run=(c,files,mode='apply',extra={})=>executeMigrations({client:c,files,mode,expectedDatabase:'app',expectedUser:'migration_admin',...extra});
test('plan is read-only and lists only pending SQL',async()=>{
 const c=client({ledger:{'001.sql':hash('ONE')}});const r=await run(c,{'001.sql':'ONE','002.sql':'TWO'},'plan');
 assert.equal(r.status,'PENDING');assert.deepEqual(r.pending,['002.sql']);assert(!c.calls.includes('ONE'));assert(!c.calls.some(q=>q.startsWith('CREATE')));
});
test('all committed SQL is skipped on retry',async()=>{
 const c=client();const files={'001.sql':'ONE','002.sql':'TWO'};
 assert.equal((await run(c,files)).applied.length,2);assert.equal((await run(c,files)).status,'COMPLETE');
 assert.equal(c.calls.filter(q=>q==='ONE').length,1);
});
test('edited or removed historical SQL is reported and never replayed or rewritten',async()=>{
 for(const files of [{'001.sql':'CHANGED'},{'002.sql':'TWO'}]){
 const c=client({ledger:{'001.sql':hash('ONE')}});const r=await run(c,files);
 assert.equal(r.status,'COMPLETE');assert.deepEqual(r.historicalDrift,['001.sql']);assert.equal(c.rows['001.sql'],hash('ONE'));assert(!c.calls.includes('CHANGED'));
 }
});
test('wrong DB or runtime identity cannot apply',async()=>{
 for(const extra of [{expectedDatabase:'other'},{expectedUser:'app_rw'}]){
 const c=client();const r=await run(c,{'001.sql':'ONE'},'apply',extra);assert.equal(r.status,'FAILED');assert(!c.calls.includes('BEGIN'));
 }
});
test('partial progress commits SQL and ledger together, retry continues',async()=>{
 const c=client({failSql:'TWO'});const files={'001.sql':'ONE','002.sql':'TWO'};const r=await run(c,files);
 assert.equal(r.status,'FAILED');assert.equal(r.failedMigration,'002.sql');assert.deepEqual(Object.keys(c.rows),['001.sql']);assert.equal(r.sqlState,'42501');
 assert(!JSON.stringify(r).includes('secret'));
 const retry=client({ledger:c.rows});assert.deepEqual((await run(retry,files)).applied,['002.sql']);
});
test('lost commit acknowledgement is not retried, fresh ledger determines outcome',async()=>{
 const c=client({loseCommit:true});const files={'001.sql':'ONE','002.sql':'TWO'};
 const r=await run(c,files);assert.equal(r.status,'RECONCILE_REQUIRED');assert(!c.calls.includes('ROLLBACK'));assert(!c.calls.includes('TWO'));
 const fresh=client({ledger:c.rows});assert.deepEqual((await run(fresh,files)).applied,['002.sql']);
});
test('migration lock contention returns busy before changing ledger',async()=>{
 const c=client();const query=c.query;c.query=async(q,a)=>q.includes('pg_try_advisory_lock')?{rows:[{locked:false}]}:query(q,a);
 assert.equal((await run(c,{'001.sql':'ONE'})).code,'MIGRATION_BUSY');assert(!c.calls.includes('BEGIN'));
});
