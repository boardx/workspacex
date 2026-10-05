import {primaryFailure,acceptanceFailureSecrets} from './support/board-primary-failure';
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

import {boardFileFilenameCases as filenames} from './support/board-file-filename-matrix.mjs';

test('R09 real multipart original filename matrix and literal RFC5987 download headers', async ({page, request}, info) => {
  const beforeProof = await verifyConnectorRuntimeManifest();
  const nativeDatabase = await fileNativeDatabaseProof(F.orgId);
  const owner = await boardLogin(page), name = `R09 filename matrix ${randomUUID()}`;
  const board = await createAcceptanceBoard(request, owner, name), failures: unknown[] = [];
  try {
    const initialHead = await boardHead(request, owner, board), observations = [];
    const assets = new Set<string>();
    for (const {fileName, encodedName} of filenames) {
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
    await info.attach('R09 filename server evidence', {body: JSON.stringify({observations, nativeDatabase, browserSavedFilenameVerified: false, browserDownloadCriterion: 'browser-safe-normalization', requiredSuiteComplete: false}, null, 2), contentType: 'application/json'});
  } catch (error) { failures.push(error); }
  finally {
    if(failures.length)try{await info.attach('R09 filename primary failures',{body:JSON.stringify(failures.map(error=>primaryFailure(error,acceptanceFailureSecrets(F,owner)))),contentType:'application/json'});}catch(error){failures.push(error);}
    try { await deleteOwnedConnectorFixture(request, owner, board, F.userId, name); } catch (error) { failures.push(error); }
    try { await verifyConnectorRuntimeManifest(beforeProof); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'R09 filename acceptance or owned cleanup failed');
});

test('R09 native UI downloads preserve browser-safe filenames and exact bytes after refresh', async ({page, request, baseURL}, info) => {
  if (!baseURL) throw new Error('FILES_REQUIRE_EXISTING_RUNTIME_URLS');
  const beforeProof = await verifyConnectorRuntimeManifest();
  const nativeDatabase = await fileNativeDatabaseProof(F.orgId);
  const owner = await boardLogin(page), failures: unknown[] = [], observations: Array<Record<string, unknown>> = [];
  try { for (const {fileName, chromiumSavedName} of filenames) {
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
      await expect(page.getByTestId('board-a11y-mirror').locator('li[data-object-id]')).toHaveCount(1);
      await expect(page.getByTestId('board-a11y-mirror').locator('li[data-object-id]')).toHaveAttribute('data-object-text', fileName);
      await expectBoardSynced(page);
      await expect.poll(() => boardHead(request, owner, board)).toEqual({epoch: initial.epoch, seq: initial.seq + 1});
      const committed = await canonicalBoardSnapshot(request, owner, board);
      await page.reload(); await expectBoardSynced(page);
      const row = page.getByTestId('board-a11y-mirror').locator('li[data-object-id]');
      await expect(row).toHaveCount(1); await expect(row).toHaveAttribute('data-object-text', fileName);
      const button = row.getByRole('button'); await button.focus(); await button.press('Enter');
      const downloading = page.waitForEvent('download'); await page.getByRole('button', {name: '下载', exact: true}).click();
      const download = await downloading, path = await download.path(); expect(path).toBeTruthy();
      const saved = await readFile(path!); expect(saved).toEqual(bytes);
      expect(createHash('sha256').update(saved).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(await canonicalBoardSnapshot(request, owner, board)).toEqual(committed);
      await expect.poll(() => boardHead(request, owner, board)).toEqual({epoch: initial.epoch, seq: initial.seq + 1});
      await page.screenshot({path: info.outputPath(`R09-native-download-${observations.length}.png`), fullPage: true});
      observations.push({fileName, suggestedFilename: download.suggestedFilename(), expectedSavedFilename: chromiumSavedName, literalNamePreserved: download.suggestedFilename() === fileName, bytesVerified: true, metadata});
      // Human-approved disk-name normalization; metadata/UI/headers/bytes stay exact.
      expect(download.suggestedFilename()).toBe(chromiumSavedName);
    } catch (error) { failures.push(error); }
    finally { try { await deleteOwnedConnectorFixture(request, owner, board, F.userId, name); } catch (error) { failures.push(error); } }
  } } catch (error) { failures.push(error); }
  finally {
    try { await info.attach('R09 native download evidence', {body: JSON.stringify({observations, failures:failures.map(error=>primaryFailure(error,acceptanceFailureSecrets(F,owner))), nativeDatabase, syntheticUploadNotOsDrop: true, requiredSuiteComplete: false}, null, 2), contentType: 'application/json'}); } catch (error) { failures.push(error); }
    try { await verifyConnectorRuntimeManifest(beforeProof); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'R09 browser-safe native download criteria or owned cleanup failed');
});
