import {writeFile} from 'node:fs/promises';
import {cpus, totalmem, platform} from 'node:os';
import {resolve} from 'node:path';
import {expect, test, type CDPSession, type Page} from '@playwright/test';
import {BOARD_SYNCED_STATUS, archiveAcceptanceBoard, boardApi, boardLogin, canonicalRows, createAcceptanceBoard, objectPoint, openBoard, settled} from './board-acceptance-support';
import {browserNow, canonicalSnapshot, installBrowserMeasurements, markPhase, monotonicNow, observeBoardTransport, provisionDataset, recordFeedbackSince} from './board-performance-support';
import {observeRuntimeChunks, runtimeSourceIdentity, sha256, verifyRuntimeIdentity} from './board-runtime-evidence';
import {boardPerformancePolicy, validateBoardPerformanceArtifact} from '../scripts/board-performance-policy.mjs';
import {scrubSecrets} from './support/real-model-evidence';

const root = resolve(__dirname, '../../..');
test.describe.configure({mode: 'serial', timeout: 30 * 60_000});
async function ready(page: Page, count: number) {
  await expect(page.getByText(BOARD_SYNCED_STATUS)).toBeVisible({timeout: 120_000});
  await expect(page.getByTestId('board-a11y-mirror').locator('li[data-object-id]')).toHaveCount(count, {timeout: 120_000});
  await expect.poll(async () => JSON.parse(await page.getByTestId('board-fabric-surface').getAttribute('data-object-scenes') ?? '[]').length,
    {timeout: 120_000}).toBeGreaterThan(0);
  await expect(page.locator('[data-testid="board-fabric-surface"] canvas[data-fabric="top"]')).toBeVisible();
  await settled(page);
}
async function renderedVisible(page: Page) {
  return page.getByTestId('board-fabric-surface').evaluate(surface => {
    const host = surface as HTMLElement, box = host.getBoundingClientRect();
    const zoom = Number(host.dataset.viewportZoom), x = Number(host.dataset.viewportPanX), y = Number(host.dataset.viewportPanY);
    const scenes = JSON.parse(host.dataset.objectScenes ?? '[]') as Array<{left: number; top: number; width: number; height: number}>;
    return scenes.filter(value => value.left * zoom + x < box.width && (value.left + value.width) * zoom + x > 0
      && value.top * zoom + y < box.height && (value.top + value.height) * zoom + y > 0).length;
  });
}
async function stopTrace(cdp: CDPSession, path: string, secrets: string[]) {
  const complete = new Promise<{stream: string}>(resolve => cdp.once('Tracing.tracingComplete', value => resolve(value as {stream: string})));
  await cdp.send('Tracing.end'); const {stream} = await complete;
  const chunks: Buffer[] = [];
  while (true) {const value = await cdp.send('IO.read', {handle: stream}); chunks.push(Buffer.from(value.data, value.base64Encoded ? 'base64' : 'utf8')); if (value.eof) break;}
  await cdp.send('IO.close', {handle: stream});
  let text = scrubSecrets(Buffer.concat(chunks).toString('utf8'));
  for (const secret of secrets) if (secret) text = text.split(secret).join('[REDACTED_SESSION]');
  const trace = JSON.parse(text) as {traceEvents: unknown[]}; expect(trace.traceEvents.length).toBeGreaterThan(0);
  await writeFile(path, text); return {path, sha256: sha256(text), format: 'chrome-trace', events: trace.traceEvents.length};
}
for (const count of [1000, 5000, 10000]) test(`fabric ${count / 1000}k performance: real persisted mixed Board`, async ({browser, page: seed, request}) => {
  const sha = runtimeSourceIdentity(), policy = boardPerformancePolicy(root), token = await boardLogin(seed);
  const boardId = await createAcceptanceBoard(request, token, `Performance ${count}`);
  const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
  let traceSession: CDPSession | undefined, traceStopped = false;
  try {
    await openBoard(seed, boardId, 0);
    const png = await seed.evaluate(() => {const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48;
      const context = canvas.getContext('2d')!; context.fillStyle = '#F8D76E'; context.fillRect(0, 0, 64, 48); context.fillStyle = '#222222'; context.fillRect(8, 8, 32, 24); return canvas.toDataURL('image/png').split(',')[1]!;});
    await seed.getByTestId('board-image-input').setInputFiles({name: 'research-thumbnail.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64')});
    await expect.poll(async () => (await canonicalRows(seed)).filter(row => row.kind === 'image').length).toBe(1);
    await expect(seed.getByTestId('board-a11y-mirror').getByRole('button')).toHaveAttribute('aria-description', /图片已验证/, {timeout: 30_000});
    const image = (await canonicalSnapshot(request, token, boardId)).objects.find(value => value.kind === 'image')!;
    expect(image, 'A real uploaded canonical image is required').toBeTruthy();
    expect((image.extensionData?.contentObject as {persistence?: string})?.persistence,
      'Session-only image handles cannot be used as durable cold-render performance evidence').toBe('durable');
    const dataset = await provisionDataset(request, token, boardId, count, image);
    await seed.goto('/projects'); // The provisioning client must not contribute ongoing load.
    const storageState = await seed.context().storageState();
    const samples = {coldLoadMs: [] as number[], warmLoadMs: [] as number[], panFrameMs: [] as number[], zoomFrameMs: [] as number[],
      dragFrameMs: [] as number[], dragFeedbackMs: [] as number[], textFeedbackMs: [] as number[], selectionMs: [] as number[],
      layoutMs: [] as number[], convergenceMs: [] as number[], reconnectMs: [] as number[], heapBytes: [] as number[], renderedVisible: [] as number[]};
    let page: Page | undefined, cdp: CDPSession | undefined;
    let finishChunks: ReturnType<typeof observeRuntimeChunks> | undefined;
    const loadTraces: Awaited<ReturnType<typeof stopTrace>>[] = [];
    // Five independent cold contexts, each followed by its own warm reload; no best-of selection.
    for (let trial = 0; trial < 5; trial++) {
      const context = await browser.newContext({storageState, viewport: {width: 1440, height: 900}}); contexts.push(context);
      const current = await context.newPage(); await installBrowserMeasurements(current);
      const currentChunks = observeRuntimeChunks(current), session = await context.newCDPSession(current);
      await session.send('Network.enable');
      await session.send('Network.emulateNetworkConditions', {offline: false, latency: 100, downloadThroughput: 50_000_000 / 8, uploadThroughput: 50_000_000 / 8});
      await session.send('Network.setCacheDisabled', {cacheDisabled: true});
      traceSession = session; traceStopped = false;
      await session.send('Tracing.start', {categories: 'devtools.timeline,v8,blink.user_timing', transferMode: 'ReturnAsStream'});
      const started = monotonicNow(); await current.goto(`/studio/board/${boardId}`); await ready(current, count);
      samples.coldLoadMs.push(monotonicNow() - started); samples.renderedVisible.push(await renderedVisible(current));
      await session.send('Network.setCacheDisabled', {cacheDisabled: false});
      const warm = monotonicNow(); await current.reload(); await ready(current, count); samples.warmLoadMs.push(monotonicNow() - warm);
      loadTraces.push(await stopTrace(session, test.info().outputPath(`load-${trial}.trace.json`), [token])); traceStopped = true;
      if (trial < 4) {await currentChunks(); await context.close(); contexts.splice(contexts.indexOf(context), 1);}
      else {page = current; cdp = session; finishChunks = currentChunks;}
    }
    const active = page!, session = cdp!;
    // Cold-load network shaping is disabled for local interaction/same-host convergence measurements.
    await session.send('Network.emulateNetworkConditions', {offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1});
    await session.send('Performance.enable');
    const heap = async () => {const result = await session.send('Performance.getMetrics'); const value = result.metrics.find((entry: {name: string; value: number}) => entry.name === 'JSHeapUsedSize')?.value;
      expect(Number.isFinite(value)).toBe(true); if (value === undefined) throw new Error('HEAP_METRIC_UNAVAILABLE'); samples.heapBytes.push(value);};
    await heap();
    traceSession = session; traceStopped = false;
    await session.send('Tracing.start', {categories: 'devtools.timeline,v8,blink.user_timing', transferMode: 'ReturnAsStream'});
    const transport = observeBoardTransport(active, boardId);
    // Reload after attaching the passive WS observer so this connection's ACKs and bytes are all accounted for.
    await active.reload(); await ready(active, count);
    const peerContext = await browser.newContext({storageState, viewport: {width: 1440, height: 900}}); contexts.push(peerContext);
    const peer = await peerContext.newPage(); await openBoard(peer, boardId, count);
    await expect.poll(() => canonicalRows(peer), {timeout: 120_000}).toEqual(await canonicalRows(active));
    const imageRows = active.getByTestId('board-a11y-mirror').locator('li[data-object-kind="image"] button');
    for (const button of await imageRows.all()) await expect(button).toHaveAttribute('aria-description', /图片已验证/);
    for (const button of await peer.getByTestId('board-a11y-mirror').locator('li[data-object-kind="image"] button').all()) await expect(button).toHaveAttribute('aria-description', /图片已验证/);
    // Pan and zoom collect actual requestAnimationFrame intervals while input is delivered.
    await active.getByTestId('board-tool-hand').click(); await markPhase(active, 'pan');
    for (let gesture = 0; gesture < 4; gesture++) {
      await active.mouse.move(500, 400); await active.mouse.down();
      for (let step = 1; step <= 20; step++) {await active.mouse.move(500 + (gesture % 2 ? -1 : 1) * step * 4, 400); await settled(active);}
      await active.mouse.up(); await heap();
    }
    await markPhase(active, 'zoom'); await active.mouse.move(650, 420);
    for (let index = 0; index < 20; index++) {await active.mouse.wheel(0, index < 10 ? -20 : 20); await settled(active);}
    await markPhase(active, 'idle'); await active.getByTestId('board-tool-select').click();
    const stickyId = 'perf-00000';
    // Selection publishes through React before Fabric can safely measure a slow,
    // frame-spanning transform.  Keep that state transition outside the measured
    // gesture: otherwise the first drag only selects the object and its canonical
    // geometry correctly remains unchanged.
    const selectionPoint = await objectPoint(active, stickyId);
    await active.mouse.click(selectionPoint.x, selectionPoint.y);
    await expect(active.getByTestId('board-a11y-selection-announcement')).toHaveText('已选择 1 个对象');
    await settled(active);
    // Every measured gesture must mutate the canonical object, not just animate an empty viewport.
    for (let index = 0; index < 10; index++) {
      const point = await objectPoint(active, stickyId), before = (await canonicalRows(active)).find(row => row.id === stickyId)!;
      await markPhase(active, 'drag');
      await active.mouse.move(point.x, point.y); await active.mouse.down();
      // Move back and forth so ten measurements do not push the note through
      // neighbouring dataset objects or outside the original hot viewport.
      const direction = index % 2 === 0 ? 1 : -1;
      for (let step = 1; step <= 8; step++) {await active.mouse.move(point.x + direction * step * 3, point.y + direction * step * 2); await settled(active);}
      const feedbackStarted = await browserNow(active);
      await active.mouse.up();
      await expect.poll(async () => (await canonicalRows(active)).find(row => row.id === stickyId)?.geometry).not.toEqual(before.geometry);
      await settled(active); await recordFeedbackSince(active, 'drag', feedbackStarted); await markPhase(active, 'idle');
      await expect.poll(() => active.evaluate(() => window.__boardPerformance.feedback.drag?.length ?? 0)).toBe(index + 1);
      await heap();
    }
    // Enter edit mode with a real double click; measure input-to-canonical-and-paint separately from network convergence.
    const point = await objectPoint(active, stickyId); await active.mouse.dblclick(point.x, point.y);
    const editor = active.getByLabel('对象文字', {exact: true}); await expect(editor).toBeFocused();
    for (let index = 0; index < 20; index++) {
      const text = `Measured idea ${index}`, feedbackStarted = await browserNow(active), started = monotonicNow();
      await editor.fill(text);
      await expect.poll(async () => active.getByTestId(`board-a11y-object-${stickyId}`).textContent()).toBe(text);
      await settled(active); await recordFeedbackSince(active, 'text', feedbackStarted);
      await expect.poll(async () => peer.getByTestId(`board-a11y-object-${stickyId}`).textContent(), {intervals: [10], timeout: 30_000}).toBe(text);
      samples.convergenceMs.push(monotonicNow() - started);
      await expect.poll(() => active.evaluate(() => window.__boardPerformance.feedback.text?.length ?? 0)).toBe(index + 1);
    }
    await editor.press('Escape'); await active.getByTestId('board-tool-select').click();
    for (let index = 0; index < 5; index++) {
      await active.keyboard.press('Escape'); const start = monotonicNow();
      // Exercise Fabric's production ActiveSelection path. Rapid Shift-clicks can
      // be overtaken by the canonical React projection at this dataset size,
      // whereas marquee is the user-visible atomic multi-select gesture.
      const first = await objectPoint(active, 'perf-00000'), third = await objectPoint(active, 'perf-00002');
      await active.mouse.move(first.x - 100, first.y - 100); await active.mouse.down();
      await active.mouse.move(third.x + 100, third.y + 100, {steps: 12}); await active.mouse.up();
      // Fabric includes objects intersecting the marquee edge, so the exact
      // count is intentionally renderer-defined; the contract under load is a
      // real multi-selection that exposes and executes the layout action.
      await expect(active.getByTestId('board-a11y-selection-announcement')).toHaveText(/^已选择 [2-9]\d* 个对象$/); samples.selectionMs.push(monotonicNow() - start);
      const before = await canonicalRows(active), layoutStart = monotonicNow(); await active.getByTestId('board-layout-quick-grid').click();
      await expect.poll(() => canonicalRows(active)).not.toEqual(before); await settled(active); samples.layoutMs.push(monotonicNow() - layoutStart);
      await active.getByRole('button', {name: '撤销', exact: true}).click(); await expect.poll(() => canonicalRows(active)).toEqual(before);
    }
    const peerTextBeforeOffline = await peer.getByTestId(`board-a11y-object-${stickyId}`).textContent();
    await peerContext.setOffline(true);
    const p = await objectPoint(active, stickyId); await active.mouse.dblclick(p.x, p.y);
    await editor.fill('Recovered real dataset'); await editor.press('Escape');
    await expect(peer.getByTestId(`board-a11y-object-${stickyId}`)).toHaveText(peerTextBeforeOffline!);
    const reconnectStarted = monotonicNow(); await peerContext.setOffline(false);
    await expect.poll(() => canonicalRows(peer), {timeout: 30_000, intervals: [25]}).toEqual(await canonicalRows(active));
    samples.reconnectMs.push(monotonicNow() - reconnectStarted);
    const beforeReload = await canonicalRows(active), browserMeasurements = await active.evaluate(() => window.__boardPerformance);
    expect(browserMeasurements.longTaskSupported).toBe(true);
    samples.panFrameMs = browserMeasurements.frames.pan ?? []; samples.zoomFrameMs = browserMeasurements.frames.zoom ?? []; samples.dragFrameMs = browserMeasurements.frames.drag ?? [];
    samples.dragFeedbackMs = browserMeasurements.feedback.drag ?? []; samples.textFeedbackMs = browserMeasurements.feedback.text ?? [];
    expect(samples.dragFeedbackMs).toHaveLength(10); expect(samples.textFeedbackMs).toHaveLength(20);
    for (const frames of [samples.panFrameMs, samples.zoomFrameMs, samples.dragFrameMs]) expect(frames.length).toBeGreaterThanOrEqual(20);
    await active.reload(); await ready(active, count); await expect.poll(() => canonicalRows(active)).toEqual(beforeReload);
    for (const button of await active.getByTestId('board-a11y-mirror').locator('li[data-object-kind="image"] button').all()) await expect(button).toHaveAttribute('aria-description', /图片已验证/);
    await expect.poll(() => transport.pendingAtEnd).toBe(0);
    await session.send('HeapProfiler.collectGarbage'); await heap();
    const finalSnapshot = await canonicalSnapshot(request, token, boardId); expect(finalSnapshot.objects).toHaveLength(count);
    expect(finalSnapshot.objects.find(value => value.id === stickyId)?.text).toBe('Recovered real dataset');
    const trace = await stopTrace(session, test.info().outputPath('browser-performance.trace.json'), [token]); traceStopped = true;
    const runtimeIdentity = await verifyRuntimeIdentity(request, sha, await finishChunks!());
    const report = {version: 1, objectCount: count, apiObjectCount: dataset.snapshot.objects.length, datasetHash: dataset.datasetHash,
      kindCounts: dataset.kindCounts, runtimeIdentity, samples, retainedHeapBytes: samples.heapBytes.at(-1), longTasks: browserMeasurements.longTasks,
      transport, peerConverged: true, reloadConverged: true, durableImagesVerified: true, trace, loadTraces,
      environment: {platform: platform(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryBytes: totalmem(), browser: 'chromium',
        viewport: {width: 1440, height: 900}, coldNetwork: {megabitsPerSecond: 50, rttMs: 100}},
      measurementDefinitions: {dragFeedbackMs: 'immediately before pointerup dispatch -> canonical DOM mutation -> two animation frames (upper bound)',
        textFeedbackMs: 'immediately before fill dispatch -> canonical DOM mutation -> two animation frames (upper bound)', renderedVisible: 'projected scene bounds intersecting viewport; not proof of culling',
        heapBytes: 'CDP JSHeapUsedSize samples; sampled peak, not continuous heap maximum', reconnectMs: 'two-client offline catch-up; not the 60s/100-edit reliability soak'},
      policy};
    const validation = validateBoardPerformanceArtifact(report, policy, sha, count);
    const reportPath = test.info().outputPath(`performance-${count}.json`); await writeFile(reportPath, JSON.stringify({...report, validation}, null, 2));
    if (process.env.BOARD_PERFORMANCE_REPORT_PATH) await writeFile(process.env.BOARD_PERFORMANCE_REPORT_PATH, JSON.stringify({...report, validation}, null, 2));
    await test.info().attach(`performance-${count}`, {path: reportPath, contentType: 'application/json'});
    await test.info().attach('browser-performance-trace', {path: trace.path, contentType: 'application/json'});
    expect(validation.failures).toEqual([]);
  } finally {
    if (traceSession && !traceStopped) {try {await stopTrace(traceSession, test.info().outputPath('failed-performance.trace.json'), [token]);} catch { /* Original failure stays visible; absent trace never passes validation. */ }}
    await Promise.all(contexts.map(context => context.close()));
    await archiveAcceptanceBoard(request, token, boardId);
  }
});
