import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { BoardCommandPort, createWhiteboardDocument, executeCommands, readObjects, WhiteboardCommandOrigin, WhiteboardUndo } from '@repo/whiteboard-core';
import { CollaborativeEditor } from '@/components/whiteboard/collaborative-editor';
import { textSplice } from '@/components/whiteboard/use-whiteboard-document';
import type { BoardFabricGeometry, BoardFabricObject } from '@/components/whiteboard/fabric/board-fabric-object';
const commentHarness=vi.hoisted(()=>({threads:[] as unknown[],dispatch:vi.fn()}));
vi.mock('@/components/whiteboard/board-comments',()=>({listBoardCommentThreads:async()=>commentHarness.threads,dispatchBoardCommentCommand:(...args:unknown[])=>commentHarness.dispatch(...args)}));
beforeEach(()=>{commentHarness.threads=[];commentHarness.dispatch.mockReset().mockResolvedValue({operationId:'accepted',replayed:false,threads:[]});});
vi.mock('@/components/whiteboard/fabric/board-fabric-surface', () => ({
  BoardFabricSurface: ({ objects, onObjectTransform, onSelectionChange }: { objects: readonly BoardFabricObject[]; onObjectTransform: (id: string, geometry: BoardFabricGeometry) => boolean | Promise<boolean>; onSelectionChange: (ids: string[], source: 'canvas') => void }) => <div data-testid="board-fabric-surface"><canvas data-testid="board-fabric-canvas" />{objects.map((object) => <span key={object.id} data-projected-id={object.id} />)}{objects[0] ? <button data-testid="fabric-transform-first" onClick={(event) => { const result = onObjectTransform(objects[0]!.id, { ...objects[0]!.geometry, x: 345 }); event.currentTarget.dataset.accepted = String(result); }}>transform</button> : null}<button data-testid="fabric-select-all" onClick={() => onSelectionChange(objects.map((object) => object.id), 'canvas')}>select all</button></div>,
}));
class ResizeObserverMock { observe() {} disconnect() {} }
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('text diff only replaces the changed span', () => {
  expect(textSplice('早上好世界', '早上美好世界')).toEqual({ index: 2, deleteCount: 0, insert: '美' });
  expect(textSplice('abc', 'ac')).toEqual({ index: 1, deleteCount: 1, insert: '' });
});
it('routes a completed Fabric transform through one identifiable canonical transaction', () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor boardId="board-test" clientId="client-test" doc={doc} readOnly={false} title="白板" status="已连接" />);
  expect(screen.getByTestId('board-fabric-surface')).toBeVisible();
  expect(screen.getByTestId('board-fabric-canvas')).toBeVisible();
  expect(document.querySelector('[data-testid^="whiteboard-object-"]')).toBeNull();
  fireEvent.click(screen.getByTestId('board-add-sticky'));
  const id = readObjects(doc)[0]!.id;
  expect(document.querySelector(`[data-projected-id="${id}"]`)).not.toBeNull();
  const commandTransactions: Y.Transaction[] = [];
  doc.on('afterTransaction', transaction => {
    if (transaction.origin instanceof WhiteboardCommandOrigin) commandTransactions.push(transaction);
  });
  fireEvent.click(screen.getByTestId('fabric-transform-first'));
  expect(readObjects(doc)[0]!.geometry.x).toBe(345);
  expect(commandTransactions).toHaveLength(1);
  expect(commandTransactions[0]?.origin).toMatchObject({
    boardId: 'board-test', clientId: 'client-test', gestureId: expect.any(String),
  });
  fireEvent.change(screen.getByLabelText('对象文字'), { target: { value: '协作文字' } });
  expect(readObjects(doc)[0]!.text).toBe('协作文字');
  act(() => executeCommands(doc, [{ type: 'text', id, index: 4, deleteCount: 0, insert: '远端' }], 'remote'));
  expect(screen.getByLabelText('对象文字')).toHaveValue('协作文字远端');
  fireEvent.click(screen.getByRole('button', {name: '撤销'}));
  expect(readObjects(doc)[0]!.text).toContain('远端');
  doc.destroy();
});
it('returns a rejected transform result, reports it truthfully, and opens no Yjs transaction', () => {
  vi.spyOn(BoardCommandPort.prototype, 'dispatch').mockReturnValue(null as never);
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: 'create', object: { id: 'reject-note', schemaVersion: 1, kind: 'sticky', geometry: { x: 10, y: 20, width: 180, height: 140, rotation: 0 }, text: '保留原位置', style: {}, parentId: null, orderKey: '' } }], 'seed');
  render(<CollaborativeEditor boardId="board-test" clientId="client-test" doc={doc} readOnly={false} title="白板" status="已连接" />);
  const transactions: Y.Transaction[] = [];
  doc.on('afterTransaction', transaction => transactions.push(transaction));

  fireEvent.click(screen.getByTestId('fabric-transform-first'));

  expect(screen.getByTestId('fabric-transform-first')).toHaveAttribute('data-accepted', 'false');
  expect(screen.getByText('操作未应用：命令通道尚未就绪，请重试。', { exact: true })).toBeVisible();
  expect(transactions).toHaveLength(0);
  expect(readObjects(doc)[0]!.geometry.x).toBe(10);
  doc.destroy();
});
it('read-only disables mutation controls and does not alter the document', () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor boardId="board-test" clientId="client-test" doc={doc} readOnly title="只读白板" status="已连接" />);
  expect(screen.getByTestId('board-add-sticky')).toBeDisabled();
  expect(screen.getByTestId('board-add-draw')).toBeDisabled();
  expect(screen.getByRole('button', {name: '粘贴'})).toBeDisabled();
  expect(screen.getByLabelText('白板名称')).toBeDisabled();
  fireEvent.click(screen.getByTestId('board-add-sticky'));
  expect(readObjects(doc)).toEqual([]); doc.destroy();
});
it('undoes and redoes object creation as one local operation', () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor boardId="board-test" clientId="client-test" doc={doc} readOnly={false} title="白板" status="已连接" />);
  fireEvent.click(screen.getByTestId('board-add-sticky')); fireEvent.click(screen.getByRole('button', {name: '撤销'}));
  expect(readObjects(doc)).toHaveLength(0); expect(screen.getByText('撤销已在本地应用，正在等待服务器确认')).toBeVisible();
  fireEvent.click(screen.getByRole('button', {name: '重做'}));
  expect(readObjects(doc)).toHaveLength(1); expect(screen.getByText('重做已在本地应用，正在等待服务器确认')).toBeVisible(); doc.destroy();
});
it('IME keeps remote text and preserves the uncommitted composition draft', () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor boardId="board-test" clientId="client-test" doc={doc} readOnly={false} title="白板" status="已连接" />);
  fireEvent.click(screen.getByTestId('board-add-sticky'));
  const id = readObjects(doc)[0]!.id, input = screen.getByLabelText('对象文字');
  fireEvent.compositionStart(input); fireEvent.change(input, { target: { value: '组合输入' } });
  act(() => executeCommands(doc, [{ type: 'text', id, index: 0, deleteCount: 0, insert: '远端' }], 'remote'));
  fireEvent.compositionEnd(input);
  expect(readObjects(doc)[0]!.text).toBe('远端写下一个想法');
  expect(screen.getByLabelText('未应用的输入草稿')).toHaveValue('组合输入');
  doc.destroy();
});
it('reports world coordinates after zoom and renders server peer cursors/selections', () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: 'create', object: { id: 'peer-note', schemaVersion: 1, kind: 'sticky', geometry: {x:10,y:20,width:180,height:140,rotation:0}, text:'远端便签',style:{},parentId:null,orderKey:''} }], 'remote');
  const positions: Array<{x:number;y:number}|null> = [];
  render(<CollaborativeEditor boardId="board-test" clientId="client-test" doc={doc} readOnly={false} title="白板" status="已连接" currentUserId="me" peers={[{actorId:'other',displayName:'Other',principalKind:'user',avatarUrl:null,viewport:{centerX:30,centerY:40,zoom:1,revision:1},presenting:false,followingActorId:null,contributorColor:'#3366FF',cursor:{x:30,y:40},selected:['peer-note'],editingObjectId:null,expiresAt:'2099-01-01T00:00:00.000Z'},{actorId:'me',displayName:'Me',principalKind:'user',avatarUrl:null,viewport:null,presenting:false,followingActorId:null,contributorColor:'#FF6633',cursor:{x:2,y:3},selected:[],editingObjectId:null,expiresAt:'2099-01-01T00:00:00.000Z'}]} onAwareness={cursor=>positions.push(cursor)}/>);
  expect(screen.getByTestId('peer-cursor-other')).toHaveStyle({left:'30px',top:'40px'});
  expect(screen.getByTestId('peer-selection-other-peer-note')).toHaveStyle({left:'10px',top:'20px'});
  expect(screen.queryByTestId('peer-cursor-me')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name:'放大'}));
  fireEvent(screen.getByTestId('board-live-surface'),new MouseEvent('pointermove',{bubbles:true,clientX:110,clientY:220}));
  expect(positions.at(-1)?.x).toBeCloseTo(100); expect(positions.at(-1)?.y).toBeCloseTo(200);
  doc.destroy();
});

