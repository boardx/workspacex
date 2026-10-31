import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {expect,it,vi} from 'vitest';
import {supervise,watchedWorkflows,createGitHubApi} from './ci-fail-fast.mjs';
const run={id:10,workflow_id:20,run_attempt:1,name:'harness-acceptance',head_sha:'a'.repeat(40),head_branch:'develop',event:'push',repository:{id:30,full_name:'boardx/workspacex'},status:'in_progress'};
const event=()=>({action:'in_progress',repository:run.repository,workflow_run:{...run}});
const job=(conclusion='failure')=>({id:40,run_id:10,run_attempt:1,status:'completed',conclusion});
function fixture(){
 const read=vi.fn(async(path:string)=>path.includes('/jobs?')?{jobs:[job()]}:{...run});
 const write=vi.fn(async()=>({status:202})),wait=vi.fn(async()=>{});
 return {event:event(),repository:run.repository.full_name,read,write,wait};
}
it('cancels the exact failed workflow after rechecking its current attempt',async()=>{
 const f=fixture();expect(await supervise(f)).toMatchObject({status:'cancel_requested',runId:10,attempt:1,failedJobs:[{id:40,conclusion:'failure'}]});
 expect(f.read.mock.calls.map(x=>x[0])).toEqual(['repos/boardx/workspacex/actions/runs/10','repos/boardx/workspacex/actions/runs/10/attempts/1/jobs?per_page=100&page=1','repos/boardx/workspacex/actions/runs/10']);
 expect(f.write).toHaveBeenCalledTimes(1);expect(f.write).toHaveBeenCalledWith('repos/boardx/workspacex/actions/runs/10/cancel');
 expect(f.read).toHaveBeenNthCalledWith(3,'repos/boardx/workspacex/actions/runs/10',{fresh:true});
});
it.each(['success','skipped','neutral','cancelled'])('does not cancel on %s or treat it as a new failure',async conclusion=>{
 const f=fixture();let completed=false;f.read.mockImplementation(async path=>path.includes('/jobs?')?{jobs:[job(conclusion)]}:{...run,status:completed?'completed':'in_progress'});f.wait.mockImplementation(async()=>{completed=true;});
 expect(await supervise(f)).toMatchObject({status:'completed'});expect(f.write).not.toHaveBeenCalled();
});
it.each(['timed_out','startup_failure','action_required'])('stops on failed job conclusion %s',async conclusion=>{
 const f=fixture();f.read.mockImplementation(async path=>path.includes('/jobs?')?{jobs:[job(conclusion)]}:{...run});expect(await supervise(f)).toMatchObject({status:'cancel_requested'});
});
it('does not cancel a new attempt appearing just before cancellation',async()=>{
 const f=fixture();let reads=0;f.read.mockImplementation(async path=>path.includes('/jobs?')?{jobs:[job()]}:{...run,run_attempt:++reads===1?1:2});
 expect(await supervise(f)).toMatchObject({status:'superseded'});expect(f.write).not.toHaveBeenCalled();
});
it('handles completion racing a cancel request without retrying a new run',async()=>{
 const f=fixture();f.write.mockResolvedValue({status:409});let reads=0;f.read.mockImplementation(async path=>path.includes('/jobs?')?{jobs:[job()]}:{...run,status:++reads>2?'completed':'in_progress'});
 expect(await supervise(f)).toMatchObject({status:'completed'});expect(f.write).toHaveBeenCalledTimes(1);
});
it('fails visibly when cancellation is rejected while the run is still running',async()=>{
 const f=fixture();f.write.mockResolvedValue({status:409});await expect(supervise(f)).rejects.toThrow('CANCEL_REJECTED');
});
it('paginates attempts so a failure after the first hundred jobs is still observed',async()=>{
 const f=fixture();f.read.mockImplementation(async path=>path.includes('/jobs?')?{jobs:path.endsWith('page=1')?Array.from({length:100},()=>job('success')):[job()]}:{...run});
 expect(await supervise(f)).toMatchObject({status:'cancel_requested'});expect(f.read.mock.calls.some(x=>x[0].endsWith('page=2'))).toBe(true);
});
it.each(['repository','workflow','event','branch'])('rejects a foreign %s trigger before any API request',async kind=>{
 const f=fixture();if(kind==='repository')f.event.repository={id:50,full_name:'other/repo'};if(kind==='workflow')f.event.workflow_run.name='image-release';if(kind==='event')f.event.workflow_run.event='release';if(kind==='branch')f.event.workflow_run.head_branch='main';
 await expect(supervise(f)).rejects.toThrow();expect(f.read).not.toHaveBeenCalled();expect(f.write).not.toHaveBeenCalled();
});
it('rejects changed server identity and foreign jobs rather than cancelling them',async()=>{
 const f=fixture();f.read.mockResolvedValue({...run,head_sha:'b'.repeat(40)});await expect(supervise(f)).rejects.toThrow('TARGET_CHANGED');expect(f.write).not.toHaveBeenCalled();
 const g=fixture();g.read.mockImplementation(async path=>path.includes('/jobs?')?{jobs:[{...job(),run_id:99}]}:{...run});await expect(supervise(g)).rejects.toThrow('JOB_IDENTITY');expect(g.write).not.toHaveBeenCalled();
});
it('fails closed on API errors and bounds healthy polling',async()=>{
 const f=fixture();f.read.mockRejectedValue(Error('HTTP_403'));await expect(supervise(f)).rejects.toThrow('HTTP_403');expect(f.write).not.toHaveBeenCalled();
 const g=fixture();g.read.mockImplementation(async path=>path.includes('/jobs?')?{jobs:[]}:{...run});let now=0;g.wait.mockImplementation(async()=>{now+=10;});await expect(supervise({...g,now:()=>now,maxMs:20})).rejects.toThrow('MONITOR_TIMEOUT');expect(g.write).not.toHaveBeenCalled();
});
it('does not issue a late cancellation after its monitoring budget expires',async()=>{
 const f=fixture();let elapsed=0;f.read.mockImplementation(async path=>{if(path.includes('/jobs?')){elapsed=100;return {jobs:[job()]};}return {...run};});
 await expect(supervise({...f,now:()=>elapsed,maxMs:20})).rejects.toThrow('MONITOR_TIMEOUT');expect(f.write).not.toHaveBeenCalled();
});
it('executes only a trusted workflow revision with no candidate artifacts or installation',()=>{
 const w=parse(readFileSync('.github/workflows/ci-fail-fast.yml','utf8'));
 expect(w.on.workflow_run.workflows).toEqual(watchedWorkflows());expect(w.on.workflow_run.types).toEqual(['in_progress']);expect(w.permissions).toEqual({contents:'read',actions:'write'});
 const steps=w.jobs.supervise.steps;expect(steps[0].with).toEqual({ref:'${{ github.workflow_sha }}','persist-credentials':false});expect(steps).toHaveLength(2);
 expect(JSON.stringify(steps)).not.toMatch(/download-artifact|head_sha|head_branch|npm install|pnpm install/);expect(watchedWorkflows()).not.toContain(w.name);
 for(const file of ['harness-verify','harness-acceptance','backend-gates'])expect(watchedWorkflows()).toContain(parse(readFileSync(`.github/workflows/${file}.yml`,'utf8')).name);
});
it('uses conditional polling without letting callers mutate the cached snapshot',async()=>{
 const fetchImpl=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({run_attempt:1}),{headers:{etag:'"one"'}})).mockResolvedValueOnce(new Response(null,{status:304})).mockResolvedValueOnce(new Response(JSON.stringify({run_attempt:2}),{headers:{etag:'"two"'}}));
 const api=createGitHubApi({token:'test-token',fetchImpl}),path='repos/boardx/workspacex/actions/runs/10';
 const first=await api.read(path);first.run_attempt=99;
 expect(await api.read(path)).toEqual({run_attempt:1});expect(fetchImpl.mock.calls[1][1].headers['If-None-Match']).toBe('"one"');
 expect(await api.read(path,{fresh:true})).toEqual({run_attempt:2});expect(fetchImpl.mock.calls[2][1].headers['If-None-Match']).toBeUndefined();
 expect(fetchImpl.mock.calls[2][1].headers['Cache-Control']).toBe('no-cache');
 expect(fetchImpl.mock.calls[0][1]).toMatchObject({redirect:'error',headers:{Authorization:'Bearer test-token'}});
});
it('keeps cache entries scoped to the exact run/attempt/page endpoint',async()=>{
 const fetchImpl=vi.fn().mockResolvedValueOnce(new Response('{"jobs":[]}',{headers:{etag:'"page-one"'}})).mockResolvedValueOnce(new Response('{"jobs":[]}'));
 const api=createGitHubApi({token:'test-token',fetchImpl});await api.read('runs/10/attempts/1/jobs?page=1');await api.read('runs/10/attempts/2/jobs?page=1');
 expect(fetchImpl.mock.calls[1][1].headers['If-None-Match']).toBeUndefined();
});
it('rejects 304 without a reusable snapshot',async()=>{
 const fetchImpl=vi.fn().mockResolvedValue(new Response(null,{status:304})),api=createGitHubApi({token:'test-token',fetchImpl});
 await expect(api.read('run')).rejects.toThrow('UNEXPECTED_304');
});
it('rejects a cached 304 response during mandatory pre-cancel fresh reads',async()=>{
 const fetchImpl=vi.fn().mockResolvedValueOnce(new Response('{}',{headers:{etag:'"old"'}})).mockResolvedValueOnce(new Response(null,{status:304}));
 const api=createGitHubApi({token:'test-token',fetchImpl});await api.read('run');await expect(api.read('run',{fresh:true})).rejects.toThrow('UNEXPECTED_304');
});
it('never substitutes cached success for an API failure',async()=>{
 const fetchImpl=vi.fn().mockResolvedValueOnce(new Response('{"status":"in_progress"}',{headers:{etag:'"old"'}})).mockResolvedValueOnce(new Response('{}',{status:403}));
 const api=createGitHubApi({token:'test-token',fetchImpl});await api.read('run');await expect(api.read('run')).rejects.toThrow('HTTP_403');
});
it('never caches writes and invalidates the target snapshot after a cancellation request',async()=>{
 const fetchImpl=vi.fn().mockResolvedValueOnce(new Response('{}',{headers:{etag:'"old"'}})).mockResolvedValueOnce(new Response(null,{status:202})).mockResolvedValueOnce(new Response('{}'));
 const api=createGitHubApi({token:'test-token',fetchImpl}),path='repos/boardx/workspacex/actions/runs/10';await api.read(path);expect(await api.write(path+'/cancel')).toEqual({status:202});await api.read(path);
 expect(fetchImpl.mock.calls[1][1].headers['If-None-Match']).toBeUndefined();expect(fetchImpl.mock.calls[2][1].headers['If-None-Match']).toBeUndefined();
});
