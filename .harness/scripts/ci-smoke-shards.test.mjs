import test from 'node:test';
import assert from 'node:assert/strict';
import { context, shard, reduceReport, aggregate } from './ci-smoke-shards.mjs';
const source='a'.repeat(40);
const env={WSX_SMOKE_SOURCE_SHA:source,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',RUNNER_ENVIRONMENT:'github-hosted'};
function report(ids, part) {
  return {config:{shard:part?{current:part,total:2}:null},errors:[],stats:{startTime:'2026-10-18T00:00:00Z',duration:1000,expected:ids.length,unexpected:0,skipped:0,flaky:0},
    suites:[{specs:ids.map(i=>({title:'case-'+i,file:'e2e/case-'+i+'.spec.ts',line:i+1,column:1,
      tests:[{projectName:i<80?'seeded':'seeded-github-import',expectedStatus:'passed',status:'expected',
        results:[{status:'passed',retry:0,duration:1,startTime:'2026-10-18T00:00:00Z'}]}]}))}]};
}
const range=(a,b)=>Array.from({length:b-a},(_,i)=>a+i);
function part(ids,n) {const m=context(env,n,2);return reduceReport(report(ids,n),m,'[test-isolation] id='+m.isolationSeed+' db=db'+n+' compose=stack'+n,'host'+n);}
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
 const v=reduceReport(r,expected,'[test-isolation] id='+expected.isolationSeed+' db=db compose=stack','host');
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
 const v=reduceReport(r,expected,'[test-isolation] id='+expected.isolationSeed+' db=db compose=stack','host');
 assert.notEqual(v.records[0].id,v.records[1].id);
});
