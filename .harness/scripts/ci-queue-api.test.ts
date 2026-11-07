import {test} from 'vitest';
import assert from 'node:assert/strict';
import {waitForProducer,exactArtifacts,assertDiscovery} from './ci-queue-api.mjs';
const sha='a'.repeat(40);
const run={id:12,run_attempt:2,workflow_id:9,path:'.github/workflows/harness-acceptance.yml',head_sha:sha,head_branch:'gh-readonly-queue/develop/pr-1-abcdef0',event:'merge_group',created_at:'2026-11-05T00:00:00Z',status:'in_progress',conclusion:null};
const names=['base-api-plan','base-api-shards (1)','base-api-shards (2)','base-api-exclusive'];
function apiFor(change={}) {return async path=> {
 if(path.includes('/workflows/harness'))return {id:9,path:run.path,state:'active'};
 if(path.includes('/runs?'))return {total_count:1,workflow_runs:[{...run,...change}]};
 if(path.includes('/jobs?'))return {total_count:4,jobs:names.map(name=>({name,run_id:12,run_attempt:2,head_sha:sha,status:'completed',conclusion:'success'}))};
 return {...run,...change};
};}
test('accepts only completed successful API jobs in live exact queue attempt',async()=>{
 assert.equal((await waitForProducer({apiFactory:()=>apiFor(),sha,count:2})).run_attempt,2);
 for(const change of [{head_sha:'b'.repeat(40)},{conclusion:'cancelled',status:'completed'},{conclusion:'failure',status:'completed'},{run_attempt:3}]) await assert.rejects(waitForProducer({apiFactory:()=>apiFor(change),sha,count:2}));
});
test('bounded wait never accepts an absent producer',async()=>{
 let now=0;
 const api=async path=>path.includes('/runs?')?{total_count:0,workflow_runs:[]}:{id:9,path:run.path,state:'active'};
 await assert.rejects(waitForProducer({apiFactory:()=>api,sha,count:2,clock:()=>now,sleep:async ms=>{now+=ms;},budgetMs:20}),/TIMEOUT/);
});
test('artifact selection rejects old attempts, missing, duplicate and expired parts',()=>{
 const plan={shards:[1,2]};
 const rows=['coverage','shard-1','shard-2','exclusive'].map(part=>({name:`base-api-${part}-12-2`,expired:false}));
 assert.equal(exactArtifacts(rows,plan,run).length,4);
 for(const bad of [rows.slice(1),[...rows,rows[0]],rows.map(r=>({...r,name:r.name.replace('-12-2','-12-1')})),rows.map(r=>({...r,expired:true}))])assert.throws(()=>exactArtifacts(bad,plan,run));
});
test('discovery comparison includes complete partitions, project identities and exclusive files',()=>{
 const coverage={partitions:[[{file:'a',projectName:''}]],exclusive:[{file:'e',projectName:''}],counts:[1],files:1,shards:1,discoverySha256:'x',schemaVersion:1,status:'discovery-coverage-verified'};
 assert.doesNotThrow(()=>assertDiscovery(coverage,coverage));
 for(const bad of [{...coverage,files:2},{...coverage,exclusive:[]},{...coverage,partitions:[[{file:'b'}]]}])assert.throws(()=>assertDiscovery(bad,coverage));
});

test('workflow executes queue API once and preserves all nonqueue backend shards',async()=>{
 const {readFileSync}=await import('node:fs');const {parse}=await import('yaml');
 const backend=parse(readFileSync('.github/workflows/backend-gates.yml','utf8'));
 const acceptance=parse(readFileSync('.github/workflows/harness-acceptance.yml','utf8'));
 const job=backend.jobs['gates-test'];
 assert.match(job.strategy.matrix.shard,/merge_group.*\[1\].*api-test-plan.outputs.shards/);
 const consumer=job.steps.find(step=>step.name==='Verify sole queue API producer');assert.equal(consumer.if,"github.event_name == 'merge_group'");
 for(const step of job.steps.filter(s=>s.run?.includes('vitest run')||s.run?.includes('docker compose')||s.run?.includes('uv sync')))assert.match(step.if,/github.event_name != 'merge_group'/);
 for(const name of ['base-api-plan','base-api-shards','base-api-exclusive'])assert.match(acceptance.jobs[name].if,/github.event_name == 'merge_group' \|\| needs.doc-smoke-scope.outputs.mode/);
});

test('targeted queue routing requires API producers successful, preserving nonqueue skips',async()=>{
 const {requireRoute}=await import('./ci-targeted-routing.mjs');
 const names=['base-compile','base-api-plan','base-api-shards','base-api-exclusive','base-package-tests','base-control-plane','web-test-plan','web-test-shards','targeted-ui-unit','targeted-ui-browser'];
 const needs: Record<string,{result:string;outputs?:Record<string,string>}>=Object.fromEntries(names.map(name=>[name,{result:['base-package-tests','web-test-plan','web-test-shards'].includes(name)?'skipped':'success'}]));
 needs['doc-smoke-scope']={result:'success',outputs:{mode:'targeted-ui',plan_digest:'a'.repeat(64)}};
 assert.doesNotThrow(()=>requireRoute('base',needs,'merge_group'));
 assert.throws(()=>requireRoute('base',needs,'pull_request'));
 needs['base-api-shards'].result='skipped';assert.throws(()=>requireRoute('base',needs,'merge_group'));
});
