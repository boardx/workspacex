import { test } from 'vitest';
import assert from 'node:assert/strict';
import { validateRun, failureGroups } from './hourly-regression-issues.mjs';
const run = {id:1,run_attempt:1,event:'schedule',head_branch:'develop',head_sha:'a'.repeat(40),status:'completed',conclusion:'failure',path:'.github/workflows/harness-acceptance.yml',workflow_id:7,repository:{full_name:'boardx/workspacex'},head_repository:{full_name:'boardx/workspacex'}};
test('rejects invalid provenance and incomplete run metadata',()=>{
 assert.doesNotThrow(()=>validateRun(run,{id:1,run_attempt:1}, {id:7,path:run.path,state:'active'}));
 for(const patch of [{event:'push'},{head_branch:'main'},{head_sha:'x'},{run_attempt:2},{repository:{full_name:'evil/repo'}},{path:'other'},{status:'in_progress'}]) assert.throws(()=>validateRun({...run,...patch},{id:1,run_attempt:1},{id:7,path:run.path,state:'active'}));
});
test('jobs must belong to exact completed attempt; unknown failure remains explicit',()=>{
 assert.throws(()=>failureGroups([{id:2,run_id:99,status:'completed',conclusion:'failure',name:'test'}],run));
 assert.equal(failureGroups([],run)[0].name,'unknown workflow failure');
 assert.equal(failureGroups([{id:2,run_id:1,head_sha:run.head_sha,run_attempt:1,status:'completed',conclusion:'failure',name:'test $(touch /tmp/no)'}],run)[0].name,'test $(touch /tmp/no)');
});
test('creates once, comments once per repeated run, and fails closed on partial jobs',async()=>{
 const {report}=await import('./hourly-regression-issues.mjs');
 const issues:any[]=[];const comments:any[]=[];let partial=false;let current={...run};
 const request=async(method:string,url:string,body?:any):Promise<any>=>{
  if(url.endsWith('/actions/runs/1'))return current;
  if(url.endsWith('/actions/workflows/harness-acceptance.yml'))return {id:7,path:run.path,state:'active'};
  if(url.includes('/jobs?'))return {total_count:partial?2:1,jobs:[{id:2,run_id:1,head_sha:run.head_sha,run_attempt:current.run_attempt,status:'completed',conclusion:'failure',name:'test'}]};
  if(url.includes('/labels/'))return {};
  if(url.includes('/comments')) {if(method==='POST'){comments.push(body);return body;}return comments;}
  if(method==='POST'&&url.endsWith('/issues')){const issue={...body,number:5};issues.push(issue);return issue;}
  if(url.includes('/issues?'))return issues;
  throw Error(`Unexpected ${method} ${url}`);
 };
 await report(current,request);await report(current,request);assert.equal(issues.length,1);assert.equal(comments.length,0);
 current={...current,run_attempt:2};await report(current,request);await report(current,request);assert.equal(comments.length,1);
 partial=true;await assert.rejects(report(current,request),/Incomplete pagination/);assert.equal(comments.length,1);
});
test('rejects missing attempt, foreign SHA, and nonpositive job IDs',()=>{
 const job={id:2,run_id:1,run_attempt:1,head_sha:run.head_sha,status:'completed',conclusion:'failure',name:'x'};
 for(const patch of [{run_attempt:undefined},{head_sha:'b'.repeat(40)},{id:0},{id:-1}])assert.throws(()=>failureGroups([{...job,...patch}],run));
});
test('rerun during jobs, issue lookup, or comment lookup prevents mutation',async()=>{
 const {report}=await import('./hourly-regression-issues.mjs');
 for(const race of ['jobs','issues','comments']) {
  let changed=false;let writes=0;let issue:any;
  const req=async(method:string,url:string,body?:any):Promise<any>=>{
   if(method==='POST'){writes++;issue={...body,number:1};return issue;}
   if(url.endsWith('/actions/runs/1'))return {...run,run_attempt:changed?2:1};
   if(url.includes('/actions/workflows/'))return {id:7,path:run.path,state:'active'};
   if(url.includes('/jobs?')){if(race==='jobs')changed=true;return {total_count:1,jobs:[{id:2,run_id:1,run_attempt:1,head_sha:run.head_sha,status:'completed',conclusion:'failure',name:'x'}]};}
   if(url.includes('/labels/'))return {};
   if(url.includes('/comments')){changed=true;return [];}
   if(url.includes('/issues?')){if(race==='issues')changed=true;return issue?[{...issue,body:issue.body.replace(/<!-- hourly-regression-run:.*?-->/,'')}]:[];}
   throw Error(url);
  };
  if(race==='comments'){await report(run,req);writes=0;}
  await assert.rejects(report(run,req),/provenance/);assert.equal(writes,0);
 }
});
test('REST 403 is fatal with no retry and structured injection text stays data',async()=>{
 const {rest}=await import('./hourly-regression-issues.mjs');let calls=0;
 const api=rest('secret',async(_url:any,options:any)=>{calls++;assert.equal(JSON.parse(options.body).name,'$(touch /tmp/no)');return {ok:false,status:403} as any;});
 await assert.rejects(api('POST','/repos/boardx/workspacex/labels',{name:'$(touch /tmp/no)'}),/403/);assert.equal(calls,1);
});
test('two job pages complete before writes; label 422 race requires verification',async()=>{
 const {report}=await import('./hourly-regression-issues.mjs');let second=false;let created=false;let verified=false;let writes=0;
 const req=async(method:string,url:string,body?:any):Promise<any>=>{
  if(url.endsWith('/actions/runs/1'))return run;
  if(url.includes('/actions/workflows/'))return {id:7,path:run.path,state:'active'};
  if(url.includes('/jobs?')){const page=url.endsWith('page=2');if(page)second=true;return {total_count:101,jobs:Array.from({length:page?1:100},(_,i)=>({id:(page?101:i+1),run_id:1,run_attempt:1,head_sha:run.head_sha,status:'completed',conclusion:i===0?'failure':'success',name:'same'}))};}
  if(url.includes('/issues?'))return [];
  if(url.includes('/labels/')){if(!created)throw Object.assign(Error('missing'),{status:404});verified=true;return {};}
  if(url.endsWith('/labels')&&method==='POST'){assert.ok(second);created=true;throw Object.assign(Error('exists'),{status:422});}
  if(url.endsWith('/issues')&&method==='POST'){assert.ok(second&&verified);writes++;return {...body,number:1};}
  throw Error(url);
 };
 await report(run,req);assert.equal(writes,1);
});