it('exposes every multi-selection layout action and commits grid as one canonical transaction', () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [0, 1, 2, 3].map((index) => ({ type: 'create' as const, object: { id: `layout-${index}`, schemaVersion: 1 as const, kind: 'sticky' as const, geometry: { x: index * 37, y: index * 19, width: 100, height: 80, rotation: 0 }, text: String(index), style: {}, parentId: null, orderKey: String(index) } })), 'seed');
  render(<CollaborativeEditor boardId="board-test" clientId="client-test" doc={doc} readOnly={false} title="白板" status="已连接" />);
  fireEvent.click(screen.getByTestId('fabric-select-all'));
  fireEvent.click(screen.getByRole('button', {name: '布局'}));
  for (const kind of ['align-left', 'align-center', 'align-right', 'align-top', 'align-middle', 'align-bottom', 'distribute-horizontal', 'distribute-vertical', 'equal-width', 'equal-height', 'equal-size', 'grid', 'row', 'column', 'tidy-up']) expect(screen.getByTestId(`board-layout-${kind}`)).toBeEnabled();
  fireEvent.change(screen.getByLabelText('布局间距'), { target: { value: '24' } });
  fireEvent.change(screen.getByLabelText('网格列数'), { target: { value: '2' } });
  const transactions: Y.Transaction[] = [];
  doc.on('afterTransaction', transaction => { if (transaction.origin instanceof WhiteboardCommandOrigin) transactions.push(transaction); });
  fireEvent.click(screen.getByTestId('board-layout-grid'));
  const arranged = readObjects(doc);
  expect(arranged.map((object) => [object.geometry.x, object.geometry.y])).toEqual([[0, 0], [124, 0], [0, 104], [124, 104]]);
  expect(transactions).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', {name: '撤销'}));
  expect(readObjects(doc).map((object) => object.geometry.x)).toEqual([0, 37, 74, 111]);
  doc.destroy();
});

