import {test, expect, type BrowserContext} from '@playwright/test';
import {createHash, randomUUID} from 'node:crypto';
import {Board, DeleteBoard, DeleteBoardReceipt} from '@repo/contracts/whiteboard';
import {WHITEBOARD_FILE_LIMITS, WhiteboardFileMetadata} from '@repo/contracts/whiteboard-file';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {apiOrigin, boardApi, boardLogin, boardHead, createAcceptanceBoard} from './board-acceptance-support';
import {fileAssetRows} from './support/board-files-storage';

test('R09 missing, empty, oversized and revoked file writes leave no asset or board update', async ({browser, page, request, baseURL}, info) => {
  if (!baseURL || !process.env.WORKSPACEX_API_PORT) throw new Error('FILES_REQUIRE_EXISTING_RUNTIME_URLS');
  const owner = await boardLogin(page), name = `R09 boundary ${randomUUID()}`;
  const board = await createAcceptanceBoard(request, owner, name);
  let context: BrowserContext | undefined;
  const observations: Array<{case: string; status: number}> = [];
  const failures: unknown[] = [];
  try {
    context = await browser.newContext({baseURL});
    const editor = await boardLogin(await context.newPage(), F.leadEmail, F.leadPassword);
    await boardApi(request, owner, 'PUT', `/whiteboards/${board}/members`, {userId: F.leadUserId, role: 'editor'});
    const initial = await boardHead(request, owner, board);
    const upload = (token: string, bytes: Buffer, fileName: string) => request.post(`${apiOrigin()}/whiteboards/${board}/files`, {
      headers: {authorization: `Bearer ${token}`}, multipart: {fileName, file: {name: fileName, mimeType: 'application/octet-stream', buffer: bytes}},
    });
    const unchanged = async () => {
      expect(await boardHead(request, owner, board)).toEqual(initial);
      expect(await fileAssetRows(F.orgId, board)).toEqual([]);
    };
    const missing = await request.post(`${apiOrigin()}/whiteboards/${board}/files`, {
      headers: {authorization: `Bearer ${owner}`}, multipart: {fileName: 'missing.bin'},
    });
    expect(missing.status()).toBe(400); observations.push({case: 'missing', status: missing.status()}); await unchanged();
    const empty = await upload(owner, Buffer.alloc(0), 'empty.bin');
    expect(empty.status()).toBe(400); observations.push({case: 'empty', status: empty.status()}); await unchanged();
    const oversized = Buffer.alloc(WHITEBOARD_FILE_LIMITS.bytes + 1, 97);
    const oversizedAsset = `board-file-${createHash('sha256').update(oversized).digest('hex')}`;
    const tooLarge = await upload(owner, oversized, 'oversized.bin');
    expect(tooLarge.status()).toBe(413); observations.push({case: 'oversized', status: tooLarge.status()}); await unchanged();
    const inaccessible = await request.get(`${apiOrigin()}/whiteboards/${board}/files/${oversizedAsset}/content`, {headers: {authorization: `Bearer ${owner}`}});
    expect(inaccessible.status()).toBe(404);
    // The identical well-formed request succeeds before revocation, proving rejection is not a malformed payload.
    const validBytes = Buffer.from(`revocation ${randomUUID()}`), validName = 'permission-positive.bin';
    const positive = await upload(editor, validBytes, validName); expect(positive.status()).toBe(201);
    const metadata = WhiteboardFileMetadata.parse(await positive.json());
    const rows = await fileAssetRows(F.orgId, board); expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toEqual(metadata); expect(await boardHead(request, owner, board)).toEqual(initial);
    await boardApi(request, owner, 'DELETE', `/whiteboards/${board}/members/${F.leadUserId}`);
    const denied = await upload(editor, validBytes, validName);
    expect([403, 404]).toContain(denied.status()); observations.push({case: 'revoked-identical-valid-request', status: denied.status()});
    expect(await fileAssetRows(F.orgId, board)).toEqual(rows); expect(await boardHead(request, owner, board)).toEqual(initial);
    const evidence = {observations, oversizedBytes: oversized.length, inaccessibleAssetStatus: inaccessible.status(), requiredSuiteComplete: false, nativeOsDragVerified: false};
    await info.attach('R09 boundary HTTP evidence', {body: JSON.stringify(evidence, null, 2), contentType: 'application/json'});
  } catch (error) { failures.push(error); }
  finally {
    try {
      const current = Board.parse(await (await boardApi(request, owner, 'GET', `/whiteboards/${board}`)).json());
      expect(current.ownerId).toBe(F.userId); expect(current.name).toBe(name); expect(current.role).toBe('owner');
      if (!current.archived) await boardApi(request, owner, 'PATCH', `/whiteboards/${board}`, {archived: true, expectedLifecycleRevision: current.lifecycleRevision});
      const archived = Board.parse(await (await boardApi(request, owner, 'GET', `/whiteboards/${board}`)).json());
      const input = DeleteBoard.parse({requestId: randomUUID(), confirmation: 'PERMANENTLY_DELETE', expectedLifecycleRevision: archived.lifecycleRevision});
      expect(DeleteBoardReceipt.parse(await (await boardApi(request, owner, 'DELETE', `/whiteboards/${board}`, input)).json())).toEqual({requestId: input.requestId, boardId: board, deleted: true});
      const gone = await request.get(`${apiOrigin()}/whiteboards/${board}`, {headers: {authorization: `Bearer ${owner}`}}); expect(gone.status()).toBe(404);
    } catch (error) { failures.push(error); }
    try { await context?.close(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'R09 boundary acceptance or owned cleanup failed');
});
