import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createWhiteboardDocument, executeCommands, readObjects } from '@repo/whiteboard-core';
import { CollaborativeEditor } from '@/components/whiteboard/collaborative-editor';
import { textSplice } from '@/components/whiteboard/use-whiteboard-document';
afterEach(cleanup);
it('text diff only replaces the changed span', () => {
  expect(textSplice('早上好世界', '早上美好世界')).toEqual({ index: 2, deleteCount: 0, insert: '美' });
  expect(textSplice('abc', 'ac')).toEqual({ index: 1, deleteCount: 1, insert: '' });
});
it('commands change Y.Doc and remote changes render without snapshots', () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor doc={doc} readOnly={false} title="白板" status="已连接" />);
  fireEvent.click(screen.getByTestId('board-add-sticky'));
  const id = readObjects(doc)[0]!.id;
  fireEvent.change(screen.getByLabelText('对象文字'), { target: { value: '协作文字' } });
  expect(readObjects(doc)[0]!.text).toBe('协作文字');
  act(() => executeCommands(doc, [{ type: 'text', id, index: 4, deleteCount: 0, insert: '远端' }], 'remote'));
  expect(screen.getByLabelText('对象文字')).toHaveValue('协作文字远端');
  fireEvent.click(screen.getByText('撤销', { exact: true }));
  expect(readObjects(doc)[0]!.text).toContain('远端');
  doc.destroy();
});
it('read-only disables mutation controls and does not alter the document', () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor doc={doc} readOnly title="只读白板" status="已连接" />);
  expect(screen.getByTestId('board-add-sticky')).toBeDisabled();
  expect(screen.getByTestId('board-group')).toBeDisabled();
  expect(screen.getByTestId('board-ungroup')).toBeDisabled();
  expect(screen.getByTestId('board-add-frame')).toBeDisabled();
  expect(screen.getByText('画笔', { exact: true })).toBeDisabled();
  expect(screen.getByText('粘贴', { exact: true })).toBeDisabled();
  expect(screen.getByLabelText('白板名称')).toBeDisabled();
  fireEvent.click(screen.getByTestId('board-add-sticky'));
  expect(readObjects(doc)).toEqual([]); doc.destroy();
});
it('groups a multi-selection, wraps it in a frame and ungroups without losing objects', () => {
  HTMLElement.prototype.setPointerCapture = () => {};
  const doc = createWhiteboardDocument(), geometry = {x:10,y:20,width:100,height:80,rotation:0};
  executeCommands(doc, [
    { type: 'create', object: { id:'a',schemaVersion:1,kind:'sticky',geometry,text:'A',style:{},parentId:null,orderKey:'a' } },
    { type: 'create', object: { id:'b',schemaVersion:1,kind:'sticky',geometry:{...geometry,x:150},text:'B',style:{},parentId:null,orderKey:'b' } },
  ], 'seed');
  render(<CollaborativeEditor doc={doc} readOnly={false} title="白板" status="已连接" />);
  fireEvent.pointerDown(screen.getByTestId('board-object-a'), { button:0, pointerId:1, clientX:10, clientY:20 });
  fireEvent.pointerDown(screen.getByTestId('board-object-b'), { button:0, pointerId:2, clientX:150, clientY:20, shiftKey:true });
  fireEvent.click(screen.getByTestId('board-group'));
  const group = readObjects(doc).find(item => item.kind === 'group')!;
  expect(readObjects(doc).filter(item => ['a','b'].includes(item.id)).every(item => item.parentId === group.id)).toBe(true);
  expect(screen.getByTestId('board-object-a')).toHaveAttribute('data-parent-id', group.id);
  fireEvent.pointerDown(screen.getByTestId(`board-object-${group.id}`), { button:0, pointerId:5, clientX:0, clientY:0 });
  fireEvent.pointerMove(screen.getByTestId('board-live-surface'), { pointerId:5, clientX:20, clientY:10 });
  fireEvent.pointerUp(screen.getByTestId('board-live-surface'), { pointerId:5, clientX:20, clientY:10 });
  expect(readObjects(doc).find(item => item.id === 'a')?.geometry).toMatchObject({ x:30, y:30 });
  expect(readObjects(doc).find(item => item.id === 'b')?.geometry).toMatchObject({ x:170, y:30 });
  fireEvent.click(screen.getByTestId('board-ungroup'));
  expect(readObjects(doc).some(item => item.kind === 'group')).toBe(false);
  expect(readObjects(doc).filter(item => ['a','b'].includes(item.id)).every(item => item.parentId === null)).toBe(true);

  fireEvent.pointerDown(screen.getByTestId('board-object-a'), { button:0, pointerId:3, clientX:10, clientY:20 });
  fireEvent.pointerDown(screen.getByTestId('board-object-b'), { button:0, pointerId:4, clientX:150, clientY:20, shiftKey:true });
  fireEvent.click(screen.getByTestId('board-add-frame'));
  const frame = readObjects(doc).find(item => item.kind === 'frame')!;
  expect(frame.geometry).toMatchObject({ x:-10, y:-10, width:320, height:160 });
  expect(readObjects(doc).filter(item => ['a','b'].includes(item.id)).every(item => item.parentId === frame.id)).toBe(true);
  doc.destroy();
});
it('creation undo requires explicit deletion', () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor doc={doc} readOnly={false} title="白板" status="已连接" />);
  fireEvent.click(screen.getByTestId('board-add-sticky')); fireEvent.click(screen.getByText('撤销', { exact: true }));
  expect(readObjects(doc)).toHaveLength(1); expect(screen.getByText(/创建对象请使用删除/)).toBeVisible();
  fireEvent.click(screen.getByText('删除选中')); expect(readObjects(doc)).toHaveLength(0); doc.destroy();
});
it('IME keeps remote text and preserves the uncommitted composition draft', () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor doc={doc} readOnly={false} title="白板" status="已连接" />);
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
  render(<CollaborativeEditor doc={doc} readOnly={false} title="白板" status="已连接" currentUserId="me" peers={[{actorId:'other',cursor:{x:30,y:40},selected:['peer-note']},{actorId:'me',cursor:{x:2,y:3},selected:[]}]} onAwareness={cursor=>positions.push(cursor)}/>);
  expect(screen.getByTestId('peer-cursor-other')).toHaveStyle({left:'30px',top:'40px'});
  expect(screen.getByTestId('peer-selection-other-peer-note')).toHaveStyle({left:'10px',top:'20px'});
  expect(screen.queryByTestId('peer-cursor-me')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('放大',{exact:true}));
  fireEvent(screen.getByTestId('board-live-surface'),new MouseEvent('pointermove',{bubbles:true,clientX:110,clientY:220}));
  expect(positions.at(-1)?.x).toBeCloseTo(100); expect(positions.at(-1)?.y).toBeCloseTo(200);
  doc.destroy();
});
it('follows a presenter viewport while keeping room controls read-only', () => {
  const doc=createWhiteboardDocument();
  render(<CollaborativeEditor doc={doc} readOnly title="会议室" status="只读" followViewport={{x:120,y:-40,zoom:1.5,revision:2}}/>);
  expect(screen.getByTestId('board-live-surface').firstElementChild).toHaveStyle({transform:'translate(120px,-40px) scale(1.5)'});
  expect(screen.getByTestId('board-add-sticky')).toBeDisabled();
  doc.destroy();
});

