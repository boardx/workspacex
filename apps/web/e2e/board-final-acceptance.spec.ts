import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {test,assertJourneyReload} from './board-journey-evidence';
import type {WhiteboardCommand} from '@repo/whiteboard-core';
import {FULLSTACK_E2E} from './fullstack-smoke-fixture';
import {archiveAcceptanceBoard, boardApi, boardHead, boardLogin, canonicalRows,
  connectByHandles, connectorsBound, createAcceptanceBoard, createCommands, dragObject,
  gridValid, object, openBoard, operate, provenance, selectAll} from './board-acceptance-support';

test.describe.configure({timeout: 240_000});
const panelMetadata = {version: 1, mode: 'freeform', autoExpand: true, clipContent: false,
  padding: 24, gap: 24, columns: 3, flowDirection: 'horizontal'};
async function metric(name: string, value: number, limit: number) {
  await test.info().attach(name, {body: JSON.stringify({name, observed: value, limit}), contentType: 'application/json'});
}

test('Brainstorm: double-click then 20 ideas by Tab; first <5s and first 10 <30s', async ({page, request}) => {
  const token = await boardLogin(page), id = await createAcceptanceBoard(request, token, 'Acceptance brainstorm');
  try {
    await openBoard(page, id, 0);
    const started = Date.now();
    await page.getByTestId('board-fabric-surface').dblclick({position: {x: 420, y: 280}});
    const editor = page.getByLabel('对象文字', {exact: true});
    await expect(editor).toBeFocused();
    await page.keyboard.type('Idea 01');
    await expect.poll(async () => (await canonicalRows(page)).map(row => row.text)).toEqual(['Idea 01']);
    const ttfi = Date.now() - started; await metric('ttfi-ms', ttfi, 5000); expect(ttfi).toBeLessThan(5000);
    for (let index = 2; index <= 20; index++) {
      await page.keyboard.press('Tab'); await expect(editor).toBeFocused();
      await page.keyboard.type(`Idea ${String(index).padStart(2, '0')}`);
      if (index === 10) {
        await expect.poll(async () => (await canonicalRows(page)).filter(row => /^Idea \d{2}$/.test(row.text)).length).toBe(10);
        const elapsed = Date.now() - started; await metric('ten-stickies-ms', elapsed, 30000); expect(elapsed).toBeLessThan(30000);
      }
    }
    await page.keyboard.press('Escape');
    const rows = await canonicalRows(page);
    expect(rows).toHaveLength(20); expect(rows.every(row => row.kind === 'sticky')).toBe(true);
    expect(rows.map(row => row.text).sort()).toEqual(Array.from({length: 20}, (_, i) => `Idea ${String(i + 1).padStart(2, '0')}`));
    await test.info().attach('brainstorm-20', {body: await page.screenshot(), contentType: 'image/png'});
    await assertJourneyReload(page, id, rows, request, token);
  } finally { await archiveAcceptanceBoard(request, token, id); }
});

test('Organize: 20 scattered stickies -> equal-gap grid in <=2 actions', async ({page, request}) => {
  const token = await boardLogin(page), id = await createAcceptanceBoard(request, token, 'Acceptance organize');
  try {
    const notes = Array.from({length: 20}, (_, index) => object(`grid-${index}`, 'sticky', 100 + index % 5 * 230 + index * 3, 150 + Math.floor(index / 5) * 220 + index % 3 * 17));
    await operate(request, token, id, createCommands(notes)); await openBoard(page, id, 20);
    const before = await canonicalRows(page); expect(gridValid(before)).toBe(false);
    await selectAll(page, 20);
    let actions = 0; await page.getByTestId('board-layout-quick-grid').click(); actions++;
    await expect.poll(async () => gridValid(await canonicalRows(page))).toBe(true);
    const after = await canonicalRows(page);
    expect(after.map(row => row.id)).toEqual(before.map(row => row.id));
    for (const row of after) expect(row.geometry).toMatchObject({width: 180, height: 180, rotation: 0});
    await metric('organize-actions-after-selection', actions, 2); expect(actions).toBeLessThanOrEqual(2);
    await page.getByRole('button', {name: '撤销', exact: true}).click();
    await expect.poll(() => canonicalRows(page)).toEqual(before);
    await page.getByRole('button', {name: '重做', exact: true}).click();
    await expect.poll(() => canonicalRows(page)).toEqual(after);
    await assertJourneyReload(page, id, after, request, token);
  } finally { await archiveAcceptanceBoard(request, token, id); }
});

