import {afterEach,it,expect,vi} from 'vitest';
import {DeepResearchModelProvider} from '../../src/infrastructure/agent-run/deep-research-model-provider';
import {BailianImageProvider} from '../../src/infrastructure/agent-run/bailian-image-provider';
import {ModelCallError} from '../../src/application/agent-run/ports';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('quota mode rejects opaque research before even creating a remote graph thread',async()=>{
 vi.stubEnv('KERNEL_AI_PRODUCT_QUOTA_ENABLED','1');const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 const model=new DeepResearchModelProvider({baseUrl:'http://private.example.test',timeoutMs:100,pollIntervalMs:1});
 await expect(model.complete({modelProvider:'open-deep-research',modelId:'pinned',system:'private-system',user:'private-question'})).rejects.toBeInstanceOf(ModelCallError);expect(fetch).not.toHaveBeenCalled();
});
it('quota mode rejects direct Bailian image and complete entrypoints before task submission',async()=>{
 vi.stubEnv('KERNEL_AI_PRODUCT_QUOTA_ENABLED','1');const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 const model=new BailianImageProvider({baseUrl:'http://private.example.test',apiKey:'fixture-secret',modelId:'pinned',timeoutMs:100,pollIntervalMs:1});
 await expect(model.generateImage('private-question')).rejects.toBeInstanceOf(ModelCallError);
 await expect(model.complete({modelProvider:'bailian-image',modelId:'pinned',system:'system',user:'private-question'})).rejects.toBeInstanceOf(ModelCallError);expect(fetch).not.toHaveBeenCalled();
});
