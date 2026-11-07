import {it,expect,vi,afterEach} from 'vitest';
import {StandardContextToolsController} from '../../src/interface/controllers/standard-context-tools.controller';
vi.mock('../../src/application/chat/resolve-visibility',()=>({resolveVisibility:vi.fn(async()=>({kind:'allow'}))}));
afterEach(()=>vi.unstubAllEnvs());
it.each([undefined,'0'])('forwards checked run identity for hybrid search with legacy flag %s',async flag=>{
 vi.stubEnv('DEEP_AGENT_SERVICE_INTERNAL_KEY','private-key');vi.stubEnv('KERNEL_RETRIEVAL_REQUEST_ACCOUNTING_ENABLED',flag);
 const search=vi.fn(async()=>({items:[]})),check=vi.fn(async()=>({allowed:true}));
 const runs={findRequesterUserId:vi.fn(async()=> 'persisted-requester'),findLocator:vi.fn(async()=>({threadId:'persisted-thread',projectId:'persisted-project'}))};
 const controller=new StandardContextToolsController({search} as never,{check} as never,runs as never,{} as never,{} as never,{} as never);
 const body={orgId:'org',attemptId:'run:attempt',leaseEpoch:3,toolCallId:'tool',toolName:'wx_knowledge_search',toolArgs:{query:'query',scope:'organization-hybrid'}};
 await controller.invoke('private-key','persisted-run',body);
 expect(search).toHaveBeenCalledWith({orgId:'org',userId:'persisted-requester',threadId:'persisted-thread',projectId:'persisted-project',modelRequestAccounting:{orgId:'org',runId:'persisted-run',attemptId:'run:attempt',leaseEpoch:3}},body.toolArgs);
 check.mockResolvedValue({allowed:false});await expect(controller.invoke('private-key','persisted-run',body)).rejects.toThrow();expect(search).toHaveBeenCalledTimes(1);
});
