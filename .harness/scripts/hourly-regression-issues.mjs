import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const repo = 'boardx/workspacex';
const path = '.github/workflows/harness-acceptance.yml';
const bad = new Set(['failure','timed_out','cancelled','startup_failure','action_required','stale']);
const labels = ['bug','source:hourly-regression','大规模测试发现'];
export function validateRun(r, event, workflow) {
 if (r.repository?.full_name !== repo || r.head_repository?.full_name !== repo || r.event !== 'schedule' || r.head_branch !== 'develop' || !/^[a-f0-9]{40}$/.test(r.head_sha) || r.status !== 'completed' || r.id !== event.id || r.run_attempt !== event.run_attempt || !Number.isSafeInteger(r.run_attempt) || r.run_attempt < 1 || r.path !== path || workflow.path !== path || workflow.state !== 'active' || workflow.id !== r.workflow_id) throw new Error('Hourly regression provenance validation failed');
}
export function failureGroups(jobs,r) {
 for(const j of jobs) if(j.run_id !== r.id || (j.run_attempt !== r.run_attempt) || j.status !== 'completed' || (!Number.isSafeInteger(j.id) || j.id < 1) || j.head_sha !== r.head_sha || typeof j.name !== 'string') throw new Error('Invalid or incomplete attempt jobs');
 const failures=jobs.filter(j=>bad.has(j.conclusion)).map(j=>({name:j.name,type:j.conclusion,url:`https://github.com/${repo}/actions/runs/${r.id}/job/${j.id}`}));
 return failures.length ? failures : [{name:'unknown workflow failure',type:r.conclusion,url:`https://github.com/${repo}/actions/runs/${r.id}`}];
}
export async function report(event, request) {
 const base=`/repos/${repo}`;
 const r=await request('GET',`${base}/actions/runs/${event.id}`);
 const workflow=await request('GET',`${base}/actions/workflows/harness-acceptance.yml`);
 validateRun(r,event,workflow);
 if(!bad.has(r.conclusion)) return {reported:false};
 async function pages(url,key) {
  const all=[];
  for(let page=1;page<=20;page++) {
   const result=await request('GET',`${url}${url.includes('?')?'&':'?'}per_page=100&page=${page}`);
   const items=key?result[key]:result;
   if(!Array.isArray(items)) throw new Error('Invalid pagination response');
   all.push(...items);
   if(items.length<100) {
    if(key && result.total_count !== all.length) throw new Error('Incomplete pagination');
    return all;
   }
  }
  throw new Error('Pagination safety limit exceeded');
 }
 async function fresh() {
  const latest=await request('GET',`${base}/actions/runs/${event.id}`);
  const active=await request('GET',`${base}/actions/workflows/harness-acceptance.yml`);
  validateRun(latest,event,active);
  if(latest.head_sha !== r.head_sha || latest.conclusion !== r.conclusion || latest.workflow_id !== r.workflow_id) throw new Error('Run changed during reporting');
 }
 const jobs=await pages(`${base}/actions/runs/${r.id}/attempts/${r.run_attempt}/jobs`,'jobs');
 const groups=failureGroups(jobs,r);
 const issues=await pages(`${base}/issues?state=open&labels=source%3Ahourly-regression`);
 for(const name of labels) {
  try { await request('GET',`${base}/labels/${encodeURIComponent(name)}`); }
  catch(e) { if(e.status!==404) throw e;
   try {await fresh(); await request('POST',`${base}/labels`,{name,color:'d73a4a'});} catch(createError) {if(createError.status!==422)throw createError; await request('GET',`${base}/labels/${encodeURIComponent(name)}`);}
  }
 }
 const seen=new Set();
 for(const g of groups) {
  const fingerprint=createHash('sha256').update(`hourly-regression:${g.name.normalize('NFKC').trim().replace(/\s+/g,' ')}`).digest('hex');
  if(seen.has(fingerprint))continue; seen.add(fingerprint);
  const marker=`<!-- hourly-regression:${fingerprint} -->`;
  const occurrence=`<!-- hourly-regression-run:${r.id}:${r.run_attempt} -->`;
  const body=`${marker}\n${occurrence}\n大规模测试发现：合入后定时回归发现，尚未经人工分诊。\n\nTested SHA: \`${r.head_sha}\`\nRun: https://github.com/${repo}/actions/runs/${r.id}/attempts/${r.run_attempt}\nRun ID / attempt: ${r.id} / ${r.run_attempt}\nJob: ${g.name}\nJob link: ${g.url}\nFailure type: ${g.type}\nStarted: ${r.run_started_at ?? 'unknown'}\nUpdated: ${r.updated_at ?? 'unknown'}\n\nCI evidence only; no runtime-duration guarantee. Raw logs are intentionally omitted.`;
  const existing=issues.find(i=>!i.pull_request && i.body?.includes(marker));
  if(existing) {
   const comments=await pages(`${base}/issues/${existing.number}/comments`);
   if(!existing.body?.includes(occurrence) && !comments.some(c=>c.body?.includes(occurrence))) {await fresh(); await request('POST',`${base}/issues/${existing.number}/comments`,{body});}
  } else {
   await fresh();
   const created=await request('POST',`${base}/issues`,{title:`[大规模回归] ${g.name.replace(/[\r\n]/g,' ').slice(0,180)}`,body,labels});
   issues.push(created);
  }
 }
 return {reported:true};
}
export function rest(token, fetcher=fetch) {
 return async(method,url,body)=>{
  const response=await fetcher(`https://api.github.com${url}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  if(!response.ok) {const error=new Error(`GitHub API ${method} failed (${response.status})`);error.status=response.status;throw error;}
  return response.json();
 };
}
async function main() {
 try {
  if(!process.env.GH_TOKEN)throw new Error('GH_TOKEN required');
  const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
  if(event.repository?.full_name!==repo || event.workflow_run?.event!=='schedule')throw new Error('Unexpected workflow event');
  console.log(JSON.stringify(await report(event.workflow_run,rest(process.env.GH_TOKEN))));
 } catch(error) {console.error(error.message);process.exitCode=1;}
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) void main();
