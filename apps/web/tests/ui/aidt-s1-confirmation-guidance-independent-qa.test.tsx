import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { StageContent } from '@repo/contracts/aidt-stages';
import { AidtProblemChatReview } from '@/features/aidt/components/aidt-problem-chat-review';
import { readAidtProblemEntityDraft } from '@/features/aidt/lib/aidt-problem-entities';
import { ApiError } from '@/lib/api-client';
import { saveAidtStage, reconcileAidtEntity, type AidtSharedStage } from '@/features/aidt/lib/live-aidt-stages';
import fixture from './aidt-s1-real-missing-fixture.json';
vi.mock('@/features/aidt/lib/live-aidt-stages',()=>({saveAidtStage:vi.fn(),reconcileAidtEntity:vi.fn()}));
vi.mock('@/features/aidt/components/aidt-problem-candidates',()=>({AidtProblemCandidates:()=> <div data-testid="independent-candidate-tools">候选工具</div>}));
const entity='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const neighbor={initial:'邻居独立原始命题',whyWorthStudying:'邻居自己的选题理由',problemSources:'["guess"]',sourceDetails:'邻居合成猜测，未验证',rewrittenTheme:'邻居独立重写命题'};
function stage(fields:Record<string,string>):AidtSharedStage{return {projectId:'synthetic-project',stageId:1,revision:3,sourceStageRevisions:[],updatedBy:'synthetic-member',updatedAt:'2026-11-22T14:00:00Z',content:StageContent.parse({schemaVersion:1,draft:{fields:{['problemEntity:'+entity]:JSON.stringify({id:entity,title:'本组实际合成命题',archived:false}),['problemDraft:'+entity]:JSON.stringify(fields),['problemEntity:'+other]:JSON.stringify({id:other,title:'邻居命题',archived:false}),['problemDraft:'+other]:JSON.stringify(neighbor)},ideas:[],selectedIdeaId:''}})};}
const props=(value:AidtSharedStage)=>({projectId:value.projectId,entityId:entity,stage:value,sessionToken:'test-only-fixture',threadId:'thr_synthetic_current_entity',loading:false,running:false,messages:[],onRefresh:vi.fn()});
beforeEach(()=>{vi.resetAllMocks();vi.mocked(reconcileAidtEntity).mockResolvedValue(undefined);vi.mocked(saveAidtStage).mockResolvedValue({} as Awaited<ReturnType<typeof saveAidtStage>>);});
it('the actual three missing fields are individually visible with current-Chat instructions and actionable confirmation guidance without saving',async()=>{
 render(<AidtProblemChatReview {...props(stage(fixture.incomplete))}/>);
 const status=await screen.findByTestId('aidt-problem-missing-input');
 expect(status).toHaveAttribute('role','status');expect(status).toHaveAttribute('aria-label','本步待补充');const items=within(status).getAllByRole('listitem');expect(items).toHaveLength(3);expect(items[0]).toHaveTextContent('选题理由');expect(items[1]).toHaveTextContent('问题来源');expect(items[2]).toHaveTextContent('来源描述');expect(status).toHaveTextContent('当前聊天');expect(status).toHaveTextContent('补充');
 fireEvent.click(screen.getByRole('button',{name:'确认本轮成果并保存'}));expect(screen.getByRole('alert')).toHaveTextContent('问题来源');expect(screen.queryByRole('link',{name:'继续第2步'})).toBeNull();expect(screen.queryByRole('textbox')).toBeNull();expect(screen.queryByRole('checkbox')).toBeNull();expect(saveAidtStage).not.toHaveBeenCalled();
});
it.each<Record<string,string>>([{}, {initial:'你好！'}])('an empty/control-only welcome offers confirmation guidance and cannot borrow a complete neighbor: %j',async fields=>{
 render(<AidtProblemChatReview {...props(stage(fields))}/>);await screen.findByTestId('independent-candidate-tools');expect(screen.queryByTestId('aidt-problem-missing-input')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'确认本轮成果并保存'}));expect(screen.getByRole('alert')).toHaveTextContent('问题来源');expect(screen.queryByRole('link',{name:'继续第2步'})).toBeNull();expect(screen.queryByText(neighbor.rewrittenTheme)).toBeNull();expect(saveAidtStage).not.toHaveBeenCalled();
});
it('a complete but running draft offers no usable confirmation and performs no automatic save',async()=>{
 render(<AidtProblemChatReview {...props(stage(fixture.complete))} running/>);const button=await screen.findByRole('button',{name:'确认本轮成果并保存'});expect(button).toBeDisabled();fireEvent.click(button);expect(saveAidtStage).not.toHaveBeenCalled();expect(screen.queryByRole('link',{name:'继续第2步'})).toBeNull();expect(screen.queryByTestId('aidt-problem-missing-input')).toBeNull();
});
it('explicit confirmation sends exactly the shown entity and revision through normal CAS while retaining the complete neighbor',async()=>{
 const current=stage(fixture.complete),before=current.content.draft.fields['problemDraft:'+other],view=render(<AidtProblemChatReview {...props(current)}/>);const button=await screen.findByRole('button',{name:'确认本轮成果并保存'});expect(saveAidtStage).not.toHaveBeenCalled();fireEvent.click(button);await waitFor(()=>expect(saveAidtStage).toHaveBeenCalledTimes(1));
 const command=vi.mocked(saveAidtStage).mock.calls[0]![0];expect(command.projectId).toBe(current.projectId);expect(command.stageId).toBe(1);expect(command.expectedRevision).toBe(3);expect(command.sourceStageRevisions).toEqual([]);expect(command.content.draft.fields['problemDraft:'+other]).toBe(before);expect(command.content.draft.fields.problemHandoffEntity).toBe(entity);expect(readAidtProblemEntityDraft(command.content.draft,entity).fields).toMatchObject({...fixture.complete,problemReflectionConfirmed:'true'});expect(readAidtProblemEntityDraft(command.content.draft,entity).fields.roundCompletion).toBeTruthy();
 view.rerender(<AidtProblemChatReview {...props({...current,revision:4,content:command.content})}/>);const next=await screen.findByRole('link',{name:'继续第2步'});expect(next).toHaveAttribute('href',expect.stringContaining('problemEntity='+entity));expect(next).toHaveAttribute('href',expect.stringContaining('problemRevision=4'));expect(saveAidtStage).toHaveBeenCalledTimes(1);
});
it('a rejected CAS never announces confirmation, creates an advance link or retries the write automatically',async()=>{
 vi.mocked(saveAidtStage).mockRejectedValue(new ApiError(409,'CONFLICT',{error:'synthetic conflict'}));render(<AidtProblemChatReview {...props(stage(fixture.complete))}/>);fireEvent.click(await screen.findByRole('button',{name:'确认本轮成果并保存'}));await screen.findByText('小组草稿已更新，请核对最新版本后确认。');expect(saveAidtStage).toHaveBeenCalledTimes(1);expect(screen.queryByText('本轮成果已确认并保存')).toBeNull();expect(screen.queryByRole('link',{name:'继续第2步'})).toBeNull();
});
