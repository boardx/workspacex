import { describe,expect,it,vi,beforeEach } from 'vitest';
import { render,screen,fireEvent,waitFor,cleanup,act } from '@testing-library/react';
import { ChatDiagramBoardHandoff } from '../../components/chat/chat-diagram-board-handoff';
const mocks=vi.hoisted(()=>({insert:vi.fn(),preview:vi.fn(),list:vi.fn(),resources:vi.fn()}));
vi.mock('@/lib/live-project-resources',()=>({listProjectResources:mocks.resources}));
vi.mock('@/lib/live-whiteboard',()=>({listBoards:mocks.list}));
vi.mock('@/lib/whiteboard-operation-client',()=>({insertRenderedArtifact:mocks.insert,readBoardPlacementPreview:mocks.preview}));
vi.mock('@/components/ui/dialog',()=>({Dialog:({children,open}:any)=>open?<div>{children}</div>:null,DialogContent:({children}:any)=><div>{children}</div>,DialogDescription:({children}:any)=><p>{children}</p>,DialogTitle:({children}:any)=><h2>{children}</h2>}));
const model={kind:'flowchart' as const,direction:'TD' as const,nodes:[{id:'a',label:'A',shape:'rect' as const,x:100,y:100,width:100,height:50}],edges:[]};
beforeEach(()=>{cleanup();vi.clearAllMocks();mocks.list.mockReset();mocks.resources.mockReset();mocks.preview.mockReset();mocks.insert.mockReset();mocks.list.mockResolvedValue({items:[{id:'board',name:'Board'}]});mocks.preview.mockResolvedValue({boardId:'board',revision:{epoch:1,seq:7},role:'owner',archived:false,objects:[]});});
async function open(props: {projectId?:string} = {}){render(<ChatDiagramBoardHandoff {...props} model={model} artifactId="artifact" orgId="org" sourceRevision="artifact-v1:1"/>);fireEvent.click(screen.getByTestId('chat-diagram-insert-board'));await waitFor(()=>expect(screen.getByTestId('chat-board-handoff-confirm')).not.toBeDisabled());}
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

it('lists only project-linked boards for a project conversation',async()=>{
  mocks.resources.mockResolvedValue({items:[{kind:'whiteboard',id:'board',title:'Project target'},{kind:'survey',id:'survey',title:'Other resource'}]});
  await open({projectId:'project-1'});
  expect(mocks.resources).toHaveBeenCalledWith('project-1');
  expect(mocks.list).not.toHaveBeenCalled();
  expect(screen.getByTestId('chat-board-target')).toHaveTextContent('Project target');
});
it('loads every organization board page before presenting targets',async()=>{
  mocks.list.mockResolvedValueOnce({items:[{id:'board',name:'First'}],nextCursor:'page-2'}).mockResolvedValueOnce({items:[{id:'later-board',name:'Later'}],nextCursor:null});
  await open();
  expect(mocks.list).toHaveBeenCalledTimes(2);
  expect(mocks.list.mock.calls[1]![0]).toMatchObject({cursor:'page-2'});
});
it('offers the selected persisted board after confirmed insertion',async()=>{
  mocks.resources.mockResolvedValue({items:[{kind:'whiteboard',id:'board',title:'Project target'}]});
  mocks.insert.mockResolvedValue({});
  await open({projectId:'project-1'});
  expect(screen.queryByTestId('chat-board-open-inserted')).toBeNull();
  fireEvent.click(screen.getByTestId('chat-board-handoff-confirm'));
  const link=await screen.findByTestId('chat-board-open-inserted');
  const target=new URL(link.getAttribute('href')!,'http://fixture');
  expect(target.pathname).toBe('/studio/board/board');expect(target.searchParams.get('projectId')).toBe('project-1');
  expect(target.searchParams.get('focusArtifact')).toBe('artifact');expect(target.searchParams.get('focusLayout')).toBe(mocks.insert.mock.calls[0]![0].layout.layoutHash);
  expect(mocks.insert.mock.calls[0]![0].boardId).toBe('board');
});
it('shows the insertion region in red using the shared minimap scene',async()=>{
  await open();
  expect(screen.getByTestId('chat-board-placement-range')).toHaveClass('stroke-destructive');
  expect(screen.getByTestId('chat-board-placement-preview')).toHaveAttribute('viewBox','0 0 240 160');
});
it('discards a late list after the project changes without exposing stale targets',async()=>{
  let resolveOld!:(value:unknown)=>void;
  mocks.resources.mockImplementation((id:string)=>id==='old-project'?new Promise(resolve=>{resolveOld=resolve;}):Promise.resolve({items:[{kind:'whiteboard',id:'board',title:'New project board'}]}));
  const view=render(<ChatDiagramBoardHandoff model={model} artifactId="artifact" orgId="org" sourceRevision="artifact-v1:1" projectId="old-project"/>);
  fireEvent.click(screen.getByTestId('chat-diagram-insert-board'));
  view.rerender(<ChatDiagramBoardHandoff model={model} artifactId="artifact" orgId="org" sourceRevision="artifact-v1:1" projectId="new-project"/>);
  fireEvent.click(screen.getByTestId('chat-diagram-insert-board'));
  await waitFor(()=>expect(screen.getByTestId('chat-board-target')).toHaveTextContent('New project board'));
  await act(async()=>{resolveOld({items:[{kind:'whiteboard',id:'stale-board',title:'Old project board'}]});});
  await waitFor(()=>expect(mocks.resources).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId('chat-board-target')).toHaveTextContent('New project board');
  expect(mocks.preview).not.toHaveBeenCalledWith('stale-board',expect.anything());
  expect(mocks.insert).not.toHaveBeenCalled();
});
it('cancels preview without issuing a board mutation',async()=>{
  await open();fireEvent.click(screen.getByText('取消'));
  expect(screen.queryByTestId('chat-board-handoff-confirm')).toBeNull();
  expect(mocks.insert).not.toHaveBeenCalled();
});
it('prepares a fresh generated source only on confirmation and pins it for ambiguous retries',async()=>{
  const prepare=vi.fn().mockResolvedValue({artifactId:'new-artifact',sourceRevision:'artifact-v1:3'});
  render(<ChatDiagramBoardHandoff model={model} orgId="org" prepareSource={prepare}/>);
  fireEvent.click(screen.getByTestId('chat-diagram-insert-board'));
  await waitFor(()=>expect(screen.getByTestId('chat-board-handoff-confirm')).not.toBeDisabled());
  expect(prepare).not.toHaveBeenCalled();
  mocks.insert.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({});
  fireEvent.click(screen.getByTestId('chat-board-handoff-confirm'));await screen.findByText(/重试保留本次请求身份/);
  fireEvent.click(screen.getByTestId('chat-board-handoff-confirm'));await screen.findByText('已插入目标白板');
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(mocks.insert.mock.calls[0]![0].layout).toMatchObject({artifactId:'new-artifact',sourceRevision:'artifact-v1:3'});
  expect(mocks.insert.mock.calls[1]![0]).toEqual(mocks.insert.mock.calls[0]![0]);
});
it('does not insert a provisional preview if source persistence fails',async()=>{
 const prepare=vi.fn().mockRejectedValue(new Error('unavailable'));
 render(<ChatDiagramBoardHandoff model={model} orgId="org" prepareSource={prepare}/>);
 fireEvent.click(screen.getByTestId('chat-diagram-insert-board'));await waitFor(()=>expect(screen.getByTestId('chat-board-handoff-confirm')).not.toBeDisabled());
 fireEvent.click(screen.getByTestId('chat-board-handoff-confirm'));await screen.findByText(/插入失败/);
 expect(mocks.insert).not.toHaveBeenCalled();
});

