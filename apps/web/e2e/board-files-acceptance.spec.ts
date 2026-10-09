import {expectBoardSynced} from './support/board-sync-status';
import {test, expect} from '@playwright/test';
import {createHash, randomUUID} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {WhiteboardFileMetadata} from '@repo/contracts/whiteboard-file';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {apiOrigin, boardApi, boardLogin, createAcceptanceBoard, archiveAcceptanceBoard, openBoard, boardHead} from './board-acceptance-support';
import {fileAssetRows, fileWriteCounterproof, setFileFixtureOrgFrozen} from './support/board-files-storage';
import {isBoardFileUploadResponse} from './support/board-file-upload-response';
import {securityFixture} from './support/board-security-fixture';
import {observeRuntimeChunks, runtimeSourceIdentity, verifyRuntimeIdentity} from './board-runtime-evidence';

test('R09 real file drop, multipart filenames, durable refresh download and tenant ACL', async ({browser, page, request, baseURL}, info) => {
  if (!baseURL || !process.env.WORKSPACEX_API_PORT) throw new Error('FILES_REQUIRE_EXISTING_RUNTIME_URLS');
  const phaseStartedAt = Date.now();
  const phase = (name: string) => console.log(`[R09_PHASE] ${name} elapsedMs=${Date.now() - phaseStartedAt}`);
  phase('source-and-disposable-fixture');
  const sha = runtimeSourceIdentity(), chunks = observeRuntimeChunks(page);
  const foreign = await securityFixture(), viewerContext = await browser.newContext({baseURL}), outsiderContext = await browser.newContext({baseURL});
  const viewerPage = await viewerContext.newPage(), outsiderPage = await outsiderContext.newPage();
  const boards: string[] = [], observations: Array<Record<string, unknown>> = [];
  let owner = '', outsider = '', frozenBoard: string | null = null;
  let bodyFailed = false;
  try {
    phase('independent-login-and-board-setup');
    owner = await boardLogin(page);
    const viewer = await boardLogin(viewerPage, F.leadEmail, F.leadPassword);
    outsider = await boardLogin(outsiderPage, foreign.email, foreign.password);
    const board = await createAcceptanceBoard(request, owner, 'R09 durable files'), other = await createAcceptanceBoard(request, owner, 'R09 cross-board');
    boards.push(board, other);
    await boardApi(request, owner, 'PUT', `/whiteboards/${board}/members`, {userId: F.leadUserId, role: 'viewer'});
    await openBoard(page, board, 0);
    phase('runtime-identity-before');
    const runtimeBefore = await verifyRuntimeIdentity(request, sha, await chunks());
    phase('real-drop-and-durable-storage');
    const fileName = 'R09-报告 "原始名称".txt', bytes = Buffer.from(`ordinary file ${randomUUID()}`), digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const uploadResponse = page.waitForResponse(response => isBoardFileUploadResponse(response.request().method(), response.url(), board, apiOrigin(), baseURL));
    const transfer = await page.evaluateHandle(({name, data}) => {
      const value = new DataTransfer(); value.items.add(new File([new Uint8Array(data)], name, {type: 'text/plain'})); return value;
    }, {name: fileName, data: [...bytes]});
    try { await page.getByTestId('board-fabric-surface').dispatchEvent('drop', {dataTransfer: transfer, clientX: 500, clientY: 350}); }
    finally { await transfer.dispose(); }
    const uploaded = await uploadResponse; expect(uploaded.status()).toBe(201);
    const metadata = WhiteboardFileMetadata.parse(await uploaded.json());
    expect(metadata).toMatchObject({fileName, byteSize: bytes.length, contentDigest: digest, persistence: 'durable'});
    const row = page.getByTestId('board-a11y-mirror').locator('li[data-object-id]');
    await expect(row).toHaveCount(1); await expect(row).toHaveAttribute('data-object-text', fileName);
    await expectBoardSynced(page);
    await expect.poll(() => fileAssetRows(F.orgId, board)).toEqual([{asset_id: metadata.assetId, metadata, state: 'active'}]);
    expect(await fileAssetRows(foreign.orgId, board)).toEqual([]); expect(await fileAssetRows(null, board)).toEqual([]);
    phase('authenticated-native-write-counterproofs');
    const positiveWrites = await fileWriteCounterproof(F.orgId, F.orgId, board, metadata.assetId);
    expect(positiveWrites.attempts).toEqual(['insert', 'update', 'delete'].map(action => ({action, rows: 1, sqlState: null})));
    const deniedWrites = [];
    for (const tenant of [foreign.orgId, null]) {
      const proof = await fileWriteCounterproof(tenant, F.orgId, board, metadata.assetId);
      expect(proof.attempts).toEqual([{action: 'insert', rows: null, sqlState: '42501'}, {action: 'update', rows: 0, sqlState: null}, {action: 'delete', rows: 0, sqlState: null}]);
      deniedWrites.push({tenant, ...proof});
    }
    phase('content-http-and-refreshed-browser-download');
    const contentPath = `/whiteboards/${board}/files/${metadata.assetId}/content`;
    const anonymous = await request.get(`${apiOrigin()}${contentPath}`); expect(anonymous.status()).toBe(401);
    const positive = await boardApi(request, owner, 'GET', contentPath);
    expect(await positive.body()).toEqual(bytes);
    expect(positive.headers()).toMatchObject({'content-type': 'application/octet-stream', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff'});
    expect(positive.headers()['content-disposition']).toBe(`attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    await page.reload(); await expectBoardSynced(page);
    await expect(row).toHaveCount(1); await expect(row).toHaveAttribute('data-object-text', fileName);
    const outlineButton = row.getByRole('button'); await outlineButton.focus(); await outlineButton.press('Enter');
    const downloaded = page.waitForEvent('download'); await page.getByRole('button', {name: '下载', exact: true}).click();
    // Chromium replaces unsafe filename characters (including ASCII quotes) with underscores.
    // The API/metadata assertions above retain the original quoted UTF-8 filename.
    const download = await downloaded; expect(download.suggestedFilename()).toBe('R09-报告 _原始名称_.txt');
    const downloadPath = await download.path(); expect(downloadPath).toBeTruthy(); expect(await readFile(downloadPath!)).toEqual(bytes);
    await page.screenshot({path: info.outputPath('R09-file-refreshed.png'), fullPage: true});
    phase('legacy-filename-and-deduplication');
    // Distinct bytes ensure deduplication cannot hide a broken legacy filename fallback.
    const legacyBytes = Buffer.from(`legacy client ${randomUUID()}`), legacyName = '旧客户端.txt';
    const legacy = await request.post(`${apiOrigin()}/whiteboards/${board}/files`, {headers: {authorization: `Bearer ${owner}`}, multipart: {file: {name: legacyName, mimeType: 'text/plain', buffer: legacyBytes}}});
    expect(legacy.status()).toBe(201); const legacyMetadata = WhiteboardFileMetadata.parse(await legacy.json());
    expect(legacyMetadata).toMatchObject({fileName: legacyName, byteSize: legacyBytes.length, contentDigest: `sha256:${createHash('sha256').update(legacyBytes).digest('hex')}`});
    const legacyRead = await boardApi(request, owner, 'GET', `/whiteboards/${board}/files/${legacyMetadata.assetId}/content`); expect(await legacyRead.body()).toEqual(legacyBytes);
    const firstRows = await fileAssetRows(F.orgId, board); expect(firstRows).toHaveLength(2);
    const duplicate = await request.post(`${apiOrigin()}/whiteboards/${board}/files`, {headers: {authorization: `Bearer ${owner}`}, multipart: {fileName: 'renamed.txt', file: {name: 'renamed.txt', mimeType: 'text/plain', buffer: bytes}}});
    expect(duplicate.status()).toBe(201); expect(await duplicate.json()).toEqual(metadata);
    phase('invalid-multipart-and-tenant-denials');
    const beforeDeniedHead = await boardHead(request, owner, board);
    for (const fields of [[['fileName', '']], [['unknown', 'bad']], [['fileName', 'one.txt'], ['fileName', 'two.txt']]] as const) {
      const boundary = `R09-${randomUUID()}`;
      const payload = Buffer.concat([Buffer.from(fields.map(([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`).join('') + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="valid.txt"\r\nContent-Type: text/plain\r\n\r\n`), Buffer.from(`invalid ${randomUUID()}`), Buffer.from(`\r\n--${boundary}--\r\n`)]);
      const rejected = await request.post(`${apiOrigin()}/whiteboards/${board}/files`, {headers: {authorization: `Bearer ${owner}`, 'content-type': `multipart/form-data; boundary=${boundary}`}, data: payload});
      expect(rejected.status()).toBe(400);
    }
    const viewerRead = await boardApi(request, viewer, 'GET', contentPath); expect(await viewerRead.body()).toEqual(bytes);
    const viewerWrite = await request.post(`${apiOrigin()}/whiteboards/${board}/files`, {headers: {authorization: `Bearer ${viewer}`}, multipart: {fileName: 'forbidden.txt', file: {name: 'forbidden.txt', mimeType: 'text/plain', buffer: Buffer.from(randomUUID())}}});
    expect([403, 404]).toContain(viewerWrite.status());
    const foreignWrite = await request.post(`${apiOrigin()}/whiteboards/${board}/files`, {headers: {authorization: `Bearer ${outsider}`}, multipart: {fileName: 'foreign.txt', file: {name: 'foreign.txt', mimeType: 'text/plain', buffer: Buffer.from(randomUUID())}}});
    expect([403, 404]).toContain(foreignWrite.status());
    for (const [label, token, path] of [['foreign-tenant', outsider, contentPath], ['cross-board', owner, `/whiteboards/${other}/files/${metadata.assetId}/content`]] as const) {
      const denied = await request.get(`${apiOrigin()}${path}`, {headers: {authorization: `Bearer ${token}`}}); expect([403, 404]).toContain(denied.status()); observations.push({label, status: denied.status()});
    }
    phase('revocation-and-archived-board-denials');
    await boardApi(request, owner, 'DELETE', `/whiteboards/${board}/members/${F.leadUserId}`);
    const revoked = await request.get(`${apiOrigin()}${contentPath}`, {headers: {authorization: `Bearer ${viewer}`}}); expect([403, 404]).toContain(revoked.status());
    expect(await fileAssetRows(F.orgId, board)).toEqual(firstRows);
    expect(await boardHead(request, owner, board)).toEqual(beforeDeniedHead);
    await archiveAcceptanceBoard(request, owner, board);
    const archivedUpload = await request.post(`${apiOrigin()}/whiteboards/${board}/files`, {headers: {authorization: `Bearer ${owner}`}, multipart: {fileName: 'archived.txt', file: {name: 'archived.txt', mimeType: 'text/plain', buffer: Buffer.from(randomUUID())}}});
    expect([403, 404]).toContain(archivedUpload.status()); expect(await fileAssetRows(F.orgId, board)).toEqual(firstRows);
    phase('disposable-tenant-freeze-counterproofs');
    frozenBoard = await createAcceptanceBoard(request, outsider, 'R09 disposable frozen-org board');
    const frozenSeed = await request.post(`${apiOrigin()}/whiteboards/${frozenBoard}/files`, {headers: {authorization: `Bearer ${outsider}`}, multipart: {fileName: 'before-freeze.txt', file: {name: 'before-freeze.txt', mimeType: 'text/plain', buffer: Buffer.from(randomUUID())}}});
    expect(frozenSeed.status()).toBe(201); const frozenMetadata = WhiteboardFileMetadata.parse(await frozenSeed.json());
    const beforeFreeze = await fileAssetRows(foreign.orgId, frozenBoard);
    await setFileFixtureOrgFrozen(foreign.orgId, true);
    const frozenWrites = await fileWriteCounterproof(foreign.orgId, foreign.orgId, frozenBoard, frozenMetadata.assetId);
    expect(frozenWrites.attempts).toEqual([{action: 'insert', rows: null, sqlState: '42501'}, {action: 'update', rows: null, sqlState: '42501'}, {action: 'delete', rows: 0, sqlState: null}]);
    const frozenUpload = await request.post(`${apiOrigin()}/whiteboards/${frozenBoard}/files`, {headers: {authorization: `Bearer ${outsider}`}, multipart: {fileName: 'after-freeze.txt', file: {name: 'after-freeze.txt', mimeType: 'text/plain', buffer: Buffer.from(randomUUID())}}});
    expect([403, 404]).toContain(frozenUpload.status()); expect(await fileAssetRows(foreign.orgId, frozenBoard)).toEqual(beforeFreeze);
    await setFileFixtureOrgFrozen(foreign.orgId, false);
    phase('runtime-identity-after-and-receipt');
    const runtimeAfter = await verifyRuntimeIdentity(request, sha, runtimeBefore.chunks);
    const resultPath = info.outputPath('R09-files-result.json');
    await writeFile(resultPath, JSON.stringify({sha, runtimeBefore, runtimeAfter, boardId: board, metadata, legacyMetadata, persistedRows: firstRows, beforeDeniedHead, positiveWrites, deniedWrites, frozenWrites, observations, viewerUploadStatus: viewerWrite.status(), foreignUploadStatus: foreignWrite.status(), revokedStatus: revoked.status(), archivedUploadStatus: archivedUpload.status(), frozenUploadStatus: frozenUpload.status(), approved: false}, null, 2), {mode: 0o600});
    await info.attach('R09-files-result.json', {path: resultPath, contentType: 'application/json'});
    phase('body-completed');
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    phase('cleanup');
    const errors: unknown[] = [];
    const clean = async (action: () => Promise<unknown>) => { try { await action(); } catch (error) { errors.push(error); } };
    if (frozenBoard) {
      await clean(() => setFileFixtureOrgFrozen(foreign.orgId, false));
      await clean(() => archiveAcceptanceBoard(request, outsider, frozenBoard!));
    }
    for (const board of boards) await clean(() => archiveAcceptanceBoard(request, owner, board));
    await clean(() => viewerContext.close()); await clean(() => outsiderContext.close()); await clean(() => foreign.cleanup());
    if (errors.length) {
      // Preserve the failing operation's original stack. Cleanup alone must still fail.
      console.error(`[R09_CLEANUP] errors=${errors.length} bodyFailed=${bodyFailed}`);
      if (!bodyFailed) throw new AggregateError(errors, 'R09 file acceptance cleanup failed');
    }
  }
});
