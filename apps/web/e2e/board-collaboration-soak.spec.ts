import {signRecoveryPhase,verifyRecoveryPhase,type SoakRecovery,type RecoveryAck} from './support/board-soak-recovery-phase';
import {createSoakWriterNote} from './support/board-soak-canvas-create';
import {expect, test, type BrowserContext} from '@playwright/test';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {BOARD_SOAK_REQUIREMENTS, nextBoardChain, signBoardSoakLedger, verifyBoardSoakLedger, type BoardAck, type BoardSoakSample} from '../../api/scripts/board-acceptance-ledger';
import {archiveAcceptanceBoard, boardApi, createAcceptanceBoard} from './board-acceptance-support';
import {observeRuntimeChunks, runtimeSourceIdentity, verifyRuntimeIdentity} from './board-runtime-evidence';
import {loginBoardSoakActor, removeBoardSoakIdentities, seedBoardSoakIdentities, type SoakIdentity} from './support/board-soak-identities';
import {BoardSoakClient, canonicalHash, installSoakProjectionObserver, projectedRows, projectionSnapshot, soakHash, type RawAck} from './support/board-soak-producer';

// Deliberately opt-in via the dedicated fresh-stack config. No retry may turn a
// failed 30-minute run into hidden evidence. Login/session secrets must not enter traces.
test.use({trace: 'off', video: 'off'});
test('Board 50 independent browser contexts 20 writers real 30 minute soak', async ({browser, request, baseURL}, testInfo) => {
  test.setTimeout(45 * 60_000);
  const key = process.env.BOARD_ACCEPTANCE_LEDGER_KEY;
  if (!key || key.length < 32) throw new Error('BOARD_ACCEPTANCE_LEDGER_KEY_REQUIRED_MINIMUM_32_CHARACTERS');
  const sha = runtimeSourceIdentity();
  if (!baseURL) throw new Error('SOAK_BASE_URL_REQUIRED');
  const contexts: BrowserContext[] = [], clients: BoardSoakClient[] = [], samples: BoardSoakSample[] = [];
  const projectionEvidence: Array<{clientId: string; at: string; observedAt: string; projectionHash: string; revision: number}> = [];
  const recoveries: SoakRecovery[] = [];
  let actors: SoakIdentity[] = [], boardId: string | undefined, ownerToken: string | undefined;
  let startedAt: string | undefined, finishedAt: string | undefined, elapsedMonotonicMs = 0;
  let completed = false;
  try {
    process.stdout.write('BOARD_SOAK_PHASE initial-sync\n');
    actors = await seedBoardSoakIdentities();
    expect(new Set(actors.map(actor => actor.userId)).size).toBe(50);
    expect(new Set(actors.map(actor => actor.email)).size).toBe(50);
    let finishChunks: ReturnType<typeof observeRuntimeChunks> | undefined;
    for (let index = 0; index < actors.length; index++) {
      const actor = actors[index]!;
      const context = await browser.newContext({baseURL, viewport: {width: 1280, height: 800}});
      contexts.push(context);
      const page = await context.newPage();
      if (index === 0) finishChunks = observeRuntimeChunks(page);
      // Distinct sessions and users, normal UI login, no injected test principal.
      let token: string;
      try {token = await loginBoardSoakActor(page, actor);} catch {throw new Error(`SOAK_REAL_LOGIN_FAILED_CLIENT_${index}`);}
      if (index === 0) {ownerToken = token; boardId = await createAcceptanceBoard(request, token, `50-client soak ${sha.slice(0, 8)}`);}
      else await boardApi(request, ownerToken!, 'PUT', `/whiteboards/${boardId}/members`, {userId: actor.userId, role: actor.role});
      const client = new BoardSoakClient(page, actor, boardId!);
      clients.push(client);
      await page.goto(`/studio/board/${boardId}`);
      await expect.poll(() => client.connected, {timeout: 30_000}).toBe(true);
      expect(client.role).toBe(actor.role);
      await expect(page.getByTestId('board-a11y-mirror')).toBeAttached();
      await installSoakProjectionObserver(page);
      if (actor.role === 'viewer') await expect(page.getByTestId('board-add-sticky')).toBeDisabled();
    }
    expect(contexts).toHaveLength(BOARD_SOAK_REQUIREMENTS.clients);
    const writers = clients.filter(client => client.actor.role !== 'viewer');
    expect(writers).toHaveLength(BOARD_SOAK_REQUIREMENTS.writers);
    const observer = clients.at(-1)!; // Read-only, never disconnected: canonical committed revision witness.
    // Preparation precedes the measured interval. Place each real sticky after
    // peers observe the previous one, so a remote arrival cannot steal its blank
    // canvas hit. The measured rounds below still run all 20 writers concurrently.
    for (const [index,client] of writers.entries()) {
      await createSoakWriterNote(client.page,index);
      await expect.poll(() => clients.every(peer => peer.doc.getMap('objects').size === index + 1), {timeout: 30_000}).toBe(true);
    }
    await expect.poll(() => observer.doc.getMap('objects').size, {timeout: 30_000}).toBe(20);
    await expect.poll(() => clients.every(client => client.connected && canonicalHash(client.doc) === canonicalHash(observer.doc)), {timeout: 30_000}).toBe(true);
    await expect.poll(() => writers.every(client => client.sent.size === client.acknowledgements.length), {timeout: 30_000}).toBe(true);
    const baselineRevision = observer.revision;
    for (const client of clients) client.assertHealthy();
    const runtimeBefore = await verifyRuntimeIdentity(request, sha, await finishChunks!());
    process.stdout.write('BOARD_SOAK_PHASE measurement\n');
    const startedWall = Date.now(), startedMono = performance.now();
    startedAt = new Date(startedWall).toISOString();
    let round = 0;
    while (Date.now() - startedWall < BOARD_SOAK_REQUIREMENTS.durationMs || performance.now() - startedMono < BOARD_SOAK_REQUIREMENTS.durationMs) {
      const roundStart = performance.now();
      const priorAcks = writers.map(client => client.acknowledgements.length);
      await Promise.all(writers.map(async (client, index) => {
        await client.page.getByLabel('对象文字', {exact: true}).fill(`Soak writer ${index}: round ${round}`);
      }));
      await expect.poll(() => writers.every((client, index) => client.acknowledgements.length > priorAcks[index]!), {timeout: 20_000, intervals: [20, 50, 100]}).toBe(true);
      const roundAcks = writers.flatMap((client, index) => client.acknowledgements.slice(priorAcks[index]));
      const lastAck = [...roundAcks].sort((a, b) => b.revision - a.revision)[0]!;
      await expect.poll(() => observer.revision, {timeout: 20_000, intervals: [20, 50, 100]}).toBe(lastAck.revision);
      const firstSendAt = Math.min(...roundAcks.map(ack => Date.parse(ack.sentAt)));
      const expectedHash = canonicalHash(observer.doc), expectedProjection = soakHash(projectedRows(observer.doc));
      await Promise.all(clients.map(async client => {
        await expect.poll(async () => {
          client.assertHealthy();
          const projection = await projectionSnapshot(client.page);
          return client.connected && client.revision === lastAck.revision && canonicalHash(client.doc) === expectedHash
            && soakHash(JSON.parse(projection.serialized)) === expectedProjection;
        }, {timeout: 20_000, intervals: [20, 50, 100]}).toBe(true);
        const projection = await projectionSnapshot(client.page), at = new Date().toISOString();
        // End-to-end latency starts at the earliest real outbound operation in the concurrent burst, ending at
        // this browser's actual DOM convergence, not the time a poll happens to return.
        const latencyMs = Math.max(0, projection.observedAt - firstSendAt);
        samples.push({at, clientId: client.actor.userId, writer: client.actor.role !== 'viewer', connected: client.connected,
          revision: client.revision, stateHash: canonicalHash(client.doc), latencyMs, chainHash: ''});
        projectionEvidence.push({clientId: client.actor.userId, at, observedAt: new Date(projection.observedAt).toISOString(), projectionHash: expectedProjection, revision: client.revision});
      }));
      // Fail at the offending round, preserving partial evidence, instead of
      // signing a ledger that hides a long observation gap.
      expect(performance.now() - roundStart).toBeLessThan(BOARD_SOAK_REQUIREMENTS.maxSampleGapMs);
      round++;
      await delay(Math.max(0, 10_000 - (performance.now() - roundStart)));
    }
    process.stdout.write('BOARD_SOAK_PHASE verification\n');
    finishedAt = new Date().toISOString(); elapsedMonotonicMs = performance.now() - startedMono;
    expect(elapsedMonotonicMs).toBeGreaterThanOrEqual(BOARD_SOAK_REQUIREMENTS.durationMs);
    const rawAcks: RawAck[] = writers.flatMap(client => client.acknowledgements).filter(ack => ack.revision > baselineRevision).sort((a, b) => Date.parse(a.acknowledgedAt) - Date.parse(b.acknowledgedAt));
    const acknowledgements: BoardAck[] = rawAcks.map(ack => {
      const stateHash = observer.serverHashes.get(ack.revision);
      if (!stateHash) throw new Error('SOAK_ACK_WITHOUT_OBSERVED_COMMITTED_REVISION');
      return {operationId: ack.operationId, actorId: ack.actorId, revision: ack.revision, stateHash, sentAt: ack.sentAt, acknowledgedAt: ack.acknowledgedAt};
    });
    samples.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    let chain = createHash('sha256').update(`${sha}:${startedAt}`).digest('hex');
    for (const sample of samples) {const {chainHash: _, ...body} = sample; chain = nextBoardChain(chain, body); sample.chainHash = chain;}
    const latencies = samples.map(sample => sample.latencyMs).sort((a, b) => a - b);
    const runtimeAfter = await verifyRuntimeIdentity(request, sha, await finishChunks!());
    const ledger = signBoardSoakLedger({version: 2, sha, buildSha: runtimeAfter.buildSha, startedAt, finishedAt,
      durationMs: Date.parse(finishedAt) - Date.parse(startedAt), clients: clients.length, writers: writers.length,
      convergenceP95Ms: latencies[Math.ceil(latencies.length * .95) - 1]!, finalStateHash: canonicalHash(observer.doc), samples, acknowledgements}, key);
    expect(verifyBoardSoakLedger(ledger, key), 'The unchanged full-presence30-minute measurement must pass before recovery').toBe(true);
    const measurementDisconnects=clients.flatMap(client=>client.events).filter(event=>event.type==='disconnect'&&Date.parse(event.at)>=startedWall&&Date.parse(event.at)<=Date.parse(finishedAt!));
    expect(measurementDisconnects).toHaveLength(0);
    process.stdout.write('BOARD_SOAK_PHASE recovery\n');
    const recoveryStartedAt=new Date().toISOString();
    for(let gap=0;gap<5;gap++){
      const recovering=clients[20+gap]!,beforeRevision=observer.revision,disconnectedAt=new Date().toISOString();
      await recovering.page.context().setOffline(true);
      await expect.poll(()=>recovering.connected,{timeout:10000}).toBe(false);
      const offlineStarted=performance.now(),acknowledgements:RecoveryAck[]=[];
      let burst=0;
      while(performance.now()-offlineStarted<30000){
        const counts=writers.map(client=>client.acknowledgements.length);
        await Promise.all(writers.map((client,index)=>client.page.getByLabel('对象文字',{exact:true}).fill(`Recovery ${gap} writer ${index} burst ${burst}`)));
        await expect.poll(()=>writers.every((client,index)=>client.acknowledgements.length>counts[index]!),{timeout:20000}).toBe(true);
        const acks=writers.flatMap((client,index)=>client.acknowledgements.slice(counts[index])).sort((a,b)=>a.revision-b.revision);
        await expect.poll(()=>observer.revision,{timeout:20000}).toBe(acks.at(-1)!.revision);
        for(const ack of acks){const stateHash=observer.serverHashes.get(ack.revision);if(!stateHash)throw new Error('RECOVERY_ACK_WITHOUT_OBSERVER_HASH');acknowledgements.push({operationId:ack.operationId,actorId:ack.actorId,revision:ack.revision,stateHash,sentAt:ack.sentAt,acknowledgedAt:ack.acknowledgedAt});}
        burst++;await delay(Math.min(10000,Math.max(0,30000-(performance.now()-offlineStarted))));
      }
      const offlineMonotonicMs=performance.now()-offlineStarted;
      await recovering.page.context().setOffline(false);
      await expect.poll(()=>clients.every(client=>client.connected&&client.revision===observer.revision&&canonicalHash(client.doc)===canonicalHash(observer.doc)),{timeout:20000}).toBe(true);
      const observerHash=canonicalHash(observer.doc),expectedProjection=soakHash(projectedRows(observer.doc));
      for(const client of clients){client.assertHealthy();await expect.poll(async()=>soakHash(JSON.parse((await projectionSnapshot(client.page)).serialized)),{timeout:20000}).toBe(expectedProjection);}
      recoveries.push({clientId:recovering.actor.userId,disconnectedAt,reconnectedAt:new Date().toISOString(),beforeRevision,afterRevision:observer.revision,offlineMonotonicMs,observerHash,peerHashes:clients.map(client=>({clientId:client.actor.userId,revision:client.revision,stateHash:canonicalHash(client.doc)})),acknowledgements});
    }
    const recoveryPhase=signRecoveryPhase({version:1,sha,measurementSignature:ledger.signature,startedAt:recoveryStartedAt,finishedAt:new Date().toISOString(),recoveries},key);
    expect(verifyRecoveryPhase(recoveryPhase,key,sha,ledger.signature,finishedAt!,Math.max(...ledger.acknowledgements.map(ack=>ack.revision)),actors)).toBe(true);
    const recoveryRuntimeAfter=await verifyRuntimeIdentity(request,sha,await finishChunks!());
    process.stdout.write('BOARD_SOAK_PHASE verification\n');
    await writeFile(testInfo.outputPath('board-soak-ledger.json'), JSON.stringify(ledger, null, 2));
    await writeFile(testInfo.outputPath('board-soak-runtime.json'), JSON.stringify({runtimeBefore, runtimeAfter, elapsedMonotonicMs, round,
      identities: actors.map(({userId, role}) => ({userId, role})), projectionEvidence, recoveries, recoveryPhase, recoveryRuntimeAfter,
      transport: clients.flatMap(client => client.events), acknowledgementTimings: rawAcks}, null, 2));
    await testInfo.attach('board-soak-ledger', {path: testInfo.outputPath('board-soak-ledger.json'), contentType: 'application/json'});
    await testInfo.attach('board-soak-runtime', {path: testInfo.outputPath('board-soak-runtime.json'), contentType: 'application/json'});
    if (process.env.BOARD_SOAK_REPORT_PATH) {
      const reference = async (name: string) => {const path = testInfo.outputPath(name); return {path, sha256: createHash('sha256').update(await readFile(path)).digest('hex')};};
      await writeFile(process.env.BOARD_SOAK_REPORT_PATH, JSON.stringify({version: 1, kind: 'board-collaboration-soak', runtimeIdentity: runtimeAfter,
        ledger: await reference('board-soak-ledger.json'), runtime: await reference('board-soak-runtime.json')}, null, 2));
    }
    completed = true;
  } finally {
    if (!completed) {
      await writeFile(testInfo.outputPath('board-soak-partial.json'), JSON.stringify({status: 'failed-not-acceptance', sha, startedAt, finishedAt,
        elapsedMonotonicMs, samples, projectionEvidence, recoveries, transport: clients.flatMap(client => client.events),
        acknowledgements: clients.flatMap(client => client.acknowledgements)}, null, 2));
      await testInfo.attach('board-soak-partial', {path: testInfo.outputPath('board-soak-partial.json'), contentType: 'application/json'});
    }
    await Promise.all(contexts.map(context => context.close()));
    clients.forEach(client => client.destroy());
    try {if (boardId && ownerToken) await archiveAcceptanceBoard(request, ownerToken, boardId);}
    finally {await removeBoardSoakIdentities(actors);}
  }
});
