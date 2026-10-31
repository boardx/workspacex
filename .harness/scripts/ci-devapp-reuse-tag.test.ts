import {expect,it} from 'vitest';
import {resolveVerifiedTagSource} from './ci-devapp-integration-gate.mjs';
const sha='a'.repeat(40);
const producer={id:123,run_attempt:2,head_sha:sha,head_branch:'develop',event:'push',path:'.github/workflows/image-release.yml',workflow_id:9,status:'completed',conclusion:'success'};
const jobs=['plan','admission','manifest','build (api)','build (web)','build (agent)','build (sandbox)','build (postgres)'].map(name=>({name,run_id:123,run_attempt:2,head_sha:sha,status:'completed',conclusion:'success'}));
const apiFor=(run=producer,rows=jobs)=>async(path:string)=>{
 if(path==='/actions/workflows/image-release.yml')return {id:9,path:producer.path,state:'active'};
 if(path==='/actions/runs/123/attempts/1')return {...run,run_attempt:1};
 if(path==='/actions/runs/123/attempts/1/jobs?per_page=100')return {total_count:rows.length,jobs:rows.map(j=>({...j,run_attempt:1}))};
 if(path==='/actions/runs/123/attempts/2/jobs?per_page=100')return {total_count:1,jobs:[{...jobs[0],name:'deploy'}]};
 if(path==='/actions/runs/123')return run;
 throw Error('unexpected '+path);
};
it('resolves an existing build tag to its verified producer SHA, not the dispatch SHA',async()=>{
 await expect(resolveVerifiedTagSource(apiFor(), '123-1')).resolves.toEqual({sha,runId:123,attempt:2});
});
it('rejects malformed tags, wrong producer identity, failures and absent source admission',async()=>{
 for(const tag of ['latest','123-0','../123-1','123-1-extra'])await expect(resolveVerifiedTagSource(apiFor(),tag)).rejects.toThrow();
 for(const delta of [{head_branch:'main'},{event:'pull_request'},{path:'other.yml'},{conclusion:'failure'},{workflow_id:10}])await expect(resolveVerifiedTagSource(apiFor({...producer,...delta}),'123-1')).rejects.toThrow();
 for(const name of ['admission','manifest','build (api)'])await expect(resolveVerifiedTagSource(apiFor(producer,jobs.filter(j=>j.name!==name)),'123-1')).rejects.toThrow();
 await expect(resolveVerifiedTagSource(apiFor(producer,jobs.map(j=>j.name==='admission'?{...j,conclusion:'failure'}:j)),'123-1')).rejects.toThrow();
});

it('rejects a producer rerun racing with admission',async()=>{
 let reads=0;const base=apiFor();
 const api=async(path:string)=>path==='/actions/runs/123'&&++reads===2?{...producer,run_attempt:3,status:'in_progress',conclusion:null}:base(path);
 await expect(resolveVerifiedTagSource(api,'123-1')).rejects.toThrow('ATTEMPT_CHANGED');
});

it('preserves original build evidence when the latest attempt reruns only deploy',async()=>{
 const originalJobs=jobs.map(j=>({...j,run_attempt:1}));
 const api=async(path:string)=>path.includes('/attempts/1/jobs?')?{total_count:originalJobs.length,jobs:originalJobs}:path.includes('/attempts/2/jobs?')?{total_count:1,jobs:[{...jobs[0],name:'deploy'}]}:apiFor()(path);
 await expect(resolveVerifiedTagSource(api,'123-1')).resolves.toEqual({sha,runId:123,attempt:2});
});

it('rejects failed or missing deployment in the latest retry despite a verified original build',async()=>{
 for(const rows of [[],[{...jobs[0],name:'deploy',conclusion:'failure'}]]){
  const api=async(path:string)=>path.includes('/attempts/2/jobs?')?{total_count:rows.length,jobs:rows}:apiFor()(path);
  await expect(resolveVerifiedTagSource(api,'123-1')).rejects.toThrow('RETRY_UNVERIFIED');
 }
});