it('completes spatial selection, multi-select, movement and connection from the canvas keyboard entry', () => {
  const doc=createWhiteboardDocument(), geometry={x:10,y:20,width:100,height:80,rotation:0};
  executeCommands(doc,[
    {type:'create',object:{id:'left',schemaVersion:1,kind:'sticky',geometry,text:'左侧想法',style:{},parentId:null,orderKey:'a'}},
    {type:'create',object:{id:'right',schemaVersion:1,kind:'sticky',geometry:{...geometry,x:240},text:'右侧想法',style:{},parentId:null,orderKey:'b'}},
  ],'seed');
  render(<CollaborativeEditor doc={doc} readOnly={false} title="白板" status="已同步"/>);
  expect(screen.getByRole('toolbar',{name:'白板工具'})).toBeVisible();
  expect(screen.getAllByRole('status')).toHaveLength(1);
  const canvas=screen.getByTestId('board-live-surface');
  canvas.focus(); fireEvent.focus(canvas);
  expect(canvas).toHaveFocus();
  expect(canvas).toHaveAttribute('aria-activedescendant','board-a11y-object-left');
  fireEvent.keyDown(canvas,{key:'Enter'});
  expect(screen.getByTestId('board-object-left')).toHaveAttribute('aria-pressed','true');
  fireEvent.keyDown(canvas,{key:'ArrowRight'});
  expect(canvas).toHaveAttribute('aria-activedescendant','board-a11y-object-right');
  fireEvent.keyDown(canvas,{key:' ',shiftKey:true});
  expect(screen.getByTestId('board-object-right')).toHaveAttribute('aria-pressed','true');
  fireEvent.keyDown(canvas,{key:'ArrowDown',ctrlKey:true,shiftKey:true});
  expect(readObjects(doc).find(item=>item.id==='left')?.geometry.y).toBe(30);
  expect(readObjects(doc).find(item=>item.id==='right')?.geometry.y).toBe(30);
  expect(screen.getByTestId('board-live-announcer')).toHaveTextContent('已移动 2 个对象');

  fireEvent.click(screen.getByText('连接',{exact:true}));
  fireEvent.keyDown(canvas,{key:'ArrowLeft'}); fireEvent.keyDown(canvas,{key:' '});
  fireEvent.keyDown(canvas,{key:'ArrowRight'}); fireEvent.keyDown(canvas,{key:' '});
  expect(readObjects(doc).find(item=>item.kind==='connector')?.connector).toEqual({from:'left',to:'right'});
  expect(screen.getByTestId('board-live-announcer')).toHaveTextContent('左侧想法');
  expect(screen.getByTestId('board-live-announcer')).toHaveTextContent('右侧想法');
  doc.destroy();
});

