import {test, expect} from '@playwright/test';
import {createHash, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tsImport} from 'tsx/esm/api';
import {WhiteboardFileMetadata} from '@repo/contracts/whiteboard-file';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {apiOrigin, boardLogin, boardHead, createAcceptanceBoard, openBoard, canonicalBoardSnapshot} from './board-acceptance-support';
import {fileAssetRows, fileNativeDatabaseProof} from './support/board-files-storage';
import {deleteOwnedConnectorFixture} from './support/connector-acceptance-fixture';
import {verifyConnectorRuntimeManifest} from './support/connector-runtime-manifest';
import {isBoardFileUploadResponse} from './support/board-file-upload-response';
import {expectBoardSynced} from './support/board-sync-status';
import {verifyFileStorage, blockOwnedFileWrite} from './support/file-storage-runtime.mjs';

test('R09 real filesystem-backed API 503 then native retry creates exactly one file tile', async ({page, request, baseURL}, info) => {
  const beforeProof = await verifyConnectorRuntimeManifest(), nativeDatabase = await fileNativeDatabaseProof(F.orgId);
  const manifest = JSON.parse(await readFile(process.env.BOARD_CONNECTOR_RUNTIME_MANIFEST!, 'utf8'));
  const storage = verifyFileStorage(manifest);
  const paths = await tsImport(pathToFileURL(resolve(__dirname, '../../api/src/infrastructure/storage/object-store-path.ts')).href, {
    parentURL: pathToFileURL(__filename).href, tsconfig: resolve(__dirname, '../../api/tsconfig.json'),
  }) as {resolveObjectPath(root: string, key: string): string};
  const owner = await boardLogin(page), name = `R09 real backend retry ${randomUUID()}`;
  const board = await createAcceptanceBoard(request, owner, name), failures: unknown[] = [];
  let fault: ReturnType<typeof blockOwnedFileWrite> | undefined;
  try {
    await openBoard(page, board, 0);
    const initial = await boardHead(request, owner, board), canonical = await canonicalBoardSnapshot(request, owner, board);
    const fileName = '后端重试.txt', bytes = Buffer.from(`real file storage failure ${randomUUID()}`);
    const hash = createHash('sha256').update(bytes).digest('hex');
    // Independent expected application key. The real API must return 503; a mismatched fixture cannot pass.
    const key = `whiteboards/tenants/${createHash('sha256').update(F.orgId).digest('hex').slice(0, 32)}/boards/${board}/files/${hash}`;
    fault = blockOwnedFileWrite({objectRoot: storage.objectRoot, key, boardId: board, resolveObjectPath: paths.resolveObjectPath});
    const uploaded = () => page.waitForResponse(response => isBoardFileUploadResponse(response.request().method(), response.url(), board, apiOrigin(), baseURL!));
    const rejected = uploaded();
    const transfer = await page.evaluateHandle(({name, data}) => {
      const value = new DataTransfer(); value.items.add(new File([new Uint8Array(data)], name, {type: 'text/plain'})); return value;
    }, {name: fileName, data: [...bytes]});
    try { await page.getByTestId('collaborative-editor').dispatchEvent('drop', {dataTransfer: transfer, clientX: 500, clientY: 350}); } finally { await transfer.dispose(); }
    expect((await rejected).status()).toBe(503);
    await expect(page.getByTestId('board-file-upload-status')).toHaveAttribute('role', 'alert');
    await expect(page.getByRole('button', {name: '重试文件', exact: true})).toBeVisible();
    await expect(page.getByTestId('board-a11y-mirror').locator('li[data-object-id]')).toHaveCount(0);
    expect(await boardHead(request, owner, board)).toEqual(initial); expect(await canonicalBoardSnapshot(request, owner, board)).toEqual(canonical);
    expect(await fileAssetRows(F.orgId, board)).toEqual([]);
    await page.screenshot({path: info.outputPath('R09-real-backend-503.png'), fullPage: true});
    fault.restore(); fault = undefined;
    const accepted = uploaded(); await page.getByRole('button', {name: '重试文件', exact: true}).click();
    const response = await accepted; expect(response.status()).toBe(201);
    const metadata = WhiteboardFileMetadata.parse(await response.json());
    expect(metadata).toMatchObject({fileName, byteSize: bytes.length, contentDigest: `sha256:${hash}`});
    await expectBoardSynced(page, 30_000);
    await expect(page.getByTestId('board-a11y-mirror').locator('li[data-object-id]')).toHaveCount(1);
    await expect(page.getByTestId('board-file-upload-status')).toHaveCount(0);
    expect(await boardHead(request, owner, board)).toEqual({epoch: initial.epoch, seq: initial.seq + 1});
    expect(await fileAssetRows(F.orgId, board)).toEqual([{asset_id: metadata.assetId, metadata, state: 'active'}]);
    const final = await canonicalBoardSnapshot(request, owner, board); expect(final.objects).toHaveLength(1);
    await page.reload(); await expectBoardSynced(page, 30_000);
    await expect(page.getByTestId('board-a11y-mirror').locator('li[data-object-id]')).toHaveCount(1);
    expect(await canonicalBoardSnapshot(request, owner, board)).toEqual(final);
    await page.screenshot({path: info.outputPath('R09-real-backend-retry-refreshed.png'), fullPage: true});
    await info.attach('R09 real backend retry evidence', {body: JSON.stringify({firstStatus: 503, retryStatus: 201, storageReceiptSha256: storage.receiptSha256, nativeDatabase, metadata, head: final.revision, nativeOsDragVerified: false, requiredSuiteComplete: false}, null, 2), contentType: 'application/json'});
  } catch (error) { failures.push(error); }
  finally {
    try { fault?.restore(); } catch (error) { failures.push(error); }
    try { await deleteOwnedConnectorFixture(request, owner, board, F.userId, name); } catch (error) { failures.push(error); }
    try { await verifyConnectorRuntimeManifest(beforeProof); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'R09 real storage retry or owned cleanup failed');
});
