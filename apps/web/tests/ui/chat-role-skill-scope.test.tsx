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
