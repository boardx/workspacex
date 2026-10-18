import test from 'node:test';
import assert from 'node:assert/strict';
import { context, shard, reduceReport, aggregate, expectedIsolation, safeFailureSummary } from './ci-smoke-shards.mjs';
const source='a'.repeat(40);
const env={WSX_SMOKE_SOURCE_SHA:source,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',RUNNER_ENVIRONMENT:'github-hosted'};
function report(ids, part) {
  return {config:{shard:part?{current:part,total:2}:null},errors:[],stats:{startTime:'2026-10-18T00:00:00Z',duration:1000,expected:ids.length,unexpected:0,skipped:0,flaky:0},
    suites:[{specs:ids.map(i=>({title:'case-'+i,file:'e2e/case-'+i+'.spec.ts',line:i+1,column:1,
      tests:[{projectName:i<80?'seeded':'seeded-github-import',expectedStatus:'passed',status:'expected',
        results:[{status:'passed',retry:0,duration:1,startTime:'2026-10-18T00:00:00Z'}]}]}))}]};
}
const range=(a,b)=>Array.from({length:b-a},(_,i)=>a+i);
function isolationLog(meta) { const d=expectedIsolation(meta.isolationSeed); return '[test-isolation] id='+d.id+' db='+d.database+' compose='+d.composeProject; }
function part(ids,n) {const m=context(env,n,2);return reduceReport(report(ids,n),m,isolationLog(m),'host'+n);}
function parts() {return [part(range(0,220),0),part([...range(0,80),...range(80,150)],1),part([...range(0,80),...range(150,220)],2)];}
const expected=context(env,0,2);
test('full220 union, primary once, dependency replication explicit',()=>{
 const v=aggregate(parts(),expected);assert.equal(v.baselineUnique,220);assert.equal(v.shardedUnique,220);
 assert.equal(v.shardExecutions,300);assert.equal(v.repeatedDependencyExecutions,80);
 assert.equal(v.productionAccepted,false);assert.equal(v.thirtyMinuteProductionProven,false);
});
test('missing primary rejects',()=>{const p=parts();p[2].records.pop();assert.throws(()=>aggregate(p,expected),/COVERAGE_MISSING/);});
test('duplicate primary across shards rejects',()=>{const p=parts();p[2].records.push(p[1].records[80]);assert.throws(()=>aggregate(p,expected),/DUPLICATE_PRIMARY/);});
test('missing state prerequisite rejects',()=>{const p=parts();p[1].records.shift();assert.throws(()=>aggregate(p,expected),/DEPENDENCY_OR_PRIMARY_MISSING/);});
test('wrongsource attempt and missingpart reject',()=>{
 for(const key of ['source','run','attempt']) {const p=parts();p[1][key]='other';assert.throws(()=>aggregate(p,expected),/PART_IDENTITY/);}
 assert.throws(()=>aggregate(parts().slice(1),expected),/PART_COUNT/);
});
test('host database and compose collisions reject',()=>{
 for(const key of ['hostSha256','database','composeProject']){const p=parts();p[2][key]=p[1][key];assert.throws(()=>aggregate(p,expected),/FIXTURE_CONFLICT/);}
});
test('failed skipped retry and expected-failure never count as pass',()=>{
 for(const mutation of [t=>t.status='skipped',t=>t.status='flaky',t=>t.expectedStatus='failed',
   t=>t.results[0].status='failed',t=>t.results[0].retry=1,t=>t.results.push(t.results[0])]) {
  const r=report(range(0,220),0);mutation(r.suites[0].specs[0].tests[0]);
  assert.throws(()=>reduceReport(r,expected,'unused','host'),/TEST_NOT_FIRST_PASS/);
 }
});
test('global errors and emptyreport reject',()=>{
 const r=report(range(0,220),0);r.errors=[{message:'provider private payload'}];
 assert.throws(()=>reduceReport(r,expected,'unused','host'),/REPORT_ERRORS/);
 assert.throws(()=>reduceReport(report([],0),expected,'unused','host'),/EMPTY_COLLECTION/);
});
test('wrongstats and unobserved isolation reject',()=>{
 const r=report(range(0,220),0);r.stats.expected=219;
 assert.throws(()=>reduceReport(r,expected,'unused','host'),/REPORT_COUNTS/);
 assert.throws(()=>reduceReport(report(range(0,220),0),expected,'[test-isolation] id=other db=db compose=stack','host'),/ISOLATION_OBSERVATION/);
});
test('unknown duplicate and unexpected shard reject',()=>{
 const p=parts();p[1].records.push({...p[1].records[0],id:'f'.repeat(64)});
 assert.throws(()=>aggregate(p,expected),/UNPLANNED_OR_DUPLICATE_TEST/);
 const q=parts();q[2].observedShard.current=1;assert.throws(()=>aggregate(q,expected),/PART_SHARD/);
});
test('only fixed2or4 shard range accepted',()=>{
 assert.deepEqual(shard('1/2'),{current:1,total:2});
 for(const s of ['0/2','3/2','1/3','1/2;echo x','1/2 --grep',''])assert.throws(()=>shard(s));
});
test('reject unbound source nonhosted and bad ids',()=>{
 assert.throws(()=>context({...env,WSX_SMOKE_SOURCE_SHA:'main'},0,2));
 assert.throws(()=>context({...env,RUNNER_ENVIRONMENT:'self-hosted'},0,2));
 assert.throws(()=>context({...env,GITHUB_RUN_ATTEMPT:'0'},0,2));
});
test('depth and malformed report shape reject',()=>{
 assert.throws(()=>reduceReport(null,expected,'unused','host'),/REPORT_SHAPE/);
 const r=report(range(0,220),0);let x=r.suites[0];for(let n=0;n<70;n++){x.suites=[{specs:[]}];x=x.suites[0];}
 assert.throws(()=>reduceReport(r,expected,'unused','host'),/SUITE_DEPTH/);
});
test('raw titles provider bodies and attachments do not leave reducer',()=>{
 const r=report(range(0,220),0);const spec=r.suites[0].specs[0];spec.title='PRIVATE-MARKER';
 spec.tests[0].results[0].stdout=[{text:'PRIVATE-MARKER'}];spec.tests[0].results[0].attachments=[{body:'PRIVATE-MARKER'}];
 const v=reduceReport(r,expected,isolationLog(expected),'host');
 assert.equal(JSON.stringify(v).includes('PRIVATE-MARKER'),false);
});

import { runtimeArgs, assertRuntimeCommand } from './ci-fullstack-runtime.mjs';
const opts={root:'/repo',home:'/home/runner',tools:'/tmp/tools',uid:1000,gid:1000,
 image:'mcr.microsoft.com/playwright@sha256:'+'a'.repeat(64),node:'/bin/node',pnpm:'/pnpm',
 docker:'/bin/docker',compose:'/plugin/compose',unzip:'/bin/unzip',socketGid:999};
test('runtime preserves exact fixed command and scopes opt-in seed',()=>{
 assertRuntimeCommand('shard',['--','pnpm','run','verify:fullstack-smoke:shard']);
 assert.throws(()=>assertRuntimeCommand('shard',['--','pnpm','run','verify:fullstack-smoke:raw','--grep','one']));
 const e={GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',WSX_SMOKE_BENCHMARK:'1',RUNNER_ENVIRONMENT:'github-hosted',WSX_SMOKE_SOURCE_SHA:source,
  WSX_SMOKE_SHARD:'1/2',WORKSPACEX_ISOLATION_SEED:'ci-smoke-123-1-1',SECRET:'never'};
 const args=runtimeArgs({...opts,env:e,shard:true});
 assert.ok(args.includes('WSX_SMOKE_SHARD=1/2'));assert.ok(args.includes('WORKSPACEX_ISOLATION_SEED=ci-smoke-123-1-1'));
 assert.equal(args.join(' ').includes('never'),false);
 assert.throws(()=>runtimeArgs({...opts,env:{...e,WORKSPACEX_ISOLATION_SEED:'foreign'},shard:true}),/SMOKE_SEED_SCOPE/);
 assert.throws(()=>runtimeArgs({...opts,env:{...e,WSX_SMOKE_SHARD:'3/2'},shard:true}),/SMOKE_SHARD_SCOPE/);
});
test('canonical nonbenchmark seed behavior stays unchanged',()=>{
 const args=runtimeArgs({...opts,env:{WORKSPACEX_ISOLATION_SEED:'ordinary-existing-seed'}});
 assert.equal(args.some(x=>x.includes('WORKSPACEX_ISOLATION_SEED=')),false);
});

test('nested describe groups at same source location remain different cases',()=>{
 const r=report([80],0);const spec=r.suites[0].specs[0];
 r.suites=[{title:'group-one',specs:[spec]},{title:'group-two',specs:[structuredClone(spec)]}];r.stats.expected=2;
 const v=reduceReport(r,expected,isolationLog(expected),'host');
 assert.notEqual(v.records[0].id,v.records[1].id);
});

test('canonical wrapper derivation binds seed worktree and all three resources',()=>{
 const d=expectedIsolation(expected.isolationSeed);
 assert.notEqual(d.id,expected.isolationSeed);
 assert.match(d.id,/^ci-smoke-123-1-0-[a-f0-9]{12}$/);
 assert.match(d.database,/^wsx_[a-f0-9]{20}$/);
 assert.equal(d.composeProject,'wsx-'+d.database.slice(4));
 assert.notDeepEqual(expectedIsolation(expected.isolationSeed,'/different-worktree'),d);
 for(const key of ['id','database','composeProject']) {
  const wrong={...d,[key]:'foreign'};
  assert.throws(()=>reduceReport(report(range(0,220),0),expected,
   '[test-isolation] id='+wrong.id+' db='+wrong.database+' compose='+wrong.composeProject,'host'),/ISOLATION_OBSERVATION/);
 }
 assert.throws(()=>reduceReport(report(range(0,220),0),expected,
  '[test-isolation] id='+expected.isolationSeed+' db='+d.database+' compose='+d.composeProject,'host'),/ISOLATION_OBSERVATION/);
});

test('failure diagnostics preserve retries with fixed enums and hashed identities',()=>{
 const r=report([80],0);const v=r.suites[0].specs[0].tests[0];
 v.status='flaky';v.results.unshift({...v.results[0],status:'failed'});v.results[1].retry=1;
 const d=safeFailureSummary(r);assert.equal(d.testCount,1);assert.equal(d.nonFirstPassCount,1);
 assert.equal(d.cases[0].status,'flaky');assert.equal(d.cases[0].attemptCount,2);
 assert.match(d.cases[0].fileSha256,/^[a-f0-9]{64}$/);
 assert.deepEqual(d.cases[0].attempts.map(x=>x.status),['failed','passed']);
});
test('diagnostics exclude headers tokens titles errors bodies attachments and raw names',()=>{
 const r=report([80],0),p=r.suites[0].specs[0],v=p.tests[0];
 p.title='PRIVATE-MARKER';p.file='PRIVATE-MARKER';v.projectName='PRIVATE-MARKER';v.status='PRIVATE-MARKER';
 v.expectedStatus='PRIVATE-MARKER';v.results[0].status='PRIVATE-MARKER';
 v.results[0].errors=[{message:'PRIVATE-MARKER'}];v.results[0].headers={Authorization:'PRIVATE-MARKER'};
 v.results[0].attachments=[{body:'PRIVATE-MARKER'}];v.results[0].stdout=[{text:'PRIVATE-MARKER'}];
 r.errors=[{message:'PRIVATE-MARKER'}];
 assert.equal(JSON.stringify(safeFailureSummary(r)).includes('PRIVATE-MARKER'),false);
 assert.equal(safeFailureSummary(r).cases[0].status,'unknown');
});
test('failure summary bounds collection depth case rows attempts and malformed numbers',()=>{
 const r=report(range(80,180),0);for(const p of r.suites[0].specs)p.tests[0].status='unexpected';
 const d=safeFailureSummary(r);assert.equal(d.nonFirstPassCount,100);assert.equal(d.cases.length,20);assert.equal(d.truncated,true);
 const p=r.suites[0].specs[0];p.line='PRIVATE-MARKER';p.tests[0].results[0].duration=Infinity;
 assert.equal(safeFailureSummary(r).cases[0].line,null);
 let x=r.suites[0];for(let n=0;n<70;n++){x.suites=[{specs:[]}];x=x.suites[0];}
 assert.equal(safeFailureSummary(r).truncated,true);assert.equal(safeFailureSummary(null).truncated,true);
});