test('Panel: drag 10 unparented objects inside, then move the whole container', async ({page, request}) => {
  const token = await boardLogin(page), id = await createAcceptanceBoard(request, token, 'Acceptance panel');
  try {
    const panel = {...object('research-panel', 'frame', 100, 120, 'Customer research', 1100, 550), extensionData: {spatial: panelMetadata}};
    const notes = Array.from({length: 10}, (_, index) => object(`child-${index}`, 'sticky', 1350 + index % 2 * 210, 150 + Math.floor(index / 2) * 210));
    await operate(request, token, id, createCommands([panel, ...notes])); await openBoard(page, id, 11);
    expect((await canonicalRows(page)).filter(row => row.id.startsWith('child-')).every(row => row.parentId === '')).toBe(true);
    for (let index = 0; index < 10; index++) {
      const source = (await canonicalRows(page)).find(row => row.id === `child-${index}`)!;
      const target = {x: 140 + index % 5 * 210, y: 190 + Math.floor(index / 5) * 210};
      await dragObject(page, source.id, target.x - source.geometry.x, target.y - source.geometry.y, false, panel.id);
    }
    const before = await canonicalRows(page);
    const expandedPanel = before.find(row => row.id === panel.id)!;
    for (const child of before.filter(row => row.parentId === panel.id)) {
      expect(child.geometry.x).toBeGreaterThanOrEqual(expandedPanel.geometry.x - 1);
      expect(child.geometry.y).toBeGreaterThanOrEqual(expandedPanel.geometry.y - 1);
      expect(child.geometry.x + child.geometry.width).toBeLessThanOrEqual(expandedPanel.geometry.x + expandedPanel.geometry.width + 1);
      expect(child.geometry.y + child.geometry.height).toBeLessThanOrEqual(expandedPanel.geometry.y + expandedPanel.geometry.height + 1);
    }
    await dragObject(page, panel.id, 80, 60, true);
    const after = await canonicalRows(page);
    const priorPanel = before.find(row => row.id === panel.id)!;
    const nextPanel = after.find(row => row.id === panel.id)!;
    const panelDelta = {x: nextPanel.geometry.x - priorPanel.geometry.x, y: nextPanel.geometry.y - priorPanel.geometry.y};
    expect(Math.abs(panelDelta.x)).toBeGreaterThan(1);
    expect(Math.abs(panelDelta.y)).toBeGreaterThan(1);
    for (const prior of before) {
      const next = after.find(row => row.id === prior.id)!;
      expect(Math.abs(next.geometry.x - prior.geometry.x - panelDelta.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(next.geometry.y - prior.geometry.y - panelDelta.y)).toBeLessThanOrEqual(1);
      expect(next.geometry).toMatchObject({width: prior.geometry.width, height: prior.geometry.height, rotation: prior.geometry.rotation});
      if (next.id !== panel.id) expect(next.parentId).toBe(panel.id);
    }
    await assertJourneyReload(page, id, after, request, token);
  } finally { await archiveAcceptanceBoard(request, token, id); }
});

test('Diagram: A->B->C via two-click connections remain attached after each shape moves', async ({page, request}) => {
  const token = await boardLogin(page), id = await createAcceptanceBoard(request, token, 'Acceptance diagram');
  try {
    const shapes = ['A', 'B', 'C'].map((name, index) => object(name, 'rectangle', 150 + index * 360, 300, name, 200, 140));
    await operate(request, token, id, createCommands(shapes)); await openBoard(page, id, 3);
    const clicks = [await connectByHandles(page, 'A', 'B'), await connectByHandles(page, 'B', 'C')];
    await metric('connection-clicks-per-edge', Math.max(...clicks), 2);
    expect(clicks.every(count => count <= 2)).toBe(true);
    let rows = await canonicalRows(page);
    expect(rows.filter(row => row.kind === 'connector')).toHaveLength(2); expect(connectorsBound(rows)).toBe(true);
    for (const name of ['A', 'B', 'C']) {
      const before = rows.filter(row => row.kind === 'connector');
      await dragObject(page, name, 24, 90);
      rows = await canonicalRows(page); expect(connectorsBound(rows)).toBe(true);
      expect(rows.filter(row => row.kind === 'connector')).not.toEqual(before);
      expect(rows.filter(row => row.kind === 'connector').map(row => [row.from, row.to]).sort()).toEqual([['A', 'B'], ['B', 'C']]);
    }
    await assertJourneyReload(page, id, rows, request, token);
  } finally { await archiveAcceptanceBoard(request, token, id); }
});

test('Visual Research: valid screenshot in one paste mixed with Sticky/Text/Arrow/Tile', async ({page, request}) => {
  const token = await boardLogin(page), id = await createAcceptanceBoard(request, token, 'Acceptance visual research');
  try {
    await openBoard(page, id, 0);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48;
      const context = canvas.getContext('2d')!; context.fillStyle = '#f8d76e'; context.fillRect(0, 0, 64, 48);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG encoding failed')), 'image/png'));
      const bitmap = await createImageBitmap(blob);
      if (bitmap.width !== 64 || bitmap.height !== 48) throw new Error('Invalid screenshot fixture'); bitmap.close();
      await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
    });
    await page.getByTestId('board-tool-select').focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
    await expect.poll(async () => (await canonicalRows(page)).filter(row => row.kind === 'image').length).toBe(1);
    const image = (await canonicalRows(page)).find(row => row.kind === 'image')!;
    await expect(page.getByTestId(`board-a11y-object-${image.id}`)).toHaveAttribute('aria-description', /图片已验证/, {timeout: 30_000});
    await metric('screenshot-paste-actions', 1, 1);
    await page.keyboard.press('n'); await page.getByLabel('对象文字', {exact: true}).fill('Research insight'); await page.keyboard.press('Escape');
    await page.getByTestId('board-tool-select').focus();
    await page.keyboard.press('t'); await page.getByLabel('对象文字', {exact: true}).fill('Interview summary'); await page.keyboard.press('Escape');
    await page.getByTestId('board-add-more').click(); await page.getByTestId('board-content-tile').click();
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await canonicalRows(page)).filter(row => row.kind === 'card').length).toBe(1);
    const before = await canonicalRows(page), content = before.filter(row => row.kind !== 'connector');
    expect(new Set(content.map(row => row.kind))).toEqual(new Set(['image', 'sticky', 'text', 'card']));
    await selectAll(page, 4); await page.getByTestId('board-layout-quick-grid').click();
    const contentIds = new Set(content.map(row => row.id));
    await expect.poll(async () => {
      const scenes = JSON.parse((await page.getByTestId('board-fabric-surface').getAttribute('data-object-scenes')) ?? '[]') as Array<{id: string; left: number; top: number; width: number; height: number}>;
      const arranged = scenes.filter(scene => contentIds.has(scene.id));
      if (arranged.length !== contentIds.size) return false;
      return arranged.every((a, index) => arranged.slice(index + 1).every(b =>
        a.left + a.width <= b.left + 1 || b.left + b.width <= a.left + 1
        || a.top + a.height <= b.top + 1 || b.top + b.height <= a.top + 1));
    }).toBe(true);
    const sticky = content.find(row => row.kind === 'sticky')!, tile = content.find(row => row.kind === 'card')!;
    await connectByHandles(page, sticky.id, tile.id);
    const mixed = await canonicalRows(page);
    expect(mixed).toHaveLength(5); expect(connectorsBound(mixed)).toBe(true);
    expect(mixed.find(row => row.kind === 'text')?.text).toBe('Interview summary');
    await assertJourneyReload(page, id, mixed, request, token);
    await expect(page.getByTestId(`board-a11y-object-${image.id}`)).toHaveAttribute('aria-description', /图片已验证/, {timeout: 30_000});
  } finally { await archiveAcceptanceBoard(request, token, id); }
});

