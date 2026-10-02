import {test, expect} from '@playwright/test';
import {createHash, randomUUID} from 'node:crypto';
import {WhiteboardFileMetadata} from '@repo/contracts/whiteboard-file';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {apiOrigin, boardLogin, boardHead, createAcceptanceBoard} from './board-acceptance-support';
import {fileAssetRows} from './support/board-files-storage';
import {deleteOwnedConnectorFixture} from './support/connector-acceptance-fixture';
import {verifyConnectorRuntimeManifest} from './support/connector-runtime-manifest';

const filenames = [
  ['plain.txt', 'plain.txt'],
  ["O'Brien.txt", 'O%27Brien.txt'],
  ['brackets[1].txt', 'brackets%5B1%5D.txt'],
  ['star*.txt', 'star%2A.txt'],
  ['中文.txt', '%E4%B8%AD%E6%96%87.txt'],
  ['100%.txt', '100%25.txt'],
  ['"quoted".txt', '%22quoted%22.txt'],
] as const;

test('R09 real multipart original filename matrix and literal RFC5987 download headers', async ({page, request}, info) => {
  const beforeProof = await verifyConnectorRuntimeManifest();
  const owner = await boardLogin(page), name = `R09 filename matrix ${randomUUID()}`;
  const board = await createAcceptanceBoard(request, owner, name), failures: unknown[] = [];
  try {
    const initialHead = await boardHead(request, owner, board), observations = [];
    const assets = new Set<string>();
    for (const [fileName, encodedName] of filenames) {
      const bytes = Buffer.from(`unique filename ${fileName} ${randomUUID()}`);
      const response = await request.post(`${apiOrigin()}/whiteboards/${board}/files`, {
        headers: {authorization: `Bearer ${owner}`}, multipart: {fileName, file: {name: fileName, mimeType: 'text/plain', buffer: bytes}},
      });
      expect(response.status()).toBe(201);
      const metadata = WhiteboardFileMetadata.parse(await response.json());
      expect(metadata.fileName).toBe(fileName); expect(metadata.byteSize).toBe(bytes.length);
      expect(metadata.contentDigest).toBe(`sha256:${createHash('sha256').update(bytes).digest('hex')}`);
      expect(assets.has(metadata.assetId)).toBe(false); assets.add(metadata.assetId);
      const download = await request.get(`${apiOrigin()}/whiteboards/${board}/files/${metadata.assetId}/content`, {headers: {authorization: `Bearer ${owner}`}});
      expect(download.status()).toBe(200); expect(await download.body()).toEqual(bytes);
      expect(download.headers()).toMatchObject({'content-type': 'application/octet-stream', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-disposition': `attachment; filename*=UTF-8''${encodedName}`});
      expect((await fileAssetRows(F.orgId, board)).find(row => row.asset_id === metadata.assetId)?.metadata).toEqual(metadata);
      expect(await boardHead(request, owner, board)).toEqual(initialHead);
      observations.push({fileName, metadata, contentDisposition: download.headers()['content-disposition']});
    }
    expect(await fileAssetRows(F.orgId, board)).toHaveLength(filenames.length);
    await info.attach('R09 filename server evidence', {body: JSON.stringify({observations, browserSavedFilenameVerified: false, originalQuotedBrowserDownloadCriterionSatisfied: false, requiredSuiteComplete: false}, null, 2), contentType: 'application/json'});
  } catch (error) { failures.push(error); }
  finally {
    try { await deleteOwnedConnectorFixture(request, owner, board, F.userId, name); } catch (error) { failures.push(error); }
    try { await verifyConnectorRuntimeManifest(beforeProof); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'R09 filename acceptance or owned cleanup failed');
});
