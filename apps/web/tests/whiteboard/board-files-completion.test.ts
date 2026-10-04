import {webcrypto} from 'node:crypto';
import {File} from 'node:buffer';
import {afterEach, expect, it, vi} from 'vitest';
import {uploadBoardFile, boardFileMetadata} from '@/components/whiteboard/board-file-upload';

vi.mock('@/lib/api-client', () => ({apiUrl: (path: string) => `http://fixture${path}`, getStoredSessionToken: () => 'fixture-token'}));
afterEach(() => vi.unstubAllGlobals());

it('does not finish an upload on POST 201 before persisted content verification completes', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const bytes = new TextEncoder().encode('persisted bytes, not merely an upload receipt');
  const hash = Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const metadata = {assetId: `board-file-${hash}`, fileName: 'completion.txt', mimeType: 'text/plain', byteSize: bytes.length, contentDigest: `sha256:${hash}`, persistence: 'durable'};
  let releaseContent!: (response: Response) => void;
  const content = new Promise<Response>(resolve => { releaseContent = resolve; });
  let observeContentRequest!: () => void;
  const contentRequested = new Promise<void>(resolve => { observeContentRequest = resolve; });
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(metadata), {status: 201})).mockImplementationOnce(() => { observeContentRequest(); return content; });
  vi.stubGlobal('fetch', fetcher);
  const createTile = vi.fn();
  let settled = false;
  const upload = uploadBoardFile('board', new File([bytes], metadata.fileName, {type: 'text/plain'}) as unknown as globalThis.File);
  const completion = upload.then(tile => { settled = true; createTile(tile); return tile; }, error => { settled = true; throw error; });
  try {
    await contentRequested;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({method: 'POST'});
    expect(fetcher.mock.calls[1]![0]).toBe(`http://fixture/whiteboards/board/files/${metadata.assetId}/content`);
    expect(settled).toBe(false);
    expect(createTile).not.toHaveBeenCalled();
  } finally {
    releaseContent(new Response(bytes));
  }
  const tile = await completion;
  expect(settled).toBe(true);
  expect(createTile).toHaveBeenCalledTimes(1);
  expect(createTile).toHaveBeenCalledWith(tile);
  expect(boardFileMetadata(tile)).toEqual(metadata);
});
