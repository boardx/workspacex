import {fixedFilesFailure, type FilesFailurePhase} from './support/board-files-failure-diagnostic.mjs';
import {test, expect} from '@playwright/test';
import {createHash, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {WhiteboardFileMetadata} from '@repo/contracts/whiteboard-file';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {apiOrigin, boardLogin, boardHead, createAcceptanceBoard, openBoard, canonicalBoardSnapshot} from './board-acceptance-support';
import {expectBoardSynced} from './support/board-sync-status';
import {isBoardFileUploadResponse} from './support/board-file-upload-response';
import {fileAssetRows, fileNativeDatabaseProof} from './support/board-files-storage';
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
  const nativeDatabase = await fileNativeDatabaseProof(F.orgId);
  const owner = await boardLogin(page), name = `R09 filename matrix ${randomUUID()}`;
  const board = await createAcceptanceBoard(request, owner, name), failures: unknown[] = [];
  let phase: FilesFailurePhase = 'SETUP', ordinal = -1, primaryPhase: FilesFailurePhase = 'NO_PRIMARY_FAILURE', primaryOrdinal = -1, deleteFailures = 0, identityFailures = 0;
  try {
    phase = 'HEAD_BEFORE';
    const initialHead = await boardHead(request, owner, board), observations = [];
    const assets = new Set<string>();
    for (const [fileName, encodedName] of filenames) {
      ordinal++;
      const bytes = Buffer.from(`unique filename ${fileName} ${randomUUID()}`);
      phase = 'UPLOAD';
      const response = await request.post(`${apiOrigin()}/whiteboards/${board}/files`, {
        headers: {authorization: `Bearer ${owner}`}, multipart: {fileName, file: {name: fileName, mimeType: 'text/plain', buffer: bytes}},
      });
      phase = 'UPLOAD_STATUS';
      expect(response.status()).toBe(201);
      phase = 'UPLOAD_SCHEMA';
      const metadata = WhiteboardFileMetadata.parse(await response.json());
      phase = 'METADATA';
      expect(metadata.fileName).toBe(fileName); expect(metadata.byteSize).toBe(bytes.length);
      phase = 'DIGEST';
      expect(metadata.contentDigest).toBe(`sha256:${createHash('sha256').update(bytes).digest('hex')}`);
      phase = 'UNIQUE_ASSET';
      expect(assets.has(metadata.assetId)).toBe(false); assets.add(metadata.assetId);
      phase = 'DOWNLOAD';
      const download = await request.get(`${apiOrigin()}/whiteboards/${board}/files/${metadata.assetId}/content`, {headers: {authorization: `Bearer ${owner}`}});
      phase = 'DOWNLOAD_STATUS';
      expect(download.status()).toBe(200);
      phase = 'DOWNLOAD_BYTES';
      expect(await download.body()).toEqual(bytes);
      phase = 'DOWNLOAD_HEADERS';
      expect(download.headers()).toMatchObject({'content-type': 'application/octet-stream', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-disposition': `attachment; filename*=UTF-8''${encodedName}`});
      phase = 'STORED_METADATA';
      expect((await fileAssetRows(F.orgId, board)).find(row => row.asset_id === metadata.assetId)?.metadata).toEqual(metadata);
      phase = 'HEAD_UNCHANGED';
      expect(await boardHead(request, owner, board)).toEqual(initialHead);
      observations.push({fileName, metadata, contentDisposition: download.headers()['content-disposition']});
    }
    phase = 'ROW_COUNT';
      expect(await fileAssetRows(F.orgId, board)).toHaveLength(filenames.length);
    phase = 'SERVER_EVIDENCE';
      await info.attach('R09 filename server evidence', {body: JSON.stringify({observations, nativeDatabase, browserSavedFilenameVerified: false, originalQuotedBrowserDownloadCriterionSatisfied: false, requiredSuiteComplete: false}, null, 2), contentType: 'application/json'});
  } catch (error) { primaryPhase = phase; primaryOrdinal = ordinal; failures.push(error); }
  finally {
    try { await deleteOwnedConnectorFixture(request, owner, board, F.userId, name); } catch (error) { deleteFailures++; failures.push(error); }
    try { await verifyConnectorRuntimeManifest(beforeProof); } catch (error) { identityFailures++; failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, fixedFilesFailure(primaryPhase, primaryOrdinal, deleteFailures, identityFailures));
});

test('R09 native UI downloads retain literal filenames and bytes after refresh', async ({page, request, baseURL}, info) => {
  if (!baseURL) throw new Error('FILES_REQUIRE_EXISTING_RUNTIME_URLS');
  const beforeProof = await verifyConnectorRuntimeManifest();
  const nativeDatabase = await fileNativeDatabaseProof(F.orgId);
  const owner = await boardLogin(page), failures: unknown[] = [], observations: Array<Record<string, unknown>> = [];
  try { for (const [fileName] of filenames) {
    const name = `R09 native filename ${randomUUID()}`, board = await createAcceptanceBoard(request, owner, name);
    try {
      await openBoard(page, board, 0);
      const initial = await boardHead(request, owner, board), bytes = Buffer.from(`native filename ${fileName} ${randomUUID()}`);
      const box = await page.getByTestId('collaborative-editor').boundingBox();
      expect(box).not.toBeNull();
      const uploaded = page.waitForResponse(response => isBoardFileUploadResponse(response.request().method(), response.url(), board, apiOrigin(), baseURL));
      const transfer = await page.evaluateHandle(({name, data}) => {
        const value = new DataTransfer(); value.items.add(new File([new Uint8Array(data)], name, {type: 'text/plain'})); return value;
      }, {name: fileName, data: [...bytes]});
      try { await page.getByTestId('board-fabric-surface').dispatchEvent('drop', {dataTransfer: transfer, clientX: box!.x + box!.width / 2, clientY: box!.y + box!.height / 2}); }
      finally { await transfer.dispose(); }
      const response = await uploaded; expect(response.status()).toBe(201);
      const metadata = WhiteboardFileMetadata.parse(await response.json()); expect(metadata.fileName).toBe(fileName);
      await expectBoardSynced(page);
      const committed = await canonicalBoardSnapshot(request, owner, board);
      expect(await boardHead(request, owner, board)).toEqual({epoch: initial.epoch, seq: initial.seq + 1});
      await page.reload(); await expectBoardSynced(page);
      const row = page.getByTestId('board-a11y-mirror').locator('li[data-object-id]');
      await expect(row).toHaveCount(1); await expect(row).toHaveAttribute('data-object-text', fileName);
      const button = row.getByRole('button'); await button.focus(); await button.press('Enter');
      const downloading = page.waitForEvent('download'); await page.getByRole('button', {name: '下载', exact: true}).click();
      const download = await downloading, path = await download.path(); expect(path).toBeTruthy();
      const saved = await readFile(path!); expect(saved).toEqual(bytes);
      expect(createHash('sha256').update(saved).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(await canonicalBoardSnapshot(request, owner, board)).toEqual(committed);
      expect(await boardHead(request, owner, board)).toEqual({epoch: initial.epoch, seq: initial.seq + 1});
      await page.screenshot({path: info.outputPath(`R09-native-download-${observations.length}.png`), fullPage: true});
      observations.push({fileName, suggestedFilename: download.suggestedFilename(), literalNamePreserved: download.suggestedFilename() === fileName, bytesVerified: true, metadata});
      // The original criterion remains strict even when a platform sanitizes a name.
      expect(download.suggestedFilename()).toBe(fileName);
    } catch (error) { failures.push(error); }
    finally { try { await deleteOwnedConnectorFixture(request, owner, board, F.userId, name); } catch (error) { failures.push(error); } }
  } } catch (error) { failures.push(error); }
  finally {
    try { await info.attach('R09 native download evidence', {body: JSON.stringify({observations, nativeDatabase, syntheticUploadNotOsDrop: true, requiredSuiteComplete: false}, null, 2), contentType: 'application/json'}); } catch (error) { failures.push(error); }
    try { await verifyConnectorRuntimeManifest(beforeProof); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'R09 literal native download criteria or owned cleanup failed');
});
