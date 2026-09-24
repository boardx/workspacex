import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument, executeCommands, readObjects } from '@repo/whiteboard-core';
import { CollaborativeEditor } from '@/components/whiteboard/collaborative-editor';
import { textSplice } from '@/components/whiteboard/use-whiteboard-document';
afterEach(cleanup);
function paste(target: HTMLElement, value: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', { value: { getData: (format: string) => format === 'text/plain' ? value : '' } });
  fireEvent(target, event);
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
it('captures stickies without a mouse and does not submit an active IME composition', () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor doc={doc} readOnly={false} title="白板" status="已连接" />);
  fireEvent.keyDown(document, { key: 'n' });
  expect(readObjects(doc)).toHaveLength(1);
  fireEvent.keyDown(document, { key: 'Enter' });
  const editor = screen.getByLabelText('对象文字');
  expect(editor).toHaveFocus();
  fireEvent.change(editor, { target: { value: '第一个想法' } });
  fireEvent.keyDown(editor, { key: 'Enter', metaKey: true, isComposing: true });
  expect(editor).toHaveFocus();
  fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });
  expect(editor).not.toHaveFocus();
  fireEvent.keyDown(document, { key: 'n', isComposing: true });
  expect(readObjects(doc)).toHaveLength(1);
  fireEvent.keyDown(document, { key: 'n' });
  fireEvent.keyDown(document, { key: 'Enter' });
  fireEvent.change(screen.getByLabelText('对象文字'), { target: { value: '第二个想法' } });
  fireEvent.keyDown(screen.getByLabelText('对象文字'), { key: 'Tab' });
  expect(readObjects(doc).map(object => object.text)).toEqual(['第一个想法', '第二个想法', '写下一个想法']);
  expect(screen.getByLabelText('对象文字')).toHaveFocus();
  doc.destroy();
});
it('captures twenty consecutive stickies with Tab and no pointer input', () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor doc={doc} readOnly={false} title="白板" status="已连接" />);
  fireEvent.keyDown(document, { key: 'n' }); fireEvent.keyDown(document, { key: 'Enter' });
  for (let index = 1; index <= 20; index += 1) {
    const editor = screen.getByLabelText('对象文字');
    fireEvent.change(editor, { target: { value: `想法 ${index}` } });
    if (index < 20) fireEvent.keyDown(editor, { key: 'Tab' });
  }
  expect(readObjects(doc).map(object => object.text)).toEqual(Array.from({ length: 20 }, (_, index) => `想法 ${index + 1}`));
  doc.destroy();
});
it('previews multiline paste, cancels without mutation, and rejects more than 500 lines', () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor doc={doc} readOnly={false} title="白板" status="已连接" />);
  const surface = screen.getByTestId('board-live-surface');
  paste(surface, '一\n二\n三');
  expect(screen.getByRole('dialog', { name: '批量创建便利贴' })).toHaveTextContent('3 张');
  expect(screen.getByText(/每行 5 张/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(readObjects(doc)).toEqual([]);
  paste(surface, Array.from({ length: 500 }, (_, index) => `想法 ${index + 1}`).join('\n'));
  expect(screen.getByRole('dialog', { name: '批量创建便利贴' })).toHaveTextContent('500 张');
  fireEvent.click(screen.getByRole('button', { name: '创建 500 张便利贴' }));
  expect(readObjects(doc)).toHaveLength(500);
  fireEvent.click(screen.getByText('撤销', { exact: true }));
  expect(readObjects(doc)).toEqual([]);
  paste(surface, Array.from({ length: 501 }, (_, index) => `想法 ${index + 1}`).join('\n'));
  expect(screen.queryByRole('dialog', { name: '批量创建便利贴' })).not.toBeInTheDocument();
  expect(screen.getByText(/最多可粘贴 500 行/)).toBeVisible();
  expect(readObjects(doc)).toEqual([]);
  doc.destroy();
});
it('creates a pasted batch in one transaction, syncs deterministic geometry, and undoes it once', () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor doc={doc} readOnly={false} title="白板" status="已连接" />);
  paste(screen.getByTestId('board-live-surface'), '研究\n设计\n验证\n发布\n复盘\n下一步');
  const peer = new Y.Doc(); doc.on('update', update => Y.applyUpdate(peer, update));
  let transactions = 0;
  doc.on('afterTransaction', () => { transactions += 1; });
  fireEvent.click(screen.getByRole('button', { name: '创建 6 张便利贴' }));
  expect(transactions).toBe(1);
  const local = readObjects(doc);
  expect(local.map(object => object.text)).toEqual(['研究', '设计', '验证', '发布', '复盘', '下一步']);
  expect(local.map(object => [object.geometry.x, object.geometry.y])).toEqual([
    [100, 100], [304, 100], [508, 100], [712, 100], [916, 100], [100, 264],
  ]);
  expect(readObjects(peer).map(object => ({ text: object.text, geometry: object.geometry })))
    .toEqual(local.map(object => ({ text: object.text, geometry: object.geometry })));
  transactions = 0;
  fireEvent.click(screen.getByText('撤销', { exact: true }));
  expect(transactions).toBe(1);
  expect(readObjects(doc)).toEqual([]);
  peer.destroy(); doc.destroy();
});
it('does not erase a collaborator edit when undoing a pasted batch', () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor doc={doc} readOnly={false} title="白板" status="已连接" />);
  paste(screen.getByTestId('board-live-surface'), '甲\n乙');
  fireEvent.click(screen.getByRole('button', { name: '创建 2 张便利贴' }));
  const first = readObjects(doc)[0]!;
  act(() => executeCommands(doc, [{ type: 'text', id: first.id, index: first.text.length, deleteCount: 0, insert: '（同事补充）' }], 'remote'));
  fireEvent.click(screen.getByText('撤销', { exact: true }));
  expect(readObjects(doc)).toHaveLength(2);
  expect(readObjects(doc)[0]!.text).toContain('同事补充');
  expect(screen.getByText(/已被协作者修改/)).toBeVisible();
  doc.destroy();
});
