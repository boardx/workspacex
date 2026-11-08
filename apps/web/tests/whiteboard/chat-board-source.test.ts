import {beforeEach,expect,it,vi} from 'vitest';
const transport=vi.hoisted(()=>({land:vi.fn(),source:vi.fn()}));
vi.mock('@/lib/live-chat',()=>({landAsArtifact:transport.land,getThreadArtifactSource:transport.source}));
import {createBoardHandoffSourcePreparer} from '@/lib/chat/board-handoff-source';
beforeEach(()=>vi.resetAllMocks());
it('uses only the returned artifact and its server immutable revision',async()=>{
 transport.land.mockResolvedValue({artifactId:'actual-artifact'});
 transport.source.mockResolvedValue({immutableRevision:'artifact-v1:9'});
 const input={threadId:'thread',messageId:'message',projectId:'project',bearer:'fixture',source:'original source',title:'Canvas'};
 await expect(createBoardHandoffSourcePreparer(input)()).resolves.toEqual({artifactId:'actual-artifact',sourceRevision:'artifact-v1:9'});
 expect(transport.land).toHaveBeenCalledWith('thread',{messageId:'message',mode:'draft',title:'Canvas',payloadRef:'original source'},'fixture');
 expect(transport.source).toHaveBeenCalledWith('thread','actual-artifact','project','fixture');
});
it('fails closed when readback cannot provide an immutable revision',async()=>{
 transport.land.mockResolvedValue({artifactId:'actual-artifact'});transport.source.mockResolvedValue({markdown:'source'});
 await expect(createBoardHandoffSourcePreparer({threadId:'thread',messageId:'message',bearer:'fixture',source:'source',title:'Canvas'})()).rejects.toThrow('BOARD_SOURCE_REVISION_UNAVAILABLE');
});

it('retries readback of the same landed artifact rather than creating another',async()=>{
 transport.land.mockResolvedValue({artifactId:'actual-artifact'});
 transport.source.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({immutableRevision:'artifact-v1:9'});
 const prepare=createBoardHandoffSourcePreparer({threadId:'thread',messageId:'message',bearer:'fixture',source:'source',title:'Canvas'});
 await expect(prepare()).rejects.toThrow('network');
 await expect(prepare()).resolves.toEqual({artifactId:'actual-artifact',sourceRevision:'artifact-v1:9'});
 expect(transport.land).toHaveBeenCalledTimes(1);
 expect(transport.source.mock.calls.map(call=>call[1])).toEqual(['actual-artifact','actual-artifact']);
});

it('serializes the actual rendered model to canonical source with its own fence language',async()=>{
 const {modelToMarkdown,templateToModel}=await import('@repo/fabric-markdown');
 const diagram={kind:'flowchart' as const,direction:'TD' as const,nodes:[{id:'A',label:'Literal A',shape:'rect' as const,x:90,y:100,width:100,height:50}],edges:[]};
 expect(modelToMarkdown(diagram)).toBe('```mermaid\nflowchart TD\n    A["Literal A"]\n```');
 const persona=templateToModel('模板: persona\n姓名: 林可\n## 用户描述\n- Unique content');
 const source=modelToMarkdown(persona);
 expect(source).toMatch(/^```persona\n/);expect(source).not.toContain('模板: persona');expect(source).toContain('Unique content');
 const empathy=templateToModel('模板: empathy\n## 想的与感受到的\n- Unique content');
 expect(modelToMarkdown(empathy)).toMatch(/^```canvas\n模板: empathy\n/);
});