it('smart layout preview is zero-write, cancelable, applicable and conflict guarded', () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [0, 1, 2].map(index => ({ type: 'create' as const, object: { id: `smart-${index}`, schemaVersion: 1 as const, kind: 'sticky' as const, geometry: { x: index * 51, y: index * 37, width: 100, height: 80, rotation: 0 }, text: String(index), style: {}, parentId: null, orderKey: String(index) } })), 'seed');
  render(<CollaborativeEditor boardId="board-test" clientId="client-test" doc={doc} readOnly={false} title="白板" status="已连接" />);
  fireEvent.click(screen.getByTestId('fabric-select-all'));
  fireEvent.click(screen.getByRole('button', {name: '布局'}));
  const before = readObjects(doc);
  fireEvent.click(screen.getByTestId('board-layout-smart-preview'));
  expect(screen.getByTestId('board-layout-preview')).toBeVisible();
  expect(readObjects(doc)).toEqual(before);
  expect(screen.getByRole('button', {name: '撤销'})).toBeDisabled();
  expect(screen.getByRole('button', {name: '删除选中'})).toBeDisabled();
  expect(screen.getByTestId('board-add-sticky')).toBeDisabled();
  expect(screen.getByTestId('board-layout-grid')).toBeDisabled();
  fireEvent.click(screen.getByTestId('fabric-transform-first'));
  fireEvent.keyDown(window, { key: 'n' });
  fireEvent.keyDown(window, { key: 't' });
  expect(readObjects(doc)).toEqual(before);
  fireEvent.click(screen.getByTestId('board-layout-preview-cancel'));
  expect(readObjects(doc)).toEqual(before);
  for (const suggestion of ['grid', 'cards', 'cluster', 'journey', 'mind-map', 'flow', 'timeline']) {
    fireEvent.click(screen.getByTestId(`board-smart-${suggestion}`));
    expect(screen.getByTestId('board-layout-preview')).toBeVisible();
    expect(readObjects(doc)).toEqual(before);
    fireEvent.click(screen.getByTestId('board-layout-preview-cancel'));
  }
  fireEvent.click(screen.getByTestId('board-layout-smart-preview'));
  executeCommands(doc, [{ type: 'style', id: 'smart-0', style: { fill: '#112233' } }], 'remote');
  fireEvent.click(screen.getByTestId('board-layout-preview-apply'));
  expect(screen.getByText('应用失败：预览后对象已被其他协作者修改。')).toBeVisible();
  doc.destroy();
});

