import { describe,expect,it,vi,beforeEach } from 'vitest';
import { render,screen,fireEvent,waitFor,cleanup } from '@testing-library/react';
import { ChatDiagramBoardHandoff } from '../../components/chat/chat-diagram-board-handoff';
const mocks=vi.hoisted(()=>({insert:vi.fn(),head:vi.fn(),list:vi.fn()}));
vi.mock('@/lib/live-whiteboard',()=>({listBoards:mocks.list}));
vi.mock('@/lib/whiteboard-operation-client',()=>({insertRenderedArtifact:mocks.insert,readBoardHead:mocks.head}));
vi.mock('@/components/ui/dialog',()=>({Dialog:({children,open}:any)=>open?<div>{children}</div>:null,DialogContent:({children}:any)=><div>{children}</div>,DialogDescription:({children}:any)=><p>{children}</p>,DialogTitle:({children}:any)=><h2>{children}</h2>}));
const model={kind:'flowchart' as const,direction:'TD' as const,nodes:[{id:'a',label:'A',shape:'rect' as const,x:100,y:100,width:100,height:50}],edges:[]};
beforeEach(()=>{cleanup();vi.clearAllMocks();mocks.list.mockResolvedValue({items:[{id:'board',name:'Board'}]});mocks.head.mockResolvedValue({epoch:1,seq:7});});
async function open(){render(<ChatDiagramBoardHandoff model={model} artifactId="artifact" orgId="org" sourceRevision="artifact-v1:1"/>);fireEvent.click(screen.getByTestId('chat-diagram-insert-board'));await waitFor(()=>expect(screen.getByTestId('chat-board-handoff-confirm')).not.toBeDisabled());}
describe('Chat handoff retry identity',()=>{
  it('reuses the complete request after an ambiguous network failure',async()=>{
    mocks.insert.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({});await open();
    fireEvent.click(screen.getByTestId('chat-board-handoff-confirm'));await screen.findByText(/重试保留本次请求身份/);
    fireEvent.click(screen.getByTestId('chat-board-handoff-confirm'));await screen.findByText('已插入目标白板');
    expect(mocks.insert).toHaveBeenCalledTimes(2);expect(mocks.insert.mock.calls[1]![0]).toEqual(mocks.insert.mock.calls[0]![0]);expect(mocks.head).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid coordinates before creating any operation',async()=>{
    await open();fireEvent.change(screen.getByLabelText('X 坐标'),{target:{value:'not-a-number'}});fireEvent.click(screen.getByTestId('chat-board-handoff-confirm'));await screen.findByText('请输入有效的世界坐标。');expect(mocks.insert).not.toHaveBeenCalled();
  });
});
