import {test, expect} from '@playwright/test';
import {createHash, randomUUID} from 'node:crypto';
import {WhiteboardFileMetadata} from '@repo/contracts/whiteboard-file';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {apiOrigin, boardLogin, boardHead, createAcceptanceBoard, openBoard, canonicalRows} from './board-acceptance-support';
import {fileAssetRows, fileNativeDatabaseProof} from './support/board-files-storage';
import {deleteOwnedConnectorFixture} from './support/connector-acceptance-fixture';
import {verifyConnectorRuntimeManifest} from './support/connector-runtime-manifest';
import {isBoardFileUploadResponse} from './support/board-file-upload-response';
import {expectBoardSynced} from './support/board-sync-status';

for (const width of [1440, 390]) test(`R09 ordinary-file drop after real pan and zoom at ${width}px`, async ({page, request, baseURL}, info) => {
  const beforeProof = await verifyConnectorRuntimeManifest();
  const nativeDatabase = await fileNativeDatabaseProof(F.orgId);
  await page.setViewportSize({width, height: 900});
  const owner = await boardLogin(page), name = `R09 placement ${width} ${randomUUID()}`;
  const board = await createAcceptanceBoard(request, owner, name), failures: unknown[] = [];
  try {
    await openBoard(page, board, 0);
    const initial = await boardHead(request, owner, board);
    const surface = page.getByTestId('board-fabric-surface'), editor = page.getByTestId('collaborative-editor');
    await surface.hover(); await page.keyboard.down('ControlOrMeta');
    try { await page.mouse.wheel(0, -100); } finally { await page.keyboard.up('ControlOrMeta'); }
    await expect.poll(async () => Number(await surface.getAttribute('data-viewport-zoom'))).not.toBe(1);
    await page.mouse.wheel(120, 80);
    await expect.poll(async () => Math.abs(Number(await surface.getAttribute('data-viewport-pan-x'))) + Math.abs(Number(await surface.getAttribute('data-viewport-pan-y')))).toBeGreaterThan(0);
    const viewport = {zoom: Number(await surface.getAttribute('data-viewport-zoom')), panX: Number(await surface.getAttribute('data-viewport-pan-x')), panY: Number(await surface.getAttribute('data-viewport-pan-y'))};
    expect(Object.values(viewport).every(Number.isFinite)).toBe(true); expect(viewport.zoom).toBeGreaterThan(0);
    const bounds = await editor.boundingBox(); expect(bounds).not.toBeNull();
    const client = {x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2};
    const scene = {x: (client.x - bounds!.x - viewport.panX) / viewport.zoom, y: (client.y - bounds!.y - viewport.panY) / viewport.zoom};
    expect(await boardHead(request, owner, board)).toEqual(initial);
    const fileName = `普通文件-${width}.txt`, bytes = Buffer.from(`placement ${randomUUID()}`);
    const uploaded = page.waitForResponse(response => isBoardFileUploadResponse(response.request().method(), response.url(), board, apiOrigin(), baseURL!));
    const transfer = await page.evaluateHandle(({name, data}) => {
      const value = new DataTransfer(); value.items.add(new File([new Uint8Array(data)], name, {type: 'text/plain'})); return value;
    }, {name: fileName, data: [...bytes]});
    try { await editor.dispatchEvent('drop', {dataTransfer: transfer, clientX: client.x, clientY: client.y}); } finally { await transfer.dispose(); }
    const response = await uploaded; expect(response.status()).toBe(201);
    const metadata = WhiteboardFileMetadata.parse(await response.json());
    expect(metadata.fileName).toBe(fileName); expect(metadata.contentDigest).toBe(`sha256:${createHash('sha256').update(bytes).digest('hex')}`);
    await expectBoardSynced(page, 30_000);
    expect(await boardHead(request, owner, board)).toEqual({epoch: initial.epoch, seq: initial.seq + 1});
    const rows = await canonicalRows(page); expect(rows).toHaveLength(1); expect(rows[0]!.text).toBe(fileName);
    expect(rows[0]!.geometry.width).toBe(280); expect(rows[0]!.geometry.height).toBe(170);
    expect(rows[0]!.geometry.x + rows[0]!.geometry.width / 2).toBeCloseTo(scene.x, 4);
    expect(rows[0]!.geometry.y + rows[0]!.geometry.height / 2).toBeCloseTo(scene.y, 4);
    expect(await fileAssetRows(F.orgId, board)).toEqual([{asset_id: metadata.assetId, metadata, state: 'active'}]);
    await expect(page.getByTestId('board-image-url')).toHaveCount(0);
    await page.screenshot({path: info.outputPath(`R09-placement-${width}.png`), fullPage: true});
    await page.reload(); await expectBoardSynced(page, 30_000);
    expect(await canonicalRows(page)).toEqual(rows);
    expect(await boardHead(request, owner, board)).toEqual({epoch: initial.epoch, seq: initial.seq + 1});
    await page.screenshot({path: info.outputPath(`R09-reloaded-${width}.png`), fullPage: true});
    await info.attach('R09 placement evidence', {body: JSON.stringify({width, viewport, client, scene, metadata, rows, nativeDatabase, nativeOsDragVerified: false, requiredSuiteComplete: false}, null, 2), contentType: 'application/json'});
  } catch (error) { failures.push(error); }
  finally {
    try { await deleteOwnedConnectorFixture(request, owner, board, F.userId, name); } catch (error) { failures.push(error); }
    try { await verifyConnectorRuntimeManifest(beforeProof); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'R09 placement acceptance or owned cleanup failed');
});
