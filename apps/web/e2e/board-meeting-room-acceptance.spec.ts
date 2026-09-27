import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {expect, test, type Page} from '@playwright/test';
import {apiOrigin, archiveAcceptanceBoard, boardApi, boardLogin, createAcceptanceBoard, canonicalRows, object} from './board-acceptance-support';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {observeRuntimeChunks, runtimeSourceIdentity, verifyRuntimeIdentity} from './board-runtime-evidence';
import {ROOM_REQUIREMENTS, readRoomViewport, roomClock, roomHash, signRoomLedger, validateRoomArtifact, type RoomArtifact, type RoomReceipt, type RoomEvent, type RoomSample, type RoomState} from './support/board-meeting-room-evidence';
import {observeRoomResponses} from './support/board-meeting-room-observer';
import {persistedRoomState} from './support/board-meeting-room-storage';

// Main session alone runs this producer. There is no short-duration override or skip path.
test('meeting room real 30 minute presentation, recovery, CAS and revocation lifecycle', async ({browser, request: api, baseURL}) => {
  const sha = runtimeSourceIdentity(), key = process.env.BOARD_ACCEPTANCE_LEDGER_KEY ?? '';
  expect(key.length, 'Supply a private HMAC key; never write it to the report').toBeGreaterThanOrEqual(32);
  const contexts = await Promise.all([1440, 1920, 1280].map(width => browser.newContext({baseURL, viewport: {width, height: 900}})));
  const [owner, display, follower] = await Promise.all(contexts.map(context => context.newPage()));
  const receipts: RoomReceipt[] = [], observationErrors: string[] = [];
  const chunks = observeRuntimeChunks(owner!); const events: RoomEvent[] = [], samples: RoomSample[] = [];
  let boardId: string | undefined, ownerToken: string | undefined, archived = false;
  const roomId = `acceptance-${randomUUID()}`, displayActor = `room:${roomId}:meeting-room-display`;
  const record = (type: string, before: number, after: number, detail: unknown, status?: number) => events.push({...roomClock(), type, before, after, detail, detailHash: roomHash(detail), ...(status === undefined ? {} : {status})});
  try {
    const tokens = await Promise.all([boardLogin(owner!, F.adminEmail, F.adminPassword), boardLogin(display!, F.leadEmail, F.leadPassword), boardLogin(follower!, F.email, F.password)]);
    ownerToken = tokens[0]!; const displayToken = tokens[1]!, followerToken = tokens[2]!;
    boardId = await createAcceptanceBoard(api, ownerToken, `Meeting room ${roomId}`);
    await Promise.all([F.leadUserId, F.userId].map(userId => boardApi(api, ownerToken!, 'PUT', `/whiteboards/${boardId}/members`, {userId, role: 'editor'})));
    await boardApi(api, ownerToken, 'POST', `/whiteboards/${boardId}/commands`, {requestId: randomUUID(), epoch: 1, commands: [{type: 'create', object: object('meeting-anchor', 'sticky', 300, 250, '会议室持续内容验证')}]});
    const route = `/studio/board/${boardId}?room=${encodeURIComponent(roomId)}`;
    let lastReadId = '';
    const state = async () => {
      const response = await boardApi(api, ownerToken!, 'GET', `/v1/whiteboards/${boardId}/presentation?roomId=${encodeURIComponent(roomId)}`);
      const value = await response.json() as RoomState; lastReadId = randomUUID();
      receipts.push({...roomClock(), id: lastReadId, clientId: F.adminUserId, status: response.status(), method: 'GET', state: value}); return value;
    };
    const observations = [observeRoomResponses(owner!, boardId, F.adminUserId, receipts, observationErrors), observeRoomResponses(display!, boardId, F.leadUserId, receipts, observationErrors), observeRoomResponses(follower!, boardId, F.userId, receipts, observationErrors)];
    const controls = (page: Page) => page.getByTestId('board-presentation-controls');
    const go = async (page: Page, url: string) => {await page.goto(url); await expect(page.getByTestId('collaborative-editor')).toBeVisible({timeout: 30_000}); await expect(controls(page)).toBeVisible(); await expect(page.getByTestId('board-fabric-surface').locator('canvas.upper-canvas')).toBeVisible();};
    await Promise.all([go(owner!, route), go(display!, `${route}&device=meeting-room-display`), go(follower!, route)]);
    for (const page of [owner!, display!, follower!]) await expect(page.getByTestId('board-a11y-object-meeting-anchor')).toHaveAccessibleName('图形：会议室持续内容验证');
    const contentHash = roomHash(await canonicalRows(owner!));
    const runtimeBefore = await verifyRuntimeIdentity(api, sha, await chunks());
    await controls(owner!).getByRole('button', {name: '开始演示', exact: true}).click();
    await expect.poll(async () => (await state()).presenterId).toBe(F.adminUserId);
    let current = await state(); record('claim', 0, current.revision, current);
    for (const page of [display!, follower!]) await controls(page).getByRole('button', {name: '跟随演示者', exact: true}).click();
    await expect.poll(async () => (await state()).followers.slice().sort()).toEqual([displayActor, F.userId].sort());
    current = await state(); record('follow', 1, current.revision, current);
    const roomToken = () => display!.evaluate(key => sessionStorage.getItem(key), `board-room:${boardId}:${roomId}:meeting-room-display`);
    await expect.poll(async () => Boolean(await roomToken())).toBe(true);
    let tokenBeforeReconnect: string | null = null;
    const start = roomClock(); let chain = roomHash({sha, boardId, roomId, startedAt: start.at}), disconnected = false;
    while (performance.now() - start.monotonicMs < ROOM_REQUIREMENTS.durationMs || samples.length < ROOM_REQUIREMENTS.minSamples) {
      const before = await state();
      const disconnectThisRound = !disconnected && performance.now() - start.monotonicMs >= ROOM_REQUIREMENTS.durationMs / 2;
      if (disconnectThisRound) {
        tokenBeforeReconnect = await roomToken(); expect(tokenBeforeReconnect).toBeTruthy();
        await contexts[1]!.setOffline(true); await expect(display!.getByText(/连接中断/)).toBeVisible({timeout: 20_000});
        record('disconnect', before.revision, before.revision, {actorId: displayActor});
      }
      // Real user input reaches the Fabric viewport callback and durable presentation API.
      await owner!.getByTestId(samples.length % 2 ? 'board-zoom-out' : 'board-zoom-in').click();
      await expect.poll(async () => (await state()).revision, {timeout: 20_000}).toBeGreaterThan(before.revision);
      current = await state(); expect(current.presenterId).toBe(F.adminUserId);
      if (disconnectThisRound) {
        await expect.poll(() => readRoomViewport(display!)).not.toEqual(current.viewport);
        await contexts[1]!.setOffline(false); await display!.reload(); await expect(controls(display!)).toBeVisible({timeout: 30_000});
        await expect.poll(async () => {const token = await roomToken(); return Boolean(token && token !== tokenBeforeReconnect);}).toBe(true);
        record('reconnect', before.revision, current.revision, {actorId: displayActor, previousTokenHash: roomHash(tokenBeforeReconnect), nextTokenHash: roomHash(await roomToken())}); disconnected = true;
      }
      for (const page of [display!, follower!]) await expect.poll(() => readRoomViewport(page), {timeout: 20_000}).toEqual(current.viewport);
      const displays = [{actorId: displayActor, viewport: await readRoomViewport(display!), contentHash: roomHash(await canonicalRows(display!))}, {actorId: F.userId, viewport: await readRoomViewport(follower!), contentHash: roomHash(await canonicalRows(follower!))}];
      const body = {...roomClock(), receiptId: lastReadId, state: current, displays};
      chain = roomHash({previous: chain, sample: body}); samples.push({...body, chainHash: chain});
      if (samples.length % 60 === 0) await test.info().attach(`meeting-room-${samples.length}`, {body: await display!.screenshot(), contentType: 'image/png'});
      // Wait between actual observations; no timestamps or revisions are interpolated.
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    const finish = roomClock();
    await controls(follower!).getByRole('button', {name: '自由浏览', exact: true}).click();
    await expect.poll(async () => (await state()).followers).not.toContain(F.userId); current = await state(); record('leave-follow', samples.at(-1)!.state.revision, current.revision, current);
    const independent = await readRoomViewport(follower!);
    await owner!.getByTestId('board-zoom-in').click(); await expect.poll(async () => (await state()).revision).toBeGreaterThan(current.revision);
    await expect.poll(() => readRoomViewport(display!)).toEqual((await state()).viewport); expect(await readRoomViewport(follower!)).toEqual(independent);
    await controls(follower!).getByRole('button', {name: '跟随演示者', exact: true}).click(); await expect.poll(async () => (await state()).followers).toContain(F.userId);
    current = await state(); record('refollow', 0, current.revision, current);
    // Two authenticated contenders use the same real revision: exactly one succeeds.
    const revision = current.revision;
    const results = await Promise.all([F.adminUserId, displayActor].map(toActorId => api.post(`${apiOrigin()}/v1/whiteboards/${boardId}/presentation`, {headers: {authorization: `Bearer ${ownerToken}`}, data: {roomId, reconnectToken: null, command: {type: 'handoff', actorId: F.adminUserId, toActorId, expectedRevision: revision}}})));
    expect(results.map(response => response.status()).sort()).toEqual([201, 409]);
    for (let index = 0; index < results.length; index++) {
      const response = results[index]!; receipts.push({...roomClock(), id: randomUUID(), clientId: F.adminUserId, method: 'POST', status: response.status(), command: {type: 'handoff', actorId: F.adminUserId, expectedRevision: revision}, ...(response.ok() ? {state: await response.json() as RoomState} : {})});
    }
    current = await state(); expect(current.revision).toBe(revision + 1); record('cas-conflict', current.revision, current.revision, {statuses: results.map(response => response.status())}, 409);
    if (current.presenterId === F.adminUserId) {
      await controls(owner!).getByRole('button', {name: '交给会议室', exact: true}).click(); await expect.poll(async () => (await state()).presenterId).toBe(displayActor);
    }
    current = await state(); record('handoff', revision, current.revision, current);
    await controls(owner!).getByRole('button', {name: '跟随演示者', exact: true}).click();
    await display!.getByTestId('board-zoom-in').click(); await expect.poll(async () => (await state()).revision).toBeGreaterThan(current.revision);
    current = await state(); await expect.poll(() => readRoomViewport(owner!)).toEqual(current.viewport);
    // Following must release when a user deliberately pans; an absent product behavior fails here.
    await follower!.getByTestId('board-tool-hand').click(); const box = await follower!.getByTestId('board-fabric-surface').boundingBox(); expect(box).not.toBeNull();
    await follower!.mouse.move(box!.x + 400, box!.y + 300); await follower!.mouse.down(); await follower!.mouse.move(box!.x + 510, box!.y + 340, {steps: 12}); await follower!.mouse.up();
    await expect.poll(async () => (await state()).followers).not.toContain(F.userId); record('manual-pan-leave', current.revision, (await state()).revision, await readRoomViewport(follower!));
    await boardApi(api, ownerToken, 'DELETE', `/whiteboards/${boardId}/members/${encodeURIComponent(F.userId)}`);
    await expect(follower!.getByTestId('denied')).toBeVisible({timeout: 30_000}); await expect(follower!.getByTestId('collaborative-editor')).toHaveCount(0);
    current = await state(); record('revoke', current.revision, current.revision, {actorId: F.userId});
    const deniedRead = await api.get(`${apiOrigin()}/v1/whiteboards/${boardId}/presentation?roomId=${encodeURIComponent(roomId)}`, {headers: {authorization: `Bearer ${followerToken}`}});
    receipts.push({...roomClock(), id: randomUUID(), clientId: F.userId, method: 'GET', status: deniedRead.status()});
    expect([403, 404]).toContain(deniedRead.status()); record('revoked-read', current.revision, current.revision, {}, deniedRead.status());
    const deniedWrite = await api.post(`${apiOrigin()}/v1/whiteboards/${boardId}/presentation`, {headers: {authorization: `Bearer ${followerToken}`}, data: {roomId, reconnectToken: null, command: {type: 'claim-presenter', actorId: F.userId, expectedRevision: current.revision}}});
    receipts.push({...roomClock(), id: randomUUID(), clientId: F.userId, method: 'POST', status: deniedWrite.status(), command: {type: 'claim-presenter', actorId: F.userId, expectedRevision: current.revision}});
    expect([403, 404]).toContain(deniedWrite.status()); expect(await state()).toEqual(current); record('revoked-write', current.revision, current.revision, {}, deniedWrite.status());
    await controls(display!).getByRole('button', {name: '结束演示', exact: true}).click(); await expect.poll(async () => (await state()).presenterId).toBeNull();
    const finalState = await state(); expect(finalState.followers).toEqual([]); record('release', current.revision, finalState.revision, finalState);
    const persistedState = await persistedRoomState(F.orgId, boardId, roomId); expect(persistedState).toEqual(finalState); record('persisted-read', finalState.revision, finalState.revision, persistedState);
    await Promise.all([owner!.reload(), display!.reload()]); await expect(controls(owner!).getByRole('button', {name: '开始演示', exact: true})).toBeVisible(); expect(await state()).toEqual(finalState);
    for (const page of [owner!, display!]) await expect.poll(async () => roomHash(await canonicalRows(page))).toBe(contentHash);
    record('reloaded', finalState.revision, finalState.revision, await state());
    await archiveAcceptanceBoard(api, ownerToken, boardId); archived = true; const resource = await (await boardApi(api, ownerToken, 'GET', `/whiteboards/${boardId}`)).json(); expect(resource.archived).toBe(true); record('archived', finalState.revision, finalState.revision, {archived: resource.archived});
    const runtimeAfter = await verifyRuntimeIdentity(api, sha, await chunks());
    const ledger = signRoomLedger({version: 1, sha, buildSha: sha, boardId, roomId, presenterId: F.adminUserId, followerIds: [displayActor, F.userId], contentHash, startedAt: start.at, finishedAt: finish.at, startedMonotonicMs: start.monotonicMs, finishedMonotonicMs: finish.monotonicMs, samples, events, persistedState, finalState}, key);
    await Promise.all(observations.map(finish => finish()));
    const artifact: RoomArtifact = {version: 1, kind: 'board-meeting-room', ledger, runtimeBefore, runtimeAfter, receipts, observationErrors, identities: [{userId: F.adminUserId, actorId: F.adminUserId}, {userId: F.leadUserId, actorId: displayActor}, {userId: F.userId, actorId: F.userId}]};
    expect(validateRoomArtifact(artifact, sha, key)).toEqual([]);
    await writeFile(test.info().outputPath('meeting-room-ledger.json'), JSON.stringify({...artifact, environment: {browser: browser.version(), displayViewport: {width: 1920, height: 900}, deviceScope: 'desktop browser meeting-display, not physical touch hardware'}}, null, 2), {mode: 0o600});
    // Token is intentionally never included in artifacts (including the rotated reconnect token).
    void displayToken;
  } catch (error) {
    await writeFile(test.info().outputPath('meeting-room-partial.json'), JSON.stringify({sha, boardId, roomId, samples, events, receipts, observationErrors, status: 'failed'}, null, 2), {mode: 0o600}); throw error;
  } finally {
    try {await Promise.all(contexts.map(context => context.setOffline(false))); if (boardId && ownerToken && !archived) await archiveAcceptanceBoard(api, ownerToken, boardId);}
    finally {await Promise.all(contexts.map(context => context.close()));}
  }
});
