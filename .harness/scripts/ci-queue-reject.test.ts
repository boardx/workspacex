import {it,expect,vi} from 'vitest';
import {rejectQueueCandidate,criticalQueueJobs} from './ci-queue-reject.mjs';
const sha='a'.repeat(40),branch='gh-readonly-queue/develop/pr-1-abcdef0';
const target={id:10,workflow_id:20,run_attempt:2,head_sha:sha,head_branch:branch,event:'merge_group',name:'harness-acceptance',repository:'boardx/workspacex',repoId:30};
const failed={id:40,name:'fullstack-smoke',head_sha:sha,run_id:10,workflow_id:20,run_attempt:2,status:'completed',conclusion:'failure'};
function fixture(){return {target,failed:[{id:40,conclusion:'failure'}],read:vi.fn(async path=>/\/actions\/workflows\/20$/.test(path)?{id:20,path:'.github/workflows/harness-acceptance.yml',state:'active'}:path.includes('/runs?')?{total_count:1,workflow_runs:[{id:10}]}:path.includes('/git/ref/')?{object:{sha}}:path.includes('/jobs/')?failed:path.includes('/check-runs')?{total_count:0,check_runs:[]}:null),write:vi.fn(async()=>({status:201})),revalidate:vi.fn(async()=>true)};}
it('derives authoritative critical jobs from queue aggregate dependencies',()=>{
 const jobs=criticalQueueJobs();expect(jobs.has('fullstack-smoke')).toBe(true);expect(jobs.has('base-api-shards')).toBe(true);expect(jobs.has('chat-task-workbench')).toBe(false);
});
it('publishes only a bound negative check with original failed job link',async()=>{
 const f=fixture();await rejectQueueCandidate(f);expect(f.revalidate).toHaveBeenCalledTimes(1);expect(f.write).toHaveBeenCalledWith('repos/boardx/workspacex/check-runs',expect.objectContaining({name:'queue-ready',head_sha:sha,status:'completed',conclusion:'failure',external_id:`queue-reject:10:2:${sha}`}));
});
it('rejects stale ref, foreign jobs, attempts and noncritical failures without writes',async()=>{
 for(const change of [{head_sha:'b'.repeat(40)},{run_attempt:1},{run_id:11},{conclusion:'cancelled'},{name:'chat-task-workbench'}]){
  const f=fixture();f.read.mockImplementation(async path=>/\/actions\/workflows\/20$/.test(path)?{id:20,path:'.github/workflows/harness-acceptance.yml',state:'active'}:path.includes('/runs?')?{total_count:1,workflow_runs:[{id:10}]}:path.includes('/git/ref/')?{object:{sha}}:path.includes('/jobs/')?{...failed,...change}:null);
  await expect(rejectQueueCandidate(f)).rejects.toThrow();expect(f.write).not.toHaveBeenCalled();
 }
 const f=fixture();f.revalidate.mockResolvedValue(false);await expect(rejectQueueCandidate(f)).rejects.toThrow();expect(f.write).not.toHaveBeenCalled();
});
it('does not publish outside acceptance queue or duplicate an existing negative proof',async()=>{
 for(const change of [{event:'workflow_dispatch'},{name:'backend-gates'}]){const f=fixture();await rejectQueueCandidate({...f,target:{...target,...change}});expect(f.write).not.toHaveBeenCalled();}
 const f=fixture();f.read.mockImplementation(async path=>/\/actions\/workflows\/20$/.test(path)?{id:20,path:'.github/workflows/harness-acceptance.yml',state:'active'}:path.includes('/runs?')?{total_count:1,workflow_runs:[{id:10}]}:path.includes('/git/ref/')?{object:{sha}}:path.includes('/jobs/')?failed:{total_count:1,check_runs:[{external_id:`queue-reject:10:2:${sha}`,name:'queue-ready',head_sha:sha,status:'completed',conclusion:'failure',app:{slug:'github-actions'}}]});
 await rejectQueueCandidate(f);expect(f.write).not.toHaveBeenCalled();
});
it('refuses wrong repository, moved queue ref, superseding run, wrong workflow, absent proof and denied writes',async()=>{
 const foreign=fixture();await expect(rejectQueueCandidate({...foreign,target:{...target,repository:'other/repository'}})).rejects.toThrow('IDENTITY');expect(foreign.write).not.toHaveBeenCalled();
 for(const [match,value] of [
  ['/git/ref/',{object:{sha:'b'.repeat(40)}}],
  ['/runs?',{total_count:2,workflow_runs:[{id:10},{id:11}]}],
  ['/actions/workflows/20',{id:20,path:'.github/workflows/other.yml',state:'active'}],
 ] as const){
  const f=fixture(),read=f.read.getMockImplementation()!;f.read.mockImplementation(async path=>path.includes(match)?value:read(path));
  await expect(rejectQueueCandidate(f)).rejects.toThrow();expect(f.write).not.toHaveBeenCalled();
 }
 const empty=fixture();await expect(rejectQueueCandidate({...empty,failed:[]})).rejects.toThrow('NO_CRITICAL_FAILURE');expect(empty.write).not.toHaveBeenCalled();
 const denied=fixture();denied.write.mockResolvedValue({status:403});await expect(rejectQueueCandidate(denied)).rejects.toThrow('PUBLICATION_HTTP_403');
});