it('disables contextual layout when the board or any selected object is locked', () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [
    { type: 'create', object: { id: 'free', schemaVersion: 1, kind: 'sticky', geometry: { x: 0, y: 0, width: 100, height: 80, rotation: 0 }, text: '', style: {}, parentId: null, orderKey: 'a' } },
    { type: 'create', object: { id: 'locked', schemaVersion: 1, kind: 'sticky', geometry: { x: 140, y: 0, width: 100, height: 80, rotation: 0 }, text: '', style: {}, parentId: null, orderKey: 'b', locked: true } },
  ], 'seed');
  const view = render(<CollaborativeEditor boardId="board-test" clientId="client-test" doc={doc} readOnly={false} title="白板" status="已连接" />);
  fireEvent.click(screen.getByTestId('fabric-select-all'));
  fireEvent.click(screen.getByRole('button', {name: '布局'}));
  expect(screen.getByTestId('board-layout-grid')).toBeDisabled();
  view.rerender(<CollaborativeEditor boardId="board-test" clientId="client-test" doc={doc} readOnly title="白板" status="已连接" />);
  expect(screen.getByTestId('board-layout-align-left')).toBeDisabled();
  doc.destroy();
});

it.each([
  ['undone', '撤销已在本地应用，正在等待服务器确认'],
  ['conflict', '未撤销：当前画板与这次修改存在冲突，请核对后再操作。'],
  ['empty', '没有可撤销的本地修改。'],
] as const)('announces the actual undo result %s', (result, message) => {
  vi.spyOn(WhiteboardUndo.prototype, 'undo').mockReturnValue(result);
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor boardId="board-test" clientId="client-test" doc={doc} readOnly={false} title="白板" status="已连接" />);
  fireEvent.click(screen.getByRole('button', {name: '撤销'}));
  expect(screen.getByText(message, { exact: true })).toBeVisible();
  if (result !== 'undone') expect(screen.queryByText('撤销已在本地应用，正在等待服务器确认', { exact: true })).toBeNull();
  doc.destroy();
});
it.each([true, false])('announces redo success only when core returns %s', result => {
  vi.spyOn(WhiteboardUndo.prototype, 'redo').mockReturnValue(result);
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor boardId="board-test" clientId="client-test" doc={doc} readOnly={false} title="白板" status="已连接" />);
  fireEvent.click(screen.getByRole('button', {name: '重做'}));
  expect(screen.getByText(result ? '重做已在本地应用，正在等待服务器确认' : '未重做：没有可重做的本地修改，或当前画板存在冲突。', { exact: true })).toBeVisible();
  if (!result) expect(screen.queryByText('重做已在本地应用，正在等待服务器确认', { exact: true })).toBeNull();
  doc.destroy();
});
it('announces undo durability only after the exact update gesture receipt',()=>{
  const undo=vi.spyOn(WhiteboardUndo.prototype,'undo').mockReturnValue('undone');
  const doc=createWhiteboardDocument(),view=render(<CollaborativeEditor boardId="board-test" clientId="client-test" doc={doc} readOnly={false} title="白板" status="已同步 · 序列 4" lastAckSequence={4}/>);
  fireEvent.click(screen.getByRole('button', {name: '撤销'}));
  const gestureId=undo.mock.calls[0]?.[0];expect(gestureId).toEqual(expect.any(String));
  expect(screen.getByText('撤销已在本地应用，正在等待服务器确认',{exact:true})).toBeVisible();
  view.rerender(<CollaborativeEditor boardId="board-test" clientId="client-test" doc={doc} readOnly={false} title="白板" status="已同步 · 序列 4" lastAckSequence={4}/>);
  expect(screen.queryByText(/撤销已由服务器确认/)).toBeNull();
  view.rerender(<CollaborativeEditor boardId="board-test" clientId="client-test" doc={doc} readOnly={false} title="白板" status="已同步 · 序列 5" lastAckSequence={5} lastAckReceipt={{updateId:crypto.randomUUID(),gestureId:'different-gesture',seq:5}}/>);
  expect(screen.queryByText(/撤销已由服务器确认/)).toBeNull();
  view.rerender(<CollaborativeEditor boardId="board-test" clientId="client-test" doc={doc} readOnly={false} title="白板" status="已同步 · 序列 6" lastAckSequence={6} lastAckReceipt={{updateId:crypto.randomUUID(),gestureId:gestureId!,seq:6}}/>);
  expect(screen.getByText('撤销已由服务器确认 · 序列 6',{exact:true})).toBeVisible();doc.destroy();
});