it('ignores distant hidden objects when recommending the initial insertion position',async()=>{
 mocks.preview.mockResolvedValue({boardId:'board',revision:{epoch:1,seq:7},role:'owner',archived:false,objects:[{id:'hidden',geometry:{x:100000,y:100000,width:200,height:200,rotation:0},appearance:{hidden:true,kind:'rectangle',style:{}}}]});
 mocks.insert.mockResolvedValue({});await open();
 fireEvent.click(screen.getByTestId('chat-board-handoff-confirm'));await screen.findByText('已插入目标白板');
 expect(mocks.insert.mock.calls[0]![0].offset).toEqual({x:-50,y:-75});
});

it('keeps the loaded placement when the current Board is selected again',async()=>{
 await open();
 fireEvent.keyDown(screen.getByTestId('chat-board-target'),{key:'Enter'});
 fireEvent.click(await screen.findByRole('menuitemradio',{name:'Board'}));
 expect(screen.getByTestId('chat-board-placement-preview')).toBeInTheDocument();
 expect(screen.getByTestId('chat-board-handoff-confirm')).not.toBeDisabled();
});

it('prepares canonical transport even when a saved editing artifact exists',async()=>{
 const prepare=vi.fn().mockResolvedValue({artifactId:'canonical',sourceRevision:'artifact-v1:2'});
 mocks.insert.mockResolvedValue({});
 render(<ChatDiagramBoardHandoff model={model} orgId="org" artifactId="saved-noncanonical" sourceRevision="artifact-v1:1" prepareSource={prepare}/>);
 fireEvent.click(screen.getByTestId('chat-diagram-insert-board'));
 await waitFor(()=>expect(screen.getByTestId('chat-board-handoff-confirm')).not.toBeDisabled());
 expect(prepare).not.toHaveBeenCalled();
 fireEvent.click(screen.getByTestId('chat-board-handoff-confirm'));
 await screen.findByText('已插入目标白板');
 expect(prepare).toHaveBeenCalledTimes(1);
 expect(mocks.insert.mock.calls[0]![0].layout).toMatchObject({artifactId:'canonical',sourceRevision:'artifact-v1:2'});
});
