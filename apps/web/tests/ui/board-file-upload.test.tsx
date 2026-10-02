import { webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { boardFileMetadata, boardFileTile, uploadBoardFile } from '@/components/whiteboard/board-file-upload';
import { BoardContentObjectInspector } from '@/components/whiteboard/board-content-object-inspector';
import type { WhiteboardObject } from '@repo/whiteboard-core';

vi.mock('@/lib/api-client', () => ({ apiUrl: (value: string) => `http://fixture${value}`, getStoredSessionToken: () => 'fixture-token' }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function fixture(name = '"original"%22😀.txt') {
  const bytes = new TextEncoder().encode('unique ordinary file bytes');
  const digest = await webcrypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  const metadata = { assetId: `board-file-${hash}`, fileName: name, mimeType: 'text/plain', byteSize: bytes.length, contentDigest: `sha256:${hash}`, persistence: 'durable' as const };
  const file = new File(['unique ordinary file bytes'], name, { type: 'text/plain' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
  vi.stubGlobal('crypto', webcrypto);
  return { bytes, metadata, file };
}
it('sends original fileName as a separate raw field and verifies persisted bytes before creating a tile', async () => {
  const { bytes, metadata, file } = await fixture();
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(metadata), { status: 201 })).mockResolvedValueOnce(new Response(bytes));
  vi.stubGlobal('fetch', fetcher);
  const tile = await uploadBoardFile('board', file);
  const request = fetcher.mock.calls[0]![1] as RequestInit;
  expect(request.body).toBeInstanceOf(FormData);
  const form = request.body as FormData;
  expect(form.get('fileName')).toBe(file.name); expect(form.getAll('fileName')).toHaveLength(1);
  expect(form.getAll('file')).toHaveLength(1);
  expect(tile.title).toBe(file.name); expect(boardFileMetadata(tile)).toEqual(metadata);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('rejects corrupt persisted bytes and never returns a download tile', async () => {
  const { metadata, file } = await fixture();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(metadata), { status: 201 })).mockResolvedValueOnce(new Response('tampered')));
  await expect(uploadBoardFile('board', file)).rejects.toThrow('FILE_ASSET_INTEGRITY');
});
it('retains the first persisted dedup metadata name instead of overwriting it with the local name', async () => {
  const { metadata, bytes, file } = await fixture();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ...metadata, fileName: 'first-name.txt' }), { status: 201 })).mockResolvedValueOnce(new Response(bytes)));
  expect((await uploadBoardFile('board', file)).title).toBe('first-name.txt');
});
it('keeps protected file metadata out of the structured field editor and allows viewer downloads', async () => {
  const { metadata } = await fixture();
  const tile = boardFileTile(metadata), onDownloadFile = vi.fn();
  const object = { id: 'file', schemaVersion: 1, kind: 'tile', geometry: { x: 0, y: 0, width: 260, height: 100, rotation: 0 }, text: metadata.fileName, style: {}, parentId: null, orderKey: 'a', extensionData: { contentObject: tile } } as unknown as WhiteboardObject;
  render(<BoardContentObjectInspector object={object} content={tile} readOnly onChange={vi.fn()} onReplaceImage={vi.fn()} onEditText={vi.fn()} onEditStructured={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} onDownloadFile={onDownloadFile} />);
  expect(screen.queryByTestId('board-structured-content-properties')).toBeNull();
  expect(screen.getByTestId('board-file-download')).toBeEnabled();
  fireEvent.click(screen.getByTestId('board-file-download')); expect(onDownloadFile).toHaveBeenCalledOnce();
});
