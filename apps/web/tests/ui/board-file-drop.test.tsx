import { act, cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWhiteboardDocument, readContentObject, readObjects } from '@repo/whiteboard-core';
import { CollaborativeThinkingEditor } from '@/components/whiteboard/collaborative-thinking-editor';
import { boardFileTile } from '@/components/whiteboard/board-file-upload';

const mocks = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('@/components/whiteboard/board-file-upload', async importOriginal => ({ ...await importOriginal<object>(), uploadBoardFile: mocks.upload }));
vi.mock('@/components/whiteboard/fabric/board-fabric-surface', () => ({ BoardFabricSurface: () => <div data-testid="fixture-surface" /> }));
class ResizeObserverMock { observe() {} disconnect() {} }
beforeEach(() => { mocks.upload.mockReset(); vi.stubGlobal('ResizeObserver', ResizeObserverMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const content = boardFileTile({ assetId: `board-file-${'a'.repeat(64)}`, fileName: '"quoted"%22😀.txt', mimeType: 'text/plain', byteSize: 3, contentDigest: `sha256:${'a'.repeat(64)}`, persistence: 'durable' });
function drop() {
  const host = screen.getByTestId('collaborative-editor');
  const event = createEvent.drop(host, { dataTransfer: { files: [new File(['abc'], content.title!, { type: 'text/plain' })] } });
  Object.defineProperties(event, { clientX: { value: 200 }, clientY: { value: 240 } });
  fireEvent(host, event);
}
function fixture() {
  const doc = createWhiteboardDocument();
  const props = { doc, boardId: 'board', clientId: 'web', readOnly: false, title: 'Board', status: '已连接' };
  return { doc, props, view: render(<CollaborativeThinkingEditor {...props} />) };
}
it('creates exactly one ordinary-file tile after successful upload and clears busy state', async () => {
  mocks.upload.mockResolvedValue(content); const { doc } = fixture(); drop();
  await waitFor(() => expect(readObjects(doc)).toHaveLength(1));
  expect(readContentObject(readObjects(doc)[0]!)).toEqual(content);
  expect(readObjects(doc)[0]!.text).toBe(content.title);
  expect(screen.queryByTestId('board-file-upload-status')).toBeNull();
});
it('keeps failures visible with retry and creates no tile before success', async () => {
  mocks.upload.mockRejectedValueOnce(new Error('FILE_ASSET_UNAVAILABLE')).mockResolvedValueOnce(content);
  const { doc } = fixture(); drop();
  await waitFor(() => expect(screen.getByTestId('board-file-upload-status')).toHaveAttribute('role', 'alert'));
  expect(readObjects(doc)).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '重试文件' }));
  await waitFor(() => expect(readObjects(doc)).toHaveLength(1));
  expect(mocks.upload).toHaveBeenCalledTimes(2);
});
it('aborts in-flight file uploads on permission loss and never commits their late result', async () => {
  let resolve!: (value: typeof content) => void;
  mocks.upload.mockImplementation(() => new Promise<typeof content>(done => { resolve = done; }));
  const { doc, props, view } = fixture(); drop();
  const signal = mocks.upload.mock.calls[0]![2] as AbortSignal;
  view.rerender(<CollaborativeThinkingEditor {...props} readOnly />);
  expect(signal.aborted).toBe(true);
  await act(async () => { resolve(content); });
  expect(readObjects(doc)).toHaveLength(0);
  expect(screen.queryByTestId('board-file-upload-status')).toBeNull();
});
it('does not submit ordinary-file uploads from a read-only board', () => {
  const { props, view } = fixture(); view.rerender(<CollaborativeThinkingEditor {...props} readOnly />); drop();
  expect(mocks.upload).not.toHaveBeenCalled();
});