it('keeps the canvas focused after keyboard cancellation and deletion, and lets viewers navigate without mutation', () => {
  const doc=createWhiteboardDocument();
  executeCommands(doc,[{type:'create',object:{id:'note',schemaVersion:1,kind:'sticky',geometry:{x:0,y:0,width:100,height:80,rotation:0},text:'只读对象',style:{},parentId:null,orderKey:'a'}}],'seed');
  const {rerender}=render(<CollaborativeEditor doc={doc} readOnly={false} title="白板" status="已同步"/>);
  const canvas=screen.getByTestId('board-live-surface'); canvas.focus(); fireEvent.focus(canvas);
  fireEvent.keyDown(canvas,{key:' '}); fireEvent.keyDown(canvas,{key:'Enter'});
  expect(screen.getByLabelText('对象文字')).toHaveFocus(); fireEvent.keyDown(screen.getByLabelText('对象文字'),{key:'Escape'});
  expect(canvas).toHaveFocus();
  fireEvent.click(screen.getByText('连接',{exact:true})); fireEvent.keyDown(canvas,{key:'Escape'});
  expect(canvas).toHaveFocus(); expect(screen.getByTestId('board-live-announcer')).toHaveTextContent('已取消连接');
  fireEvent.keyDown(canvas,{key:' '}); fireEvent.keyDown(canvas,{key:'Delete'});
  expect(readObjects(doc)).toEqual([]); expect(canvas).toHaveFocus();
  rerender(<CollaborativeEditor doc={doc} readOnly title="白板" status="已同步"/>);
  act(()=>executeCommands(doc,[{type:'create',object:{id:'viewer-note',schemaVersion:1,kind:'sticky',geometry:{x:5,y:5,width:100,height:80,rotation:0},text:'查看对象',style:{},parentId:null,orderKey:'b'}}],'remote'));
  const viewerCanvas=screen.getByTestId('board-live-surface'); viewerCanvas.focus(); fireEvent.focus(viewerCanvas);
  fireEvent.keyDown(viewerCanvas,{key:' '});
  const before=readObjects(doc)[0]!.geometry.x;
  fireEvent.keyDown(viewerCanvas,{key:'ArrowRight',ctrlKey:true});
  expect(readObjects(doc)[0]!.geometry.x).toBe(before);
  expect(screen.getByTestId('board-live-announcer')).toHaveTextContent('只读');
  doc.destroy();
});

it('clears selection and repairs the active descendant when a collaborator deletes the active object', () => {
  const doc=createWhiteboardDocument(), awareness=vi.fn(), geometry={x:10,y:20,width:100,height:80,rotation:0};
  executeCommands(doc,[
    {type:'create',object:{id:'active',schemaVersion:1,kind:'sticky',geometry,text:'将被远端删除',style:{},parentId:null,orderKey:'a'}},
    {type:'create',object:{id:'next',schemaVersion:1,kind:'sticky',geometry:{...geometry,x:240},text:'保留对象',style:{},parentId:null,orderKey:'b'}},
  ],'seed');
  render(<CollaborativeEditor doc={doc} readOnly={false} title="白板" status="已同步" onAwareness={awareness}/>);
  const canvas=screen.getByTestId('board-live-surface');canvas.focus();fireEvent.focus(canvas);fireEvent.keyDown(canvas,{key:'Enter'});
  expect(canvas).toHaveAttribute('aria-activedescendant','board-a11y-object-active');
  expect(screen.getByTestId('board-object-active')).toHaveAttribute('aria-pressed','true');
  expect(screen.getByRole('button',{name:'删除选中'})).toBeEnabled();

  act(()=>executeCommands(doc,[{type:'delete',id:'active'}],'remote-client'));

  expect(canvas).toHaveFocus();
  expect(screen.queryByTestId('board-object-active')).not.toBeInTheDocument();
  expect(canvas).toHaveAttribute('aria-activedescendant','board-a11y-object-next');
  expect(screen.getByTestId('board-object-next')).toHaveAttribute('aria-pressed','false');
  expect(screen.getByRole('button',{name:'复制'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'删除选中'})).toBeDisabled();
  expect(screen.getByTestId('board-live-announcer')).toHaveTextContent('协作者删除了 1 个已选对象。0 个已选对象');
  expect(awareness).toHaveBeenLastCalledWith(null,[]);
  doc.destroy();
});
