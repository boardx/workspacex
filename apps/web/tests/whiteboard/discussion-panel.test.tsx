import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { DiscussionPanel } from '@/components/whiteboard/discussion-panel';
import * as api from '@/lib/live-whiteboard';
vi.mock('@/lib/live-whiteboard',()=>({listBoardThreads:vi.fn(),createBoardThread:vi.fn(),replyBoardThread:vi.fn(),resolveBoardThread:vi.fn(),createBoardTask:vi.fn(),updateBoardTask:vi.fn()}));
const page={items:[],nextCursor:null};
describe('DiscussionPanel',()=>{
 beforeEach(()=>{vi.resetAllMocks();vi.mocked(api.listBoardThreads).mockResolvedValue(page);vi.mocked(api.createBoardThread).mockResolvedValue({} as never);});
 it('anchors a comment to the selected object and deduplicates mentions',async()=>{
  render(<DiscussionPanel boardId="11111111-1111-4111-8111-111111111111" selectedObject={{id:'sticky_1',label:'客户反馈'}} readOnly={false}/>);fireEvent.click(screen.getByTestId('board-discussion-toggle'));await screen.findByTestId('board-discussion-panel');fireEvent.change(screen.getByLabelText('新评论'),{target:{value:'请确认'}});fireEvent.change(screen.getByLabelText('提及成员 ID'),{target:{value:'u2, u2'}});fireEvent.click(screen.getByText('发布评论'));await waitFor(()=>expect(api.createBoardThread).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({anchor:{kind:'object',objectId:'sticky_1',label:'客户反馈'},mentionUserIds:['u2']})));
 });
 it('lets viewers read while hiding write controls',async()=>{
  render(<DiscussionPanel boardId="11111111-1111-4111-8111-111111111111" selectedObject={{id:'x',label:'只读'}} readOnly/>);fireEvent.click(screen.getByTestId('board-discussion-toggle'));await screen.findByTestId('board-discussion-panel');expect(screen.queryByLabelText('新评论')).not.toBeInTheDocument();
 });
 it('supports a controlled mutually exclusive expanded state',async()=>{
  const onExpandedChange=vi.fn();const props={boardId:'11111111-1111-4111-8111-111111111111',selectedObject:null,readOnly:true,onExpandedChange};
  const {rerender}=render(<DiscussionPanel {...props} expanded={false}/>);
  fireEvent.click(screen.getByTestId('board-discussion-toggle'));expect(onExpandedChange).toHaveBeenCalledWith(true);
  expect(screen.queryByTestId('board-discussion-panel')).not.toBeInTheDocument();
  rerender(<DiscussionPanel {...props} expanded/>);expect(await screen.findByTestId('board-discussion-panel')).toBeVisible();
  fireEvent.keyDown(screen.getByTestId('board-discussion-panel'),{key:'Escape'});expect(onExpandedChange).toHaveBeenLastCalledWith(false);
 });
});
