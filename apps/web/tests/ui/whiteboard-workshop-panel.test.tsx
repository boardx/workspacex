import { beforeEach,describe,expect,it,vi } from 'vitest';
import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { WorkshopPanel } from '@/components/whiteboard/workshop-panel';
import * as api from '@/lib/live-whiteboard-workshop';
vi.mock('@/lib/live-whiteboard-workshop',()=>({listWorkshopComments:vi.fn(),listWorkshopVotes:vi.fn(),getWorkshopTimer:vi.fn(),getWorkshopDraft:vi.fn(),addWorkshopComment:vi.fn(),deleteWorkshopComment:vi.fn(),saveWorkshopDraft:vi.fn(),publishWorkshopDraft:vi.fn(),createWorkshopVote:vi.fn(),castWorkshopVote:vi.fn(),closeWorkshopVote:vi.fn(),startWorkshopTimer:vi.fn(),stopWorkshopTimer:vi.fn()}));
beforeEach(()=>{vi.clearAllMocks();vi.mocked(api.listWorkshopComments).mockResolvedValue([]);vi.mocked(api.listWorkshopVotes).mockResolvedValue([]);vi.mocked(api.getWorkshopTimer).mockResolvedValue({deadline:null,running:false});vi.mocked(api.getWorkshopDraft).mockResolvedValue({text:'',revision:null});});
async function open(){fireEvent.click(screen.getByRole('button',{name:'工作坊 展开'}));await waitFor(()=>expect(screen.queryByText('正在加载工作坊…')).not.toBeInTheDocument());}
describe('workshop panel real API interactions',()=>{
  it('keeps viewer controls read-only except own private draft and ballots',async()=>{
    render(<WorkshopPanel boardId="board" role="viewer"/>);await open();
    expect(screen.queryByRole('button',{name:'发表评论'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'发起投票'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'开始计时'})).not.toBeInTheDocument();
    expect(screen.getByText(/尚未发布到白板/)).toBeInTheDocument();
  });
  it('preserves unsaved private draft when panel collapses and reopens',async()=>{
    render(<WorkshopPanel boardId="board" role="editor"/>);await open();
    fireEvent.change(screen.getByLabelText('私密草稿'),{target:{value:'unsaved secret'}});
    fireEvent.click(screen.getByRole('button',{name:'工作坊 收起'}));await open();
    expect(screen.getByLabelText('私密草稿')).toHaveValue('unsaved secret');expect(api.getWorkshopDraft).toHaveBeenCalledTimes(1);
  });
  it('surfaces failed writes and reuses requestId on retry instead of duplicating comments',async()=>{
    vi.mocked(api.addWorkshopComment).mockRejectedValueOnce(new Error('NETWORK_UNAVAILABLE')).mockResolvedValueOnce({id:'comment',authorId:'me',objectId:'note',text:'hello',createdAt:new Date().toISOString()});
    render(<WorkshopPanel boardId="board" role="editor" selectedObjectId="note"/>);await open();
    fireEvent.change(screen.getByLabelText('评论内容'),{target:{value:'hello'}});fireEvent.click(screen.getByRole('button',{name:'发表评论'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('NETWORK_UNAVAILABLE');expect(screen.getByLabelText('评论内容')).toHaveValue('hello');
    fireEvent.click(screen.getByRole('button',{name:'发表评论'}));await screen.findByText('已保存');
    expect(api.addWorkshopComment).toHaveBeenCalledTimes(2);expect(vi.mocked(api.addWorkshopComment).mock.calls[0]![1].requestId).toBe(vi.mocked(api.addWorkshopComment).mock.calls[1]![1].requestId);
    expect(screen.getByLabelText('评论内容')).toHaveValue('');
  });
  it('disables duplicate submission while a comment is pending',async()=>{
    let finish!:(value:Awaited<ReturnType<typeof api.addWorkshopComment>>)=>void;
    vi.mocked(api.addWorkshopComment).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    render(<WorkshopPanel boardId="board" role="owner"/>);await open();
    fireEvent.change(screen.getByLabelText('评论内容'),{target:{value:'hello'}});const submit=screen.getByRole('button',{name:'发表评论'});fireEvent.click(submit);fireEvent.click(submit);
    expect(submit).toBeDisabled();expect(api.addWorkshopComment).toHaveBeenCalledTimes(1);
    finish({id:'one',authorId:'me',text:'hello',objectId:null,createdAt:new Date().toISOString()});await screen.findByText('已保存');
  });
  it('hides active totals even after the browser clock passes the deadline and blocks exhausted quota',async()=>{
    vi.mocked(api.listWorkshopVotes).mockResolvedValue([{id:'vote',title:'Decision',quota:1,used:1,closed:false,deadline:new Date(Date.now()-60000).toISOString(),objectIds:['note'],results:null}]);
    render(<WorkshopPanel boardId="board" role="viewer"/>);await open();fireEvent.click(screen.getByText('匿名投票'));
    expect(screen.getByText('正在确认投票结果…')).toBeInTheDocument();expect(screen.getByText('结果将在投票结束后显示')).toBeInTheDocument();expect(screen.getByText('note')).toBeInTheDocument();expect(screen.queryByText(/note：\d+ 票/)).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'投一票'})).toBeDisabled();
    expect(api.castWorkshopVote).not.toHaveBeenCalled();
  });
  it('shows only server-confirmed final totals',async()=>{
    vi.mocked(api.listWorkshopVotes).mockResolvedValue([{id:'vote',title:'Decision',quota:2,used:1,closed:true,deadline:new Date(Date.now()-60000).toISOString(),objectIds:['note'],results:[{objectId:'note',count:3}]}]);
    render(<WorkshopPanel boardId="board" role="editor"/>);await open();fireEvent.click(screen.getByText('匿名投票'));
    expect(screen.getByText('note：3 票')).toBeInTheDocument();expect(screen.queryByText('结果将在投票结束后显示')).not.toBeInTheDocument();
  });
  it('requires saved revision and explicit visibility consent before publishing',async()=>{
    vi.mocked(api.getWorkshopDraft).mockResolvedValue({text:'private idea',revision:'123e4567-e89b-42d3-a456-426614174000'});
    vi.mocked(api.publishWorkshopDraft).mockResolvedValue({objectId:'new_note',epoch:1,committedSeq:2,replayed:false});
    render(<WorkshopPanel boardId="board" role="editor"/>);await open();fireEvent.click(screen.getByText('私密草稿'));
    const publish=screen.getByRole('button',{name:'发布为白板便利贴'});expect(publish).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox',{name:'我确认发布后所有白板成员都可见'}));expect(publish).toBeEnabled();
    fireEvent.click(publish);await screen.findByText('已保存');
    expect(api.publishWorkshopDraft).toHaveBeenCalledWith('board',expect.objectContaining({expectedRevision:'123e4567-e89b-42d3-a456-426614174000'}));
    expect(screen.getByLabelText('私密草稿')).toHaveValue('');
  });

});
