import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createWhiteboardDocument, executeCommands, readObjects, WhiteboardUndo } from '@repo/whiteboard-core';
import { CollaborativeEditor } from '@/components/whiteboard/collaborative-editor';
import { textSplice } from '@/components/whiteboard/use-whiteboard-document';
import type { BoardFabricGeometry, BoardFabricObject } from '@/components/whiteboard/fabric/board-fabric-object';
vi.mock('@/components/whiteboard/fabric/board-fabric-surface', () => ({
  BoardFabricSurface: ({ objects, onObjectTransform }: { objects: readonly BoardFabricObject[]; onObjectTransform: (id: string, geometry: BoardFabricGeometry) => void }) => <div data-testid="board-fabric-surface"><canvas data-testid="board-fabric-canvas" />{objects.map((object) => <span key={object.id} data-projected-id={object.id} />)}{objects[0] ? <button data-testid="fabric-transform-first" onClick={() => onObjectTransform(objects[0]!.id, { ...objects[0]!.geometry, x: 345 })}>transform</button> : null}</div>,
}));
class ResizeObserverMock { observe() {} disconnect() {} }
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('text diff only replaces the changed span', () => {
  expect(textSplice('早上好世界', '早上美好世界')).toEqual({ index: 2, deleteCount: 0, insert: '美' });
  expect(textSplice('abc', 'ac')).toEqual({ index: 1, deleteCount: 1, insert: '' });
});
it('commands change Y.Doc and remote changes render without snapshots', () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor doc={doc} readOnly={false} title="白板" status="已连接" />);
  expect(screen.getByTestId('board-fabric-surface')).toBeVisible();
  expect(screen.getByTestId('board-fabric-canvas')).toBeVisible();
  expect(document.querySelector('[data-testid^="whiteboard-object-"]')).toBeNull();
  fireEvent.click(screen.getByTestId('board-add-sticky'));
  const id = readObjects(doc)[0]!.id;
  expect(document.querySelector(`[data-projected-id="${id}"]`)).not.toBeNull();
  fireEvent.click(screen.getByTestId('fabric-transform-first'));
  expect(readObjects(doc)[0]!.geometry.x).toBe(345);
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

it.each([
  ['undone', '已撤销本地修改'],
  ['conflict', '未撤销：当前画板与这次修改存在冲突，请核对后再操作。'],
  ['empty', '没有可撤销的本地修改。'],
  ['creation-requires-explicit-delete', '创建对象请使用删除；为保护其他人的修改，不撤销对象创建。'],
] as const)('announces the actual undo result %s', (result, message) => {
  vi.spyOn(WhiteboardUndo.prototype, 'undo').mockReturnValue(result);
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor doc={doc} readOnly={false} title="白板" status="已连接" />);
  fireEvent.click(screen.getByText('撤销', { exact: true }));
  expect(screen.getByText(message, { exact: true })).toBeVisible();
  if (result !== 'undone') expect(screen.queryByText('已撤销本地修改', { exact: true })).toBeNull();
  doc.destroy();
});
it.each([true, false])('announces redo success only when core returns %s', result => {
  vi.spyOn(WhiteboardUndo.prototype, 'redo').mockReturnValue(result);
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor doc={doc} readOnly={false} title="白板" status="已连接" />);
  fireEvent.click(screen.getByText('重做', { exact: true }));
  expect(screen.getByText(result ? '已重做本地修改' : '未重做：没有可重做的本地修改，或当前画板存在冲突。', { exact: true })).toBeVisible();
  if (!result) expect(screen.queryByText('已重做本地修改', { exact: true })).toBeNull();
  doc.destroy();
});
