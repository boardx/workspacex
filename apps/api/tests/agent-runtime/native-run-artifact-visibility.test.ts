import {it,expect,vi} from 'vitest';
import {PgRunArtifactRefsReader} from '../../src/infrastructure/agent-run/pg-run-artifact-refs-reader';
vi.mock('../../src/application/chat/resolve-visibility',()=>({resolveVisibility:async()=>({kind:'allow',base:{allowed:true}})}));
import {toOrgId} from '../../src/domain/org-id';
it('discloses only versions accepted by existing artifact source visibility',async()=>{
 const rows=[{artifact_id:'visible',id:'v1',version:1},{artifact_id:'visible',id:'hidden-version',version:2},{artifact_id:'private',id:'private-v',version:1}];
 const db={withTenant:async(_org:unknown,run:(s:unknown)=>unknown)=>run({query:async()=>({rows})})};
 const read=vi.fn(async(_deps:unknown,input:{artifactId:string})=>{if(input.artifactId==='private')throw new Error('denied');return {versions:[{version:1}]};});
 const deps={artifacts:{findLocator:async()=>({threadId:'thread',projectId:null})}};
 const reader=new PgRunArtifactRefsReader(db as never,deps as never,read as never);
 expect(await reader.listProducedByRun({orgId:toOrgId('o'),userId:'actor'},'run')).toEqual([{artifactId:'visible',versionId:'v1'}]);
 expect(read).toHaveBeenCalledWith(deps, {orgId:'o',userId:'actor',artifactId:'private'});
});
