import { describe,expect,it,vi,beforeEach } from 'vitest';
import { render,screen,fireEvent,waitFor,cleanup } from '@testing-library/react';
import { ChatDiagramBoardHandoff } from '../../components/chat/chat-diagram-board-handoff';
const mocks=vi.hoisted(()=>({insert:vi.fn(),preview:vi.fn(),list:vi.fn()}));
vi.mock('@/lib/live-whiteboard',()=>({listBoards:mocks.list}));
vi.mock('@/lib/whiteboard-operation-client',()=>({insertRenderedArtifact:mocks.insert,readBoardPlacementPreview:mocks.preview}));
vi.mock('@/components/ui/dialog',()=>({Dialog:({children,open}:any)=>open?<div>{children}</div>:null,DialogContent:({children}:any)=><div>{children}</div>,DialogDescription:({children}:any)=><p>{children}</p>,DialogTitle:({children}:any)=><h2>{children}</h2>}));
const model={kind:'flowchart' as const,direction:'TD' as const,nodes:[{id:'a',label:'A',shape:'rect' as const,x:100,y:100,width:100,height:50}],edges:[]};
beforeEach(()=>{cleanup();vi.clearAllMocks();mocks.list.mockResolvedValue({items:[{id:'board',name:'Board'}]});mocks.preview.mockResolvedValue({boardId:'board',revision:{epoch:1,seq:7},role:'owner',archived:false,objects:[]});});
async function open(){render(<ChatDiagramBoardHandoff model={model} artifactId="artifact" orgId="org" sourceRevision="artifact-v1:1"/>);fireEvent.click(screen.getByTestId('chat-diagram-insert-board'));await waitFor(()=>expect(screen.getByTestId('chat-board-handoff-confirm')).not.toBeDisabled());}
describe('Chat handoff retry identity',()=>{
  it('reuses the complete request after an ambiguous network failure',async()=>{
    mocks.insert.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({});await open();
    fireEvent.click(screen.getByTestId('chat-board-handoff-confirm'));await screen.findByText(/重试保留本次请求身份/);
    fireEvent.click(screen.getByTestId('chat-board-handoff-confirm'));await screen.findByText('已插入目标白板');
    expect(mocks.insert).toHaveBeenCalledTimes(2);expect(mocks.insert.mock.calls[1]![0]).toEqual(mocks.insert.mock.calls[0]![0]);expect(mocks.preview).toHaveBeenCalledTimes(1);
  });
  it('replaces coordinate inputs with a keyboard adjustable placement preview',async()=>{
    mocks.insert.mockResolvedValue({});await open();
    expect(screen.queryByLabelText('X 坐标')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Y 坐标')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId('chat-board-placement-preview'),{key:'ArrowRight'});
    fireEvent.click(screen.getByTestId('chat-board-handoff-confirm'));await screen.findByText('已插入目标白板');
    expect(mocks.insert.mock.calls[0]![0].offset.x).toBeGreaterThan(-50);
    expect(mocks.insert.mock.calls[0]![0]).toMatchObject({epoch:1,seq:7,offset:{y:-75}});
  });
  it('does not write while the preview is unavailable',async()=>{
    mocks.preview.mockRejectedValue(new Error('network'));
    render(<ChatDiagramBoardHandoff model={model} artifactId="artifact" orgId="org" sourceRevision="artifact-v1:1"/>);
    fireEvent.click(screen.getByTestId('chat-diagram-insert-board'));await screen.findByText('无法读取白板布局，请重试。');
    expect(screen.getByTestId('chat-board-handoff-confirm')).toBeDisabled();expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('refreshes stale placement before another attempt',async()=>{
    mocks.insert.mockRejectedValueOnce(new Error('BOARD_OPERATION_CONFLICT'));await open();
    fireEvent.click(screen.getByTestId('chat-board-handoff-confirm'));await screen.findByText('白板已变化，请刷新位置预览后重新确认。');
    expect(screen.getByTestId('chat-board-handoff-confirm')).toBeDisabled();
    mocks.preview.mockResolvedValue({boardId:'board',revision:{epoch:1,seq:8},role:'owner',archived:false,objects:[]});mocks.insert.mockResolvedValue({});
    fireEvent.click(screen.getByText('刷新位置预览'));await waitFor(()=>expect(screen.getByTestId('chat-board-handoff-confirm')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('chat-board-handoff-confirm'));await screen.findByText('已插入目标白板');
    expect(mocks.insert.mock.calls[1]![0].requestId).not.toBe(mocks.insert.mock.calls[0]![0].requestId);
    expect(mocks.insert.mock.calls[1]![0].seq).toBe(8);
  });
  it.each([{role:'viewer',archived:false},{role:'commenter',archived:false},{role:'owner',archived:true}])('blocks insertion into read-only or archived targets %j',async state=>{
    mocks.preview.mockResolvedValue({boardId:'board',revision:{epoch:1,seq:7},objects:[],...state});
    render(<ChatDiagramBoardHandoff model={model} artifactId="artifact" orgId="org" sourceRevision="artifact-v1:1"/>);
    fireEvent.click(screen.getByTestId('chat-diagram-insert-board'));await screen.findByText(state.archived?'此白板已归档，请选择其他白板。':'你只有此白板的查看权限，请选择可编辑的白板。');
    expect(screen.getByTestId('chat-board-handoff-confirm')).toBeDisabled();
  });
});
