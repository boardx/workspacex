import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { coverageFromLog, completeBatchVerdicts, findExactBatch, HEAVY_LANES } from './board-heavy-batch.mjs';
const sha='a'.repeat(40), other='b'.repeat(40);
const source={id:10,run_attempt:1,workflow_id:7,head_branch:'main',head_sha:sha,run_started_at:'2026-10-04T09:00:00Z',event:'push',html_url:'https://github.com/o/r/actions/runs/10'};
const jobs=Object.entries(HEAVY_LANES).map(([name,spec])=>({name,status:'completed',conclusion:'success',steps:[...spec.execute,spec.upload].map(name=>({name,status:'completed',conclusion:'success'}))}));
const artifacts=[{id:50,name:'board-heavy-batch-10-1',expired:false},...Object.values(HEAVY_LANES).map(spec=>({name:`${spec.artifact}10-1`,expired:false}))];
const manifest={schemaVersion:1,sha,runId:10,runAttempt:1,source:null};
function apiFor(overrides:Record<string,unknown>={}){
 const data:Record<string,unknown>={
 '/actions/runs/20':{workflow_id:7},
 [`/actions/workflows/7/runs?head_sha=${sha}&per_page=100&page=1`]:{total_count:1,workflow_runs:[source]},
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
  await expect(lookup({}, {...manifest,sha:other})).rejects.toThrow('manifest identity');
  expect(await lookup({}, {...manifest,source:{runId:9}})).toBeNull();
 });
 it('queued workflow A cannot attest or reuse B even when execution step names are identical',async()=>{
  const queuedA={...source,head_sha:other};
  const data={[`/actions/workflows/7/runs?head_sha=${sha}&per_page=100&page=1`]:{total_count:1,workflow_runs:[queuedA]}};
  // Jobs retain the same names, but their workflow definition came from A, not B.
  expect(await lookup(data,manifest)).toBeNull();
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
  const newer={...source,id:15,run_started_at:'2026-10-04T09:01:00Z'};
  const data={
   [`/actions/workflows/7/runs?head_sha=${sha}&per_page=100&page=1`]:{total_count:2,workflow_runs:[source,newer]},
   '/actions/runs/15/artifacts?per_page=100&page=1':{total_count:1,artifacts:[{id:51,name:'board-heavy-batch-15-1',expired:false}]},
   '/actions/runs/15/jobs?filter=latest&per_page=100&page=1':{total_count:0,jobs:[]},
  };
  expect(await findExactBatch({api:apiFor(data),readManifest:async()=>({...manifest,runId:15}),sha,runId:20})).toBeNull();
 });
 it.each(['failure','incomplete'])('old run ID with a newer %s attempt invalidates a newer-ID old green',async result=>{
  const oldRerun={...source,run_attempt:2};
  const oldGreen={...source,id:15,run_started_at:'2026-10-04T09:00:00Z'};
  const rerunJobs=structuredClone(jobs);
  rerunJobs[0].steps[0].conclusion='failure';rerunJobs[0].conclusion='failure';
  const rerunArtifacts=artifacts.map(a=>({...a,name:a.name.replace('10-1','10-2')}));
  const data={
   [`/actions/workflows/7/runs?head_sha=${sha}&per_page=100&page=1`]:{total_count:2,workflow_runs:[oldGreen,oldRerun]},
   '/actions/runs/10/attempts/2':{...oldRerun,run_started_at:'2026-10-04T10:00:00Z'},
   '/actions/runs/10/artifacts?per_page=100&page=1':{total_count:rerunArtifacts.length,artifacts:rerunArtifacts},
   '/actions/runs/10/jobs?filter=latest&per_page=100&page=1':{total_count:result==='failure'?2:0,jobs:result==='failure'?rerunJobs:[]},
  };
  const got=await findExactBatch({api:apiFor(data),readManifest:async()=>({...manifest,runAttempt:2}),sha,runId:20});
  if(result==='incomplete')expect(got).toBeNull();else expect(got).toMatchObject({runId:10,verdicts:{'native-board':'failure'}});
 });
 it('finds a late old-ID failed rerun beyond the first history page for the exact SHA',async()=>{
  const firstPage=Array.from({length:100},(_,i)=>({...source,id:30+i}));
  const oldRerun={...source,run_attempt:2};
  const failed=structuredClone(jobs);failed[1].steps[0].conclusion='failure';failed[1].conclusion='failure';
  const rerunArtifacts=artifacts.map(a=>({...a,name:a.name.replace('10-1','10-2')}));
  const data={
   [`/actions/workflows/7/runs?head_sha=${sha}&per_page=100&page=1`]:{total_count:101,workflow_runs:firstPage},
   [`/actions/workflows/7/runs?head_sha=${sha}&per_page=100&page=2`]:{total_count:101,workflow_runs:[oldRerun]},
   '/actions/runs/10/attempts/2':{...oldRerun,run_started_at:'2026-10-04T10:00:00Z'},
   '/actions/runs/10/artifacts?per_page=100&page=1':{total_count:rerunArtifacts.length,artifacts:rerunArtifacts},
   '/actions/runs/10/jobs?filter=latest&per_page=100&page=1':{total_count:2,jobs:failed},
  };
  expect(await findExactBatch({api:apiFor(data),readManifest:async()=>({...manifest,runAttempt:2}),sha,runId:20})).toMatchObject({runId:10,verdicts:{'meeting-room':'failure'}});
 });
 it('bounded incomplete same-SHA history cannot authorize reuse',async()=>{
  const api=async(path:string)=>path==='/actions/runs/20'?{workflow_id:7}:{total_count:1001,workflow_runs:Array.from({length:100},()=>source)};
  await expect(findExactBatch({api,readManifest:async()=>manifest,sha,runId:20})).rejects.toThrow('Incomplete batch history');
 });
 it('never falls back to older green when newest manifest is absent or expired',async()=>{
  const newer={...source,id:15,run_started_at:'2026-10-04T09:01:00Z'};
  for(const latestArtifacts of [[],[{id:51,name:'board-heavy-batch-15-1',expired:true}]]){
   const data={
    [`/actions/workflows/7/runs?head_sha=${sha}&per_page=100&page=1`]:{total_count:2,workflow_runs:[source,newer]},
    '/actions/runs/15/artifacts?per_page=100&page=1':{total_count:latestArtifacts.length,artifacts:latestArtifacts},
   };
   expect(await lookup(data)).toBeNull();
  }
 });
 it('ambiguous equal attempt timestamps request fresh measurement rather than choosing a green ID',async()=>{
  expect(await lookup({[`/actions/workflows/7/runs?head_sha=${sha}&per_page=100&page=1`]:{total_count:2,workflow_runs:[source,{...source,id:15}]}})).toBeNull();
 });
 it('ignores branch-manual producers',async()=>{
  expect(await lookup({[`/actions/workflows/7/runs?head_sha=${sha}&per_page=100&page=1`]:{total_count:1,workflow_runs:[{...source,head_branch:'untrusted'}]}})).toBeNull();
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
  expect(heavy.jobs.batch.steps[0].with.ref).toBe('${{ github.sha }}');
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