it('commenter can start another discussion on an already commented object while object editing stays disabled',async()=>{
 const doc=createWhiteboardDocument();executeCommands(doc,[{type:'create',object:{id:'commented-note',schemaVersion:1,kind:'sticky',geometry:{x:0,y:0,width:180,height:180,rotation:0},text:'Discuss',style:{},parentId:null,orderKey:''}}],{});
 commentHarness.threads=[{id:'existing',objectId:'commented-note',status:'open',revision:1,comments:[{id:'c',authorId:'other',body:'Existing discussion',mentions:[],deletedAt:null}]}];
 const props={boardId:'board-test',clientId:'commenter',doc,readOnly:true,role:'commenter' as const,title:'Board',status:'online'};
 const view=render(<CollaborativeEditor {...props}/>);fireEvent.click(screen.getByTestId('fabric-select-all'));fireEvent.click(screen.getByRole('button',{name:'评论'}));
 await screen.findByText(/Existing discussion/);fireEvent.change(screen.getByLabelText('评论内容'),{target:{value:'Another discussion'}});
 expect(screen.getByRole('button',{name:'发布评论'})).toBeEnabled();expect(screen.getByTestId('board-add-sticky')).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'发布评论'}));await waitFor(()=>expect(commentHarness.dispatch).toHaveBeenCalledWith('board-test',expect.objectContaining({type:'create-comment',objectId:'commented-note',body:'Another discussion'})));
 view.rerender(<CollaborativeEditor {...props} role="viewer"/>);fireEvent.change(screen.getByLabelText('评论内容'),{target:{value:'Forbidden'}});expect(screen.getByRole('button',{name:'发布评论'})).toBeDisabled();
 view.rerender(<CollaborativeEditor {...props} commentsReadOnly/>);expect(screen.getByRole('button',{name:'发布评论'})).toBeDisabled();
 expect(screen.getByTestId('collaborative-editor')).toHaveClass('relative','h-full');expect(screen.getByTestId('collaborative-editor')).not.toHaveClass('fixed');
 view.unmount();doc.destroy();
});
