import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { coverageFromLog, completeBatchVerdicts, findExactBatch, HEAVY_LANES } from './board-heavy-batch.mjs';
const sha='a'.repeat(40), other='b'.repeat(40);
const source={id:10,run_attempt:1,workflow_id:7,head_branch:'main',event:'push',html_url:'https://github.com/o/r/actions/runs/10'};
const jobs=Object.entries(HEAVY_LANES).map(([name,spec])=>({name,status:'completed',conclusion:'success',steps:[...spec.execute,spec.upload].map(name=>({name,status:'completed',conclusion:'success'}))}));
const artifacts=[{id:50,name:'board-heavy-batch-10-1',expired:false},...Object.values(HEAVY_LANES).map(spec=>({name:`${spec.artifact}10-1`,expired:false}))];
const manifest={schemaVersion:1,sha,runId:10,runAttempt:1,source:null};
function apiFor(overrides:Record<string,unknown>={}){
 const data:Record<string,unknown>={
 '/actions/runs/20':{workflow_id:7},
 '/actions/workflows/7/runs?per_page=50&page=1':{workflow_runs:[source]},
 '/actions/runs/10/artifacts?per_page=100&page=1':{total_count:artifacts.length,artifacts},
 '/actions/runs/10/jobs?filter=latest&per_page=100&page=1':{total_count:jobs.length,jobs},...overrides};
 return async(path:string)=>{if(!(path in data))throw new Error(`Unexpected ${path}`);return data[path];};
}
const lookup=(overrides:Record<string,unknown>={},batch=manifest)=>findExactBatch({api:apiFor(overrides),readManifest:async()=>batch,sha,runId:20});
describe('heavy batch immutable evidence',()=>{
 it('records merge/squash PR coverage and unassociated commits explicitly',()=>{
  expect(coverageFromLog(`${sha} Squash subject (#123)\n${other} Merge pull request #124 from o/branch\n${sha} initial`)).toEqual([{sha,pullRequest:123},{sha:other,pullRequest:124},{sha,pullRequest:null}]);
 });
 it('reuses only exact SHA complete original batch',async()=>{expect(await lookup()).toMatchObject({runId:10,verdicts:{'native-board':'success','meeting-room':'success'}});});
 it('never uses a different SHA or reuses an observation',async()=>{
  expect(await lookup({}, {...manifest,sha:other})).toBeNull();
  expect(await lookup({}, {...manifest,source:{runId:9}})).toBeNull();
 });
 it('rejects forged manifest run/attempt identity',async()=>{
  await expect(lookup({}, {...manifest,runId:9})).rejects.toThrow('identity');
  await expect(lookup({}, {...manifest,runAttempt:2})).rejects.toThrow('identity');
 });
 it('preserves actual functional failure even if job says success',async()=>{
  const failed=structuredClone(jobs);failed[0].steps[0].conclusion='failure';
  expect(await lookup({'/actions/runs/10/jobs?filter=latest&per_page=100&page=1':{total_count:2,jobs:failed}})).toMatchObject({verdicts:{'native-board':'failure'}});
 });
 it.each(['skipped','cancelled','timed_out',null])('never reuses incomplete execution %s',conclusion=>{
  const failed=structuredClone(jobs);failed[0].steps[0].conclusion=conclusion;
  expect(completeBatchVerdicts(failed,artifacts,source)).toBeNull();
 });
 it('newest incomplete actual attempt invalidates older green',async()=>{
  const newer={...source,id:15};
  const data={
   '/actions/workflows/7/runs?per_page=50&page=1':{workflow_runs:[source,newer]},
   '/actions/runs/15/artifacts?per_page=100&page=1':{total_count:1,artifacts:[{id:51,name:'board-heavy-batch-15-1',expired:false}]},
   '/actions/runs/15/jobs?filter=latest&per_page=100&page=1':{total_count:0,jobs:[]},
  };
  expect(await findExactBatch({api:apiFor(data),readManifest:async()=>({...manifest,runId:15}),sha,runId:20})).toBeNull();
 });
 it('never falls back to older green when newest manifest is absent or expired',async()=>{
  const newer={...source,id:15};
  for(const latestArtifacts of [[],[{id:51,name:'board-heavy-batch-15-1',expired:true}]]){
   const data={
    '/actions/workflows/7/runs?per_page=50&page=1':{workflow_runs:[source,newer]},
    '/actions/runs/15/artifacts?per_page=100&page=1':{total_count:latestArtifacts.length,artifacts:latestArtifacts},
   };
   expect(await lookup(data)).toBeNull();
  }
 });
 it('ignores branch-manual producers',async()=>{
  expect(await lookup({'/actions/workflows/7/runs?per_page=50&page=1':{workflow_runs:[{...source,head_branch:'untrusted'}]}})).toBeNull();
 });
 it('expired evidence means fresh measurement; unreadable API fails closed',async()=>{
  expect(completeBatchVerdicts(jobs,artifacts.map(a=>({...a,expired:true})),source)).toBeNull();
  await expect(findExactBatch({api:async()=>{throw new Error('403');},sha,runId:20})).rejects.toThrow('403');
 });
});
describe('existing Board workflow admission and verdict preservation',()=>{
 const heavy=parse(readFileSync(new URL('../../.github/workflows/board-native-acceptance.yml',import.meta.url),'utf8'));
 const fast=parse(readFileSync(new URL('../../.github/workflows/board-acceptance.yml',import.meta.url),'utf8'));
 it('keeps push main/manual, single latest pending, never cancels running batch',()=>{
  expect(heavy.on.pull_request).toBeUndefined();expect(heavy.on.push.branches).toEqual(['main']);
  expect(heavy.concurrency).toEqual({group:'board-heavy-main','cancel-in-progress':false});
  expect(heavy.on.schedule).toBeUndefined();expect(fast.on.schedule).toBeUndefined();
  expect(fast.jobs['meeting-room']).toBeUndefined();
  expect(Object.keys(fast.jobs)).toEqual(['scope','journeys','security','board-ui-functional','visual-deferred','storage','import','import-captured','api-ws-objectstore','performance','collaboration-50']);
  for(const lane of ['journeys','security','board-ui-functional','storage','import','api-ws-objectstore'])expect(fast.jobs[lane].if).toBe("needs.scope.outputs.board == 'true'");
 });
 it.each(Object.keys(HEAVY_LANES))('%s checks out frozen SHA and guards every heavy step; reused failure is a real failure',lane=>{
  const job=heavy.jobs[lane];expect(job.needs).toBe('batch');
  expect(job.steps[0].with.ref).toBe('${{ needs.batch.outputs.sha }}');
  for(const step of job.steps.slice(0,-1))expect(step.if).toContain("needs.batch.outputs.run == 'true'");
  expect(job.steps.at(-1).if).toBe("always() && needs.batch.outputs.run == 'false'");
  expect(job.steps.at(-1).run).toBe('test "$ORIGINAL_RESULT" = success');
  expect(JSON.stringify(job)).not.toContain('continue-on-error');
 });
});
