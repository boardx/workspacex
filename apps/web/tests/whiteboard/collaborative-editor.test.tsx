import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { createWhiteboardDocument, executeCommands, readObjects } from '@repo/whiteboard-core';
import { CollaborativeEditor } from '@/components/whiteboard/collaborative-editor';
import { textSplice } from '@/components/whiteboard/use-whiteboard-document';
afterEach(cleanup);
function boardObject(id: string, x: number, y: number) {
  return { id, schemaVersion: 1 as const, kind: 'sticky' as const, geometry: { x, y, width: 100, height: 80, rotation: 0 }, text: id, style: {}, parentId: null, orderKey: id };
}
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
  expect(screen.getByText('画笔', { exact: true })).toBeDisabled();
  expect(screen.getByText('粘贴', { exact: true })).toBeDisabled();
  expect(screen.getByLabelText('白板名称')).toBeDisabled();
  fireEvent.click(screen.getByTestId('board-add-sticky'));
  expect(readObjects(doc)).toEqual([]); doc.destroy();
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
it('keyboard selection applies one atomic arrange action, preserves selection and one undo restores layout', () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [
    { type: 'create', object: boardObject('a', 10, 20) },
    { type: 'create', object: boardObject('b', 100, 80) },
    { type: 'create', object: boardObject('c', 220, 140) },
  ], 'seed');
  render(<CollaborativeEditor doc={doc} readOnly={false} title="白板" status="已连接" />);
  const a = screen.getByTestId('board-object-a'), b = screen.getByTestId('board-object-b'), c = screen.getByTestId('board-object-c');
  fireEvent.click(a, { detail: 0 });
  fireEvent.click(b, { detail: 0, shiftKey: true });
  fireEvent.click(c, { detail: 0, shiftKey: true });
  expect([a, b, c].every(element => element.getAttribute('aria-pressed') === 'true')).toBe(true);
  fireEvent.click(screen.getByTestId('board-align-top'));
  expect(readObjects(doc).map(value => value.geometry.y)).toEqual([20, 20, 20]);
  expect(screen.getByText(/一次撤销可恢复整批/)).toBeVisible();
  fireEvent.click(screen.getByText('撤销', { exact: true }));
  expect(readObjects(doc).map(value => value.geometry.y)).toEqual([20, 80, 140]);
  expect([a, b, c].every(element => element.getAttribute('aria-pressed') === 'true')).toBe(true);
  fireEvent.change(screen.getByLabelText('统一宽度'), { target: { value: '240' } });
  fireEvent.click(screen.getByTestId('board-format-width'));
  expect(readObjects(doc).map(value => value.geometry.width)).toEqual([240, 240, 240]);
  fireEvent.click(screen.getByText('撤销', { exact: true }));
  expect(readObjects(doc).map(value => value.geometry.width)).toEqual([100, 100, 100]);
  doc.destroy();
});
it('bulk controls explain read-only and cardinality restrictions', () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: 'create', object: boardObject('a', 0, 0) }, { type: 'create', object: boardObject('b', 10, 20) }], 'seed');
  render(<CollaborativeEditor doc={doc} readOnly readOnlyReason="查看者只能浏览白板。" title="只读" status="已连接" />);
  fireEvent.click(screen.getByTestId('board-object-a'), { detail: 0 });
  fireEvent.click(screen.getByTestId('board-object-b'), { detail: 0, shiftKey: true });
  expect(screen.getByTestId('board-align-left')).toBeDisabled();
  expect(screen.getByTestId('board-distribute-horizontal')).toBeDisabled();
  expect(screen.getByLabelText('统一宽度')).toBeDisabled();
  expect(screen.getByLabelText('统一高度')).toBeDisabled();
  expect(screen.getByText('查看者只能浏览白板。')).toBeVisible();
  doc.destroy();
});