// This requires the R9 delegated Agent API. No API capability is substituted by DOM observations.
test('AI Ready API: delegated CRUD + pre-generated 30-note proposal transaction (not model clustering)', async ({page, request}) => {
  const token = await boardLogin(page), id = await createAcceptanceBoard(request, token, 'Acceptance AI');
  try {
    const notes = Array.from({length: 30}, (_, index) => object(`ai-note-${index}`, 'sticky', 100 + index % 6 * 230, 100 + Math.floor(index / 6) * 220, `Theme ${index % 3}: idea ${index}`));
    await operate(request, token, id, createCommands(notes), true); await openBoard(page, id, 30);
    await operate(request, token, id, [{type: 'text', id: notes[0]!.id, index: 0, deleteCount: notes[0]!.text.length, insert: 'Updated agent idea'},
      {type: 'geometry', id: notes[0]!.id, geometry: {...notes[0]!.geometry, x: 340, y: 520}}], true);
    await expect.poll(async () => (await canonicalRows(page)).find(row => row.id === notes[0]!.id)).toMatchObject({text: 'Updated agent idea', geometry: {x: 340, y: 520}});
    const arranged = notes.map((note, index) => ({type: 'geometry' as const, id: note.id, geometry: {...note.geometry, x: 100 + index % 5 * 204, y: 100 + Math.floor(index / 5) * 204}}));
    await operate(request, token, id, arranged, true);
    await expect.poll(async () => gridValid(await canonicalRows(page), 5)).toBe(true);
    const edge = {...object('agent-edge', 'connector', 0, 0, '', 1, 1), connector: {from: notes[0]!.id, to: notes[1]!.id, fromAnchor: 'right' as const, toAnchor: 'left' as const, type: 'straight' as const, endStyle: 'arrow' as const}};
    await operate(request, token, id, createCommands([edge]), true);
    await expect.poll(async () => (await canonicalRows(page)).filter(row => row.kind === 'connector').length).toBe(1);
    expect(connectorsBound(await canonicalRows(page))).toBe(true);
    await operate(request, token, id, [{type: 'delete', id: edge.id}], true);
    await expect.poll(async () => (await canonicalRows(page)).length).toBe(30);

    const beforeProposal = await canonicalRows(page), proposalId = randomUUID();
    const panels = ['Onboarding', 'Performance', 'Pricing'].map((label, index) => ({...object(`cluster-${index}`, 'frame', 100 + index * 760, 100, label, 700, 1000), extensionData: {spatial: panelMetadata}}));
    const commands: WhiteboardCommand[] = [...createCommands(panels)];
    for (let index = 0; index < 30; index++) {
      const group = index % 3, position = Math.floor(index / 3);
      commands.push({type: 'parent', id: notes[index]!.id, parentId: panels[group]!.id, orderKey: String(position).padStart(3, '0')},
        {type: 'geometry', id: notes[index]!.id, geometry: {...notes[index]!.geometry, x: panels[group]!.geometry.x + 24 + position % 3 * 204, y: 160 + Math.floor(position / 3) * 204}});
    }
    const created = await boardApi(request, token, 'POST', `/v1/whiteboards/${id}/ai-proposals`, {
      proposalId, actorId: FULLSTACK_E2E.agentId, baseRevision: await boardHead(request, token, id),
      action: {type: 'cluster', objectIds: notes.map(note => note.id), labels: panels.map(panel => panel.text), commands}, provenance: provenance('ai-proposal'),
    });
    expect((await created.json() as {status: string}).status).toBe('preview');
    expect(await canonicalRows(page)).toEqual(beforeProposal);
    await page.goto(`/studio/board/${id}?proposal=${proposalId}`);
    await expect(page.getByTestId('board-ai-proposal')).toBeVisible();
    await expect(page.getByTestId('board-a11y-mirror').locator('li[data-object-id]')).toHaveCount(beforeProposal.length);
    expect(await canonicalRows(page)).toEqual(beforeProposal);
    const confirmation = page.waitForResponse(response => response.request().method() === 'POST'
      && response.url().endsWith(`/v1/whiteboards/${id}/ai-proposals/${proposalId}/confirm`));
    await page.getByTestId('board-ai-confirm').click();
    const confirmationResponse = await confirmation; expect(confirmationResponse.ok()).toBe(true);
    const confirmed = await confirmationResponse.json() as {undoReceipt: {commands: WhiteboardCommand[]}};
    expect(confirmed.undoReceipt.commands.length).toBeGreaterThan(0);
    await expect(page.getByTestId('board-ai-proposal')).toHaveCount(0);
    await expect.poll(async () => (await canonicalRows(page)).length).toBe(33);
    const clustered = await canonicalRows(page);
    for (let group = 0; group < 3; group++) {
      const children = clustered.filter(row => row.parentId === `cluster-${group}`);
      expect(children).toHaveLength(10); expect(gridValid(children)).toBe(true);
      expect(children.every(row => Number(row.id.replace('ai-note-', '')) % 3 === group)).toBe(true);
      expect(clustered.find(row => row.id === `cluster-${group}`)?.text).toBe(panels[group]!.text);
    }
    await metric('prepared-proposal-confirm-actions', 1, 2);
    // This measures confirmation only, NOT the PRD's complete <=2-action AI Organize journey.
    // Real model reading 30 texts, semantic theme inference/naming and proposal generation
    // remain a separate UNVERIFIED requirement; this deterministic fixture cannot satisfy it.
    await test.info().attach('ai-organize-coverage-boundary', {body: JSON.stringify({
      verifiedScope: 'pre-generated proposal confirmation and delegated API transactions',
      unverifiedRequirements: ['real-model text reading', 'semantic theme inference', 'cluster naming', 'end-to-end AI Organize <=2 actions'],
    }), contentType: 'application/json'});
    await assertJourneyReload(page, id, clustered, request, token);
    const events = await (await boardApi(request, token, 'GET', `/v1/whiteboards/${id}/events?afterSeq=0&limit=100`)).json() as {events: Array<{type: string; actor: {kind: string; actorId: string}}>};
    expect(events.events.some(event => event.type === 'AIOrganized' && event.actor.kind === 'ai' && event.actor.actorId === FULLSTACK_E2E.agentId)).toBe(true);

    // Agent Read uses the R9 ACL-bound snapshot API, never a DOM substitute.
    const read = await boardApi(request, token, 'GET', `/v1/whiteboards/${id}/objects?actorId=${encodeURIComponent(FULLSTACK_E2E.agentId)}`);
    const snapshot = await read.json() as {boardId: string; revision: {epoch: number; seq: number}; role: string; archived: boolean; objects: Array<{id: string; text: string; parentId: string | null}>};
    expect(snapshot.boardId).toBe(id); expect(snapshot.role).toBe('owner'); expect(snapshot.archived).toBe(false); expect(snapshot.revision).toEqual(await boardHead(request, token, id));
    expect(snapshot.objects).toHaveLength(33);
    expect(snapshot.objects.find(value => value.id === 'ai-note-0')).toMatchObject({text: 'Updated agent idea', parentId: 'cluster-0'});
    // Execute the server-issued inverse as one operation. This proves receipt-based
    // API undo, not a claim that the editor's Undo button is already wired to it.
    await operate(request, token, id, confirmed.undoReceipt.commands);
    await expect.poll(() => canonicalRows(page)).toEqual(beforeProposal);
    await assertJourneyReload(page, id, beforeProposal, request, token);
  } finally { await archiveAcceptanceBoard(request, token, id); }
});
// Performance belongs to its dedicated real-browser lanes. No fabricated report DOM or fixture-only benchmark here.
