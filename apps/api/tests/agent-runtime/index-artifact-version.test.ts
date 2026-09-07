import {it,expect,vi} from 'vitest';
import {IndexArtifactVersion} from '../../src/application/retrieval/index-artifact-version';
import {toOrgId} from '../../src/domain/org-id';
const input={orgId:toOrgId('index-producer'),artifactVersionId:'v1'};
const batch={artifactVersionId:'v1',artifactId:'a1',projectId:null,externalEmbeddingAllowed:true,requiresReview:false,contentHash:'a'.repeat(64),segments:[{segmentId:'s1',content:'first'},{segmentId:'s2',content:'second'}]};
it('embeds actual segment content and commits one complete immutable batch',async()=>{
 const embed=vi.fn(async()=>[0.5,0.25]),write=vi.fn(async()=>{});
 await new IndexArtifactVersion({load:async()=>batch},{write},{model:'configured',modelVersion:'revision1',embed}).index(input);
 expect(embed.mock.calls).toEqual([['first'],['second']]);expect(write).toHaveBeenCalledOnce();
 expect(write.mock.calls[0]).toEqual([input,batch,{model:'configured',modelVersion:'revision1',vectors:[{segmentId:'s1',vector:[0.5,0.25]},{segmentId:'s2',vector:[0.5,0.25]}]}]);
});
it('does not commit partial vectors after provider failure',async()=>{
 const write=vi.fn(async()=>{});let calls=0;
 await expect(new IndexArtifactVersion({load:async()=>batch},{write},{model:'configured',modelVersion:'1',embed:async()=>{if(++calls===2)throw new Error('provider unavailable');return [1,2];}}).index(input)).rejects.toThrow();
 expect(write).not.toHaveBeenCalled();
});
it.each([{bad:[NaN,1]},{bad:[]},{bad:[1]}])('rejects nonfinite, empty, or inconsistent dimensions $bad',async ({bad})=>{
 const write=vi.fn(async()=>{});let calls=0;
 await expect(new IndexArtifactVersion({load:async()=>batch},{write},{model:'configured',modelVersion:'1',embed:async()=>++calls===1?[1,2]:bad}).index(input)).rejects.toThrow('artifact_embedding_unavailable');expect(write).not.toHaveBeenCalled();
});
it('unconfigured embeddings produce explicitly text-only writes, no fabricated vector',async()=>{
 const write=vi.fn(async()=>{});await new IndexArtifactVersion({load:async()=>batch},{write}).index(input);expect(write.mock.calls[0]).toEqual([input,batch]);
});

it('local organization source is never sent to external embeddings',async()=>{
 const embed=vi.fn(async()=>[1,2]),write=vi.fn(async()=>{});
 await expect(new IndexArtifactVersion({load:async()=>({...batch,externalEmbeddingAllowed:false})},{write},{model:'configured',modelVersion:'1',embed}).index(input)).rejects.toThrow('artifact_embedding_egress_denied');expect(embed).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();
});

it('PII awaiting structural review never leaves for external embeddings',async()=>{
 const embed=vi.fn(async()=>[1,2]),write=vi.fn(async()=>{});const pending={...batch,requiresReview:true};
 await new IndexArtifactVersion({load:async()=>pending},{write},{model:'configured',modelVersion:'1',embed}).index(input);expect(embed).not.toHaveBeenCalled();expect(write.mock.calls[0]).toEqual([input,pending]);
});
