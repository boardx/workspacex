import {beforeEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
const api=vi.hoisted(()=>({list:vi.fn(),profile:vi.fn(),mounts:vi.fn(),mount:vi.fn(),unmount:vi.fn()}));
vi.mock('@/lib/live-skill',()=>({listSkills:api.list}));
vi.mock('@/lib/agent-directory',()=>({getAgentDirectoryProfile:api.profile}));
vi.mock('@/lib/live-skill-mount',()=>({listThreadMounts:api.mounts,mountSkills:api.mount,unmountSkill:api.unmount}));
vi.mock('@/components/chat/chat-live-message-panel',()=>({describeMessageFailure:(error:Error)=>error.message}));
vi.mock('@/components/feedback/feedback-button',()=>({FeedbackButton:()=>null}));
import {ChatSkillMountPanel} from '@/components/chat/chat-skill-mount-panel';
const items=[{skillId:'skill-pm',currentVersionId:'version-pm',name:'Same name',status:'已启用',duty:'需求'}, {skillId:'skill-research',currentVersionId:'version-research',name:'Same name',status:'已启用',duty:'研究'}];
beforeEach(()=>{api.list.mockReset().mockResolvedValue(items);api.profile.mockReset().mockImplementation(async(id:string)=>({mountedSkillIds:[],pinnedSkillVersionIds:[`version-${id}`],pinnedSkills:[{skillId:`skill-${id}`,versionId:`version-${id}`}]}));api.mounts.mockReset().mockResolvedValue({temporary:[],version:'1'});api.mount.mockReset().mockResolvedValue({});api.unmount.mockReset().mockResolvedValue({});});
const props={threadId:'thread',orgId:'org',bearer:'bearer'};
it('limits candidates by exact role bindings even when names are identical',async()=>{
 render(<ChatSkillMountPanel {...props} actingAgentId="pm"/>);fireEvent.click(await screen.findByTestId('chat-skill-mount'));await waitFor(()=>expect(api.list).toHaveBeenCalled());await waitFor(()=>expect(screen.getAllByText('Same name')).toHaveLength(1));
});
it('does not fall back to the organization pool for an empty role',async()=>{
 api.profile.mockResolvedValue({mountedSkillIds:[],pinnedSkillVersionIds:[],pinnedSkills:[]});render(<ChatSkillMountPanel {...props} actingAgentId="empty"/>);fireEvent.click(await screen.findByTestId('chat-skill-mount'));await waitFor(()=>expect(api.list).toHaveBeenCalled());await waitFor(()=>expect(screen.queryByText('Same name')).not.toBeInTheDocument());
});
it('immediately hides and removes incompatible temporary selections on a role change',async()=>{
 const entry={mountId:'mount-pm',threadId:'thread',skillId:'skill-pm',versionId:'version-pm',mountedAt:'2026-10-01T00:00:00Z',removedAt:null};api.mounts.mockResolvedValue({temporary:[entry],version:'1'});
 const view=render(<ChatSkillMountPanel {...props} actingAgentId="pm"/>);await waitFor(()=>expect(screen.getByTestId('chat-skill-mount-panel')).toHaveTextContent('Same name'));
 view.rerender(<ChatSkillMountPanel {...props} actingAgentId="research"/>);expect(screen.getByTestId('chat-skill-mount-panel')).not.toHaveTextContent('Same name');await waitFor(()=>expect(api.unmount).toHaveBeenCalledWith('thread','mount-pm',undefined,'bearer'));
});
it('shows a historical pin as role capability without mounting the catalog latest version',async()=>{
 api.profile.mockResolvedValue({mountedSkillIds:[],pinnedSkillVersionIds:['old-pm'],pinnedSkills:[{skillId:'skill-pm',versionId:'old-pm'}]});const view=render(<ChatSkillMountPanel {...props} actingAgentId="pm" variant="composer" openRequest={0}/>);
 await waitFor(()=>expect(api.profile).toHaveBeenCalled());view.rerender(<ChatSkillMountPanel {...props} actingAgentId="pm" variant="composer" openRequest={1}/>);
 const option=await screen.findByTestId('chat-skill-mount-option-skill-pm');expect(option).toBeDisabled();expect(screen.getByText('数字人已固定使用此技能，无需临时挂载')).toBeInTheDocument();fireEvent.click(option);expect(api.mount).not.toHaveBeenCalled();
});
it('keeps a profile permission error visible and never exposes organization candidates',async()=>{
 api.profile.mockRejectedValue(new Error('Forbidden'));render(<ChatSkillMountPanel {...props} actingAgentId="pm"/>);
 await waitFor(()=>expect(screen.getByTestId('chat-skill-mount-failure')).toHaveTextContent('Forbidden'));fireEvent.click(screen.getByTestId('chat-skill-mount'));await waitFor(()=>expect(screen.queryByText('Same name')).not.toBeInTheDocument());
});
it('ignores an old role profile response after switching roles',async()=>{
 let resolve!: (value:unknown)=>void;const old=new Promise(resolvePromise=>{resolve=resolvePromise;});api.profile.mockImplementation((id:string)=>id==='pm'?old:Promise.resolve({mountedSkillIds:[],pinnedSkillVersionIds:['version-research'],pinnedSkills:[{skillId:'skill-research',versionId:'version-research'}]}));
 const view=render(<ChatSkillMountPanel {...props} actingAgentId="pm"/>);view.rerender(<ChatSkillMountPanel {...props} actingAgentId="research"/>);await waitFor(()=>expect(screen.getByTestId('chat-skill-mount')).toBeEnabled());fireEvent.click(screen.getByTestId('chat-skill-mount'));await waitFor(()=>expect(screen.getByTestId('chat-skill-mount-option-skill-research')).toBeInTheDocument());await act(async()=>{resolve({mountedSkillIds:[],pinnedSkillVersionIds:['version-pm'],pinnedSkills:[{skillId:'skill-pm',versionId:'version-pm'}]});await old;});expect(screen.queryByTestId('chat-skill-mount-option-skill-pm')).not.toBeInTheDocument();
});
it('reports an incompatible mount cleanup rejection rather than silently claiming success',async()=>{
 api.mounts.mockResolvedValue({temporary:[{mountId:'wrong',threadId:'thread',skillId:'skill-research',versionId:'version-research',removedAt:null}],version:'1'});api.unmount.mockRejectedValue(new Error('Cleanup forbidden'));render(<ChatSkillMountPanel {...props} actingAgentId="pm"/>);await waitFor(()=>expect(screen.getByTestId('chat-skill-mount-failure')).toHaveTextContent('Cleanup forbidden'));expect(screen.queryByTestId('chat-skill-mounted-skill-research')).not.toBeInTheDocument();
});
it('shows role pending bindings as disabled candidates with separate available and pending counts',async()=>{
 api.profile.mockResolvedValue({mountedSkillIds:[],pinnedSkillVersionIds:['version-pm'],pinnedSkills:[{skillId:'skill-pm',versionId:'version-pm'}],pendingSkillBindings:[{stableId:'S901',stableName:'S901',contentDigest:'a'.repeat(64),displayName:'需求验证',reason:'awaiting_verification'},{stableId:'S902',stableName:'S902',contentDigest:'b'.repeat(64),displayName:'需求同步',reason:'missing_version'}]});
 const view=render(<ChatSkillMountPanel {...props} actingAgentId="pm" variant="composer" openRequest={0}/>);await waitFor(()=>expect(api.profile).toHaveBeenCalled());view.rerender(<ChatSkillMountPanel {...props} actingAgentId="pm" variant="composer" openRequest={1}/>);
 const pending=await screen.findByTestId('chat-skill-pending-S901');expect(pending).toBeDisabled();expect(pending).toHaveTextContent('需求验证');expect(pending).toHaveTextContent('待验证');expect(screen.getByTestId('chat-skill-pending-S902')).toHaveTextContent('版本缺失');expect(screen.getByTestId('chat-skill-role-counts')).toHaveTextContent('可用 1');expect(screen.getByTestId('chat-skill-role-counts')).toHaveTextContent('待验证 2');fireEvent.click(pending);expect(api.mount).not.toHaveBeenCalled();
});
it('keeps pending-only roles at zero executable skills and clears their pending items when the role changes',async()=>{
 api.profile.mockImplementation(async(id:string)=>({mountedSkillIds:[],pinnedSkillVersionIds:[],pinnedSkills:[],pendingSkillBindings:id==='pm'?[{stableId:'S901',stableName:'S901',contentDigest:'a'.repeat(64),reason:'missing_version'}]:[]}));
 const view=render(<ChatSkillMountPanel {...props} actingAgentId="pm" variant="composer" openRequest={0}/>);await waitFor(()=>expect(api.profile).toHaveBeenCalled());view.rerender(<ChatSkillMountPanel {...props} actingAgentId="pm" variant="composer" openRequest={1}/>);
 expect(await screen.findByTestId('chat-skill-pending-S901')).toBeDisabled();expect(screen.getByTestId('chat-skill-role-counts')).toHaveAttribute('data-available-count','0');expect(screen.getByTestId('chat-skill-role-counts')).toHaveAttribute('data-pending-count','1');expect(screen.queryByTestId('chat-skill-mount-option-skill-research')).not.toBeInTheDocument();
 view.rerender(<ChatSkillMountPanel {...props} actingAgentId="research" variant="composer" openRequest={1}/>);expect(screen.queryByTestId('chat-skill-pending-S901')).not.toBeInTheDocument();
});

import {ChatPopoverCoordinatorProvider} from '@/components/chat/chat-popover-coordinator';
it('keeps the skill picker open under the real coordinator and still closes it on a role change',async()=>{
 const view=render(<ChatPopoverCoordinatorProvider><ChatSkillMountPanel {...props} actingAgentId="pm"/></ChatPopoverCoordinatorProvider>);
 await waitFor(()=>expect(screen.getByTestId('chat-skill-mount')).toBeEnabled());fireEvent.click(screen.getByTestId('chat-skill-mount'));
 expect(await screen.findByTestId('chat-skill-mount-option-skill-pm')).toBeInTheDocument();
 view.rerender(<ChatPopoverCoordinatorProvider><ChatSkillMountPanel {...props} actingAgentId="research"/></ChatPopoverCoordinatorProvider>);
 await waitFor(()=>expect(screen.queryByTestId('chat-skill-mount-picker')).not.toBeInTheDocument());
 await waitFor(()=>expect(screen.getByTestId('chat-skill-mount')).toBeEnabled());fireEvent.click(screen.getByTestId('chat-skill-mount'));expect(await screen.findByTestId('chat-skill-mount-option-skill-research')).toBeInTheDocument();
});
