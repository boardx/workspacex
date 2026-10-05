import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWhiteboardDocument, readObjects } from '@repo/whiteboard-core';
import { CollaborativeEditor } from '@/components/whiteboard/collaborative-editor';

const upload = vi.hoisted(() => ({
  busy: false,
  error: null as string | null,
  lastRequest: null as string | null,
  clear: vi.fn(),
  cancel: vi.fn(),
  retry: vi.fn(),
  submit: vi.fn(),
}));
vi.mock('@/components/whiteboard/use-board-image-upload', () => ({
  useBoardImageUpload: () => ({ busy: upload.busy, error: upload.error, clear: upload.clear, cancel: upload.cancel, retry: upload.retry, upload: upload.submit }),
}));
vi.mock('@/components/whiteboard/fabric/board-fabric-surface', () => ({ BoardFabricSurface: () => <div /> }));
vi.mock('@/components/whiteboard/board-bottom-dock', () => ({
  BoardBottomDock: ({ onImageRequest }: { onImageRequest: () => void }) => <button data-testid="image-dock-entry" onClick={onImageRequest}>Image</button>,
}));
vi.mock('@/components/whiteboard/board-image-upload-dialog', () => ({
  BoardImageUploadDialog: ({ open, error }: { open: boolean; error: string | null }) => open ? <div data-testid="image-entry-dialog">{error}</div> : null,
}));
vi.mock('@/components/whiteboard/board-comments', () => ({
  listBoardMentionableMembers: async () => [],
  listBoardCommentThreads: async () => [],
}));

class ResizeObserverMock { observe() {} disconnect() {} }
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  upload.busy = false;
  upload.error = null;
  upload.lastRequest = null;
  upload.clear.mockReset().mockImplementation(() => { upload.error = null; upload.lastRequest = null; });
  upload.cancel.mockReset(); upload.retry.mockReset(); upload.submit.mockReset();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount(readOnly = false) {
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor boardId="image-entry-test" clientId="entry-client" doc={doc} readOnly={readOnly} title="Board" status="Connected" />);
  return doc;
}

for (const entry of ['dock', 'keyboard'] as const) {
  const open = () => entry === 'dock' ? fireEvent.click(screen.getByTestId('image-dock-entry')) : fireEvent.keyDown(window, { key: 'i' });
  it(`${entry} clears prior image error and retry request before opening`, () => {
    upload.error = 'Prior upload failed'; upload.lastRequest = 'prior-file.png';
    const doc = mount();
    open();
    expect(upload.clear).toHaveBeenCalledTimes(1);
    expect(upload.lastRequest).toBeNull();
    expect(upload.error).toBeNull();
    expect(screen.getByTestId('image-entry-dialog')).toBeEmptyDOMElement();
    expect(upload.submit).not.toHaveBeenCalled();
    expect(readObjects(doc)).toEqual([]);
    doc.destroy();
  });
  it(`${entry} does not clear or open during an active upload`, () => {
    upload.busy = true; upload.error = 'Retained state'; upload.lastRequest = 'in-flight.png';
    const doc = mount();
    open();
    expect(screen.queryByTestId('image-entry-dialog')).toBeNull();
    expect(upload.clear).not.toHaveBeenCalled();
    expect(upload.lastRequest).toBe('in-flight.png');
    expect(upload.cancel).not.toHaveBeenCalled();
    doc.destroy();
  });
  it(`${entry} respects read-only permissions`, () => {
    const doc = mount(true);
    open();
    expect(screen.queryByTestId('image-entry-dialog')).toBeNull();
    expect(upload.clear).not.toHaveBeenCalled();
    expect(readObjects(doc)).toEqual([]);
    doc.destroy();
  });
}

it('image shortcut ignores modified keys and editable targets', () => {
  const doc = mount();
  for (const modifier of ['altKey', 'ctrlKey', 'metaKey']) fireEvent.keyDown(window, { key: 'i', [modifier]: true });
  const input = document.createElement('input'); document.body.append(input);
  fireEvent.keyDown(input, { key: 'i' }); input.remove();
  expect(upload.clear).not.toHaveBeenCalled();
  expect(screen.queryByTestId('image-entry-dialog')).toBeNull();
  fireEvent.keyDown(window, { key: 'I' });
  expect(screen.getByTestId('image-entry-dialog')).toBeVisible();
  expect(upload.clear).toHaveBeenCalledTimes(1);
  doc.destroy();
});
