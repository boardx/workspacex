import {createWhiteboardDocument,executeCommands,type WhiteboardObject} from '@repo/whiteboard-core';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {BoardOrganizeControls} from '@/components/whiteboard/board-organize-controls';
const calls=vi.hoisted(()=>({actors:vi.fn(async()=>[{actorId:'agent',model:'configured/model',skill:'skill'}]),organize:vi.fn(),undo:vi.fn()}));
vi.mock('@/lib/whiteboard-operation-client',()=>({boardOrganizeActors:calls.actors,organizeBoard:calls.organize,undoAIProposal:calls.undo}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('submits selected identities rather than authored cluster commands and emits proposal',async()=>{const onProposal=vi.fn(),proposal={proposalId:'p'};calls.organize.mockResolvedValue(proposal);render(<BoardOrganizeControls boardId="b" selectedIds={['one','two']} readOnly={false} onProposal={onProposal} undo={null} onUndone={()=>{}}/>);await waitFor(()=>expect(screen.getByTestId('board-ai-organize')).toBeEnabled());fireEvent.click(screen.getByTestId('board-ai-organize'));await waitFor(()=>expect(calls.organize).toHaveBeenCalledWith('b','agent',['one','two']));expect(onProposal).toHaveBeenCalledWith(proposal);});
it('shows stale undo honestly and does not clear receipt on rejected inverse',async()=>{calls.undo.mockRejectedValue(new Error('BOARD_OPERATION_CONFLICT'));const onUndone=vi.fn();render(<BoardOrganizeControls boardId="b" selectedIds={[]} readOnly={false} onProposal={()=>{}} undo={{boardId:'b',proposalId:'00000000-0000-4000-8000-000000000001',operationId:'00000000-0000-4000-8000-000000000002',expectedRevision:{epoch:1,seq:2},createdAt:'2026-09-26T00:00:00.000Z'}} onUndone={onUndone}/>);fireEvent.click(screen.getByRole('button',{name:'AI 整理选项和状态'}));fireEvent.click(screen.getByTestId('board-ai-undo'));await waitFor(()=>expect(screen.getAllByText('白板已被修改，不能覆盖这些修改；AI 撤销未执行。').length).toBeGreaterThan(0));expect(onUndone).not.toHaveBeenCalled();});
it('does not expose mutation controls to read-only members',()=>{render(<BoardOrganizeControls boardId="b" selectedIds={['one','two']} readOnly onProposal={()=>{}} undo={null} onUndone={()=>{}}/>);expect(screen.queryByTestId('board-ai-organize')).toBeNull();expect(calls.actors).not.toHaveBeenCalled();});

it('disables AI for drawings and reacts to live canonical locking of selected stickies',async()=>{
 const doc=createWhiteboardDocument();
 const note=(id:string,kind:WhiteboardObject['kind']='sticky'):WhiteboardObject=>({id,schemaVersion:1,kind,geometry:{x:0,y:0,width:180,height:180,rotation:0},text:id,style:{},parentId:null,orderKey:id});
 executeCommands(doc,[{type:'create',object:note('one')},{type:'create',object:note('two','drawing')}],'seed');
 const view=render(<BoardOrganizeControls doc={doc} boardId="b" selectedIds={['one','two']} readOnly={false} onProposal={()=>{}} undo={null} onUndone={()=>{}}/>);
 await waitFor(()=>expect(calls.actors).toHaveBeenCalled());
 expect(screen.getByTestId('board-ai-organize')).toBeDisabled();
 expect(screen.getByTestId('board-ai-organize').title).toContain('绘图');
 act(()=>executeCommands(doc,[{type:'create',object:note('three')}],'seed'));
 view.rerender(<BoardOrganizeControls doc={doc} boardId="b" selectedIds={['one','three']} readOnly={false} onProposal={()=>{}} undo={null} onUndone={()=>{}}/>);
 await waitFor(()=>expect(screen.getByTestId('board-ai-organize')).toBeEnabled());
 act(()=>executeCommands(doc,[{type:'state',id:'three',locked:true}],'remote'));
 expect(screen.getByTestId('board-ai-organize')).toBeDisabled();
 doc.destroy();
});
