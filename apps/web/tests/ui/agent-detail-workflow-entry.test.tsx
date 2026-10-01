import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {AgentDetail,type AgentDetailExtras} from '@/components/agent/agent-detail';
import type {AgentDirectoryCard} from '@/lib/agent-directory';
import {ApiError} from '@/lib/api-client';
const api=vi.hoisted(()=>({list:vi.fn(),start:vi.fn(),navigate:vi.fn()}));
vi.mock('@/lib/workflow-runtime-api',async()=>({...await vi.importActual<typeof import('@/lib/workflow-runtime-api')>('@/lib/workflow-runtime-api'),listRunnableWorkflows:api.list,startWorkflowInstance:api.start}));
const card:AgentDirectoryCard={agentId:'pm-agent',versionId:'v1',name:'产品经理',initials:'产',avatar:null,roleLabel:'Product Manager',roleCategory:'product',tags:[],catalogSource:'official',workflows:[{stableId:'W029',name:'问题定义到 PRD'}],readiness:'ready'};
const extras:AgentDetailExtras={duty:'产品需求',skillSource:'agent',skills:[],delegationTargets:[],requireApprovalForHandoff:true};
function view(value=card){return <AgentDetail agentId={value.agentId} onStartChat={vi.fn()} fetchCard={vi.fn().mockResolvedValue(value)} fetchExtras={vi.fn().mockResolvedValue(extras)}/>;}
beforeEach(()=>{api.list.mockReset();api.start.mockReset();api.navigate.mockReset();vi.stubGlobal('location',{...window.location,assign:api.navigate});});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('allows direct authorized workflow launch, validates required input and navigates to the created run',async()=>{
 api.list.mockResolvedValue({items:[{key:'problem-to-prd',version:1,title:'问题定义到 PRD',inputSchema:{type:'object',required:['problem'],properties:{problem:{type:'string'}}}}]});
 api.start.mockResolvedValue({instanceId:'created-run'});
 render(view());fireEvent.click(await screen.findByTestId('workflow-run-entry'));
 fireEvent.click(screen.getByTestId('workflow-run-start-problem-to-prd'));
 fireEvent.click(screen.getByTestId('workflow-run-form-submit'));
 expect(api.start).not.toHaveBeenCalled();expect(screen.getByTestId('workflow-run-input-error-problem')).toBeInTheDocument();
 fireEvent.change(screen.getByTestId('workflow-run-input-problem'),{target:{value:'客户反馈导入太难'}});
 fireEvent.click(screen.getByTestId('workflow-run-form-submit'));
 await waitFor(()=>expect(api.navigate).toHaveBeenCalledWith('/workflows/runs/created-run'));
 expect(api.list).toHaveBeenCalledWith('pm-agent');
 expect(api.start).toHaveBeenCalledWith({key:'problem-to-prd',version:1,agentId:'pm-agent',input:{problem:'客户反馈导入太难'}});
 expect(screen.getByTestId('agent-detail-workflow-launch')).toBeInTheDocument();
});
it.each(['empty','denied'])('does not expose direct launch when runnable list is %s',async(mode)=>{
 if(mode==='empty')api.list.mockResolvedValue({items:[]});else api.list.mockRejectedValue(new ApiError(403,null,{}));
 render(view());await screen.findByTestId('agent-detail-name');await waitFor(()=>expect(api.list).toHaveBeenCalled());
 await new Promise(resolve=>setTimeout(resolve,20));expect(screen.queryByTestId('workflow-run-entry')).not.toBeInTheDocument();expect(api.start).not.toHaveBeenCalled();
});
it('keeps chat available but does not query direct workflows before role readiness',async()=>{
 render(view({...card,readiness:'missing'}));await screen.findByTestId('agent-detail-name');
 expect(api.list).not.toHaveBeenCalled();expect(screen.queryByTestId('workflow-run-entry')).not.toBeInTheDocument();expect(screen.getByTestId('agent-detail-start-chat')).toBeInTheDocument();
});
it('starts the current object-only W029 metadata without claiming a user problem was collected',async()=>{
 api.list.mockResolvedValue({items:[{key:'problem-to-prd',version:1,title:'问题定义到 PRD',inputSchema:{type:'object'}}]});
 api.start.mockResolvedValue({instanceId:'mechanism-run'});
 render(view());fireEvent.click(await screen.findByTestId('workflow-run-entry'));
 fireEvent.click(screen.getByTestId('workflow-run-start-problem-to-prd'));
 await waitFor(()=>expect(api.navigate).toHaveBeenCalledWith('/workflows/runs/mechanism-run'));
 expect(screen.queryByTestId('workflow-run-form-problem-to-prd')).not.toBeInTheDocument();
 expect(api.start).toHaveBeenCalledWith({key:'problem-to-prd',version:1,agentId:'pm-agent',input:{}});
});
