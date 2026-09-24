import { beforeEach,describe,expect,it,vi } from 'vitest';
import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import type { Proposal } from '@repo/contracts/whiteboard-proposal';
import { ProposalPanel } from '@/components/whiteboard/proposal-panel';
import * as api from '@/lib/live-whiteboard-proposals';
vi.mock('@/lib/live-whiteboard-proposals',()=>({listWhiteboardProposals:vi.fn(),decideWhiteboardProposal:vi.fn(),batchDecideWhiteboardProposals:vi.fn()}));
const pending={status:'pending' as const,decidedBy:null,decidedAt:null,requestId:null,committedEpoch:null,committedSeq:null};
const proposal:Proposal={id:'123e4567-e89b-42d3-a456-426614174000',title:'Reorganize notes',status:'pending',baseEpoch:1,baseSeq:5,commands:[{type:'delete',id:'old_note'}],commandDecisions:[pending],provenance:{submittedBy:'authorized-person',actor:{kind:'human',id:'authorized-person'},source:{kind:'api'},createdAt:'2026-09-24T00:00:00.000Z',participant:{kind:'human-api',actorId:'authorized-person',verified:true}},decidedBy:null,createdAt:'2026-09-24T00:00:00.000Z',decidedAt:null,committedEpoch:null,committedSeq:null};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(api.listWhiteboardProposals).mockResolvedValue([structuredClone(proposal)]);});
async function open(){fireEvent.click(screen.getByRole('button',{name:'AI 建议 展开'}));await screen.findByText('Reorganize notes · 待审阅');}
describe('AI proposal explicit review panel',()=>{
  it('shows real fetched command summaries and explicit authenticated API attribution',async()=>{
    render(<ProposalPanel boardId="board" role="owner" online/>);await open();
    expect(screen.getByText(/删除对象 old_note/)).toBeVisible();expect(screen.getByText(/人类\/API 提案/)).toBeVisible();expect(screen.getByText(/已验证 AI 运行/)).toBeVisible();
    expect(api.decideWhiteboardProposal).not.toHaveBeenCalled();
  });
  it('allows viewer reading but never displays decision buttons',async()=>{
    render(<ProposalPanel boardId="board" role="viewer" online/>);await open();expect(screen.queryByRole('button',{name:'接受整组建议'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'拒绝建议'})).not.toBeInTheDocument();
  });
  it('disables decisions while offline or local writes remain unsynced',async()=>{
    const{rerender}=render(<ProposalPanel boardId="board" role="owner" online/>);await open();
    rerender(<ProposalPanel boardId="board" role="owner" online={false}/>);expect(screen.getByRole('button',{name:'接受整组建议'})).toBeDisabled();expect(screen.getByRole('button',{name:'拒绝建议'})).toBeDisabled();
    rerender(<ProposalPanel boardId="board" role="owner" online pendingChanges/>);expect(screen.getByRole('button',{name:'接受整组建议'})).toBeDisabled();expect(api.decideWhiteboardProposal).not.toHaveBeenCalled();
  });
  it('retains the requestId for explicit network retry and prevents duplicate in-flight submissions',async()=>{
    let finish!:(p:Proposal)=>void;
    // One deterministic failure then a pending successful retry.
    vi.mocked(api.decideWhiteboardProposal).mockReset().mockRejectedValueOnce(new Error('NETWORK_UNAVAILABLE')).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<ProposalPanel boardId="board" role="editor" online/>);await open();fireEvent.click(screen.getByRole('button',{name:'接受整组建议'}));expect(await screen.findByRole('alert')).toHaveTextContent('NETWORK_UNAVAILABLE');
    fireEvent.click(screen.getByRole('button',{name:'接受整组建议'}));fireEvent.click(screen.getByRole('button',{name:'接受整组建议'}));expect(api.decideWhiteboardProposal).toHaveBeenCalledTimes(2);expect(screen.getByRole('button',{name:'接受整组建议'})).toBeDisabled();
    expect(vi.mocked(api.decideWhiteboardProposal).mock.calls[0]![3]).toBe(vi.mocked(api.decideWhiteboardProposal).mock.calls[1]![3]);
    finish({...proposal,status:'applied',decidedBy:'editor',committedEpoch:1,committedSeq:6});await screen.findByText('建议已应用到白板。');
  });
  it('surfaces a committed conflict without retrying or allowing overwrite',async()=>{
    vi.mocked(api.decideWhiteboardProposal).mockResolvedValue({...proposal,status:'conflicted',decidedBy:'editor'});
    render(<ProposalPanel boardId="board" role="editor" online/>);await open();fireEvent.click(screen.getByRole('button',{name:'接受整组建议'}));await screen.findByText(/此建议未应用/);
    expect(screen.getByText('Reorganize notes · 版本冲突')).toBeVisible();expect(screen.queryByRole('button',{name:'接受整组建议'})).not.toBeInTheDocument();expect(api.decideWhiteboardProposal).toHaveBeenCalledTimes(1);
  });
  it('rejects only when explicitly clicked and reports the document was not changed',async()=>{
    vi.mocked(api.decideWhiteboardProposal).mockResolvedValue({...proposal,status:'rejected',decidedBy:'editor'});
    render(<ProposalPanel boardId="board" role="editor" online/>);await open();fireEvent.click(screen.getByRole('button',{name:'拒绝建议'}));await waitFor(()=>expect(api.decideWhiteboardProposal).toHaveBeenCalledWith('board',proposal.id,'reject',expect.any(String)));await screen.findByText('建议已拒绝，白板内容未改变。');
  });
  it('shows a verified AI participant and atomically submits selected commands across proposals',async()=>{
    const second={...structuredClone(proposal),id:'223e4567-e89b-42d3-a456-426614174000',title:'AI layout',provenance:{submittedBy:'human-requester',actor:{kind:'human' as const,id:'human-requester'},source:{kind:'agent-run' as const,ref:'run-9'},createdAt:'2026-09-24T00:00:00.000Z',participant:{kind:'agent' as const,verified:true as const,agentId:'facilitator',agentName:'Workshop AI',agentVersionId:'av-7',runId:'run-9',provider:'openai',model:'gpt-6',modelVersion:'gpt-6'}}};
    vi.mocked(api.listWhiteboardProposals).mockResolvedValue([structuredClone(proposal),second]);
    vi.mocked(api.batchDecideWhiteboardProposals).mockResolvedValue({proposals:[{...proposal,status:'rejected',commandDecisions:[{...pending,status:'rejected',decidedBy:'editor',decidedAt:'2026-09-24T00:01:00.000Z',requestId:'323e4567-e89b-42d3-a456-426614174000'}],decidedBy:'editor',decidedAt:'2026-09-24T00:01:00.000Z'}]});
    render(<ProposalPanel boardId="board" role="editor" online/>);await open();expect(screen.getByText(/AI 参与者：Workshop AI（已验证）/)).toBeVisible();expect(screen.getByText(/Run run-9/)).toBeVisible();
    fireEvent.click(screen.getByRole('checkbox',{name:'选择「Reorganize notes」第 1 项'}));fireEvent.click(screen.getByRole('checkbox',{name:'选择「AI layout」第 1 项'}));
    fireEvent.click(screen.getByRole('button',{name:'批量拒绝所选'}));
    await waitFor(()=>expect(api.batchDecideWhiteboardProposals).toHaveBeenCalledWith('board',expect.objectContaining({action:'reject',selections:[
      {proposalId:proposal.id,commandIndexes:[0]},{proposalId:second.id,commandIndexes:[0]},
    ]})));
  });
});
