import { expect, test, type Page, type TestInfo, type Locator } from '@playwright/test';
import { archiveAcceptanceBoard, boardLogin, canonicalBoardSnapshot, createAcceptanceBoard, createCommands, object, openBoard, operate, selectAll, objectPoint } from './board-acceptance-support';
import { expectBoardSynced } from './support/board-sync-status';
import { compactBlankPoints } from './support/board-compact-blank';
import { WhiteboardObject } from '@repo/whiteboard-core';

const viewports = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }] as const;
async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}
async function withinViewport(locator: Locator, width: number) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
}
async function selectNote(page: Page, id = 'feedback-note-a') {
  await page.keyboard.press('Escape');
  await page.getByTestId('board-tool-select').click();
  const point = await objectPoint(page, id);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId(`board-a11y-object-${id}`)).toHaveAttribute('aria-pressed', 'true');
}

for (const viewport of viewports) {
  test.describe(`Board feedback ${viewport.width}px`, () => {
    test.use({ viewport });
    let token: string, boardId: string;
    test.beforeEach(async ({ page, request }) => {
      token = await boardLogin(page);
      boardId = await createAcceptanceBoard(request, token, `Feedback acceptance ${viewport.width}`);
      const a = object('feedback-note-a', 'sticky', 100, 100, '中文 English', 180, 180);
      a.style = { fill: '#C6DDFF', fontSize: 20 };
      const b = object('feedback-note-b', 'sticky', 340, 140, 'Second', 180, 180);
      const c = object('feedback-note-c', 'sticky', 600, 120, 'Third', 180, 180);
      await operate(request, token, boardId, createCommands([a, b, c]));
      await openBoard(page, boardId, 3);
      await page.getByTestId('board-zoom-fit-board').click();
    });
    test.afterEach(async ({ request }) => { if (boardId) await archiveAcceptanceBoard(request, token, boardId); });

    test('01–04 minimap appears, locates by pointer/keyboard and preserves document', async ({ page, request }, info) => {
      const baseline = await canonicalBoardSnapshot(request, token, boardId);
      await page.getByTestId('board-overview-fit').click();
      const map = page.getByTestId('board-minimap');
      await expect(map).toBeVisible();
      await expect(page.getByTestId('board-overview-fit')).toHaveAttribute('aria-expanded', 'true');
      await withinViewport(map, viewport.width);
      await expect(map.locator('rect')).toHaveCount(4);
      const surface = page.getByTestId('board-fabric-surface');
      const before = await surface.getAttribute('data-viewport-pan-x');
      const box = (await map.boundingBox())!;
      await page.mouse.click(box.x + box.width * .85, box.y + box.height * .5);
      await expect(surface).not.toHaveAttribute('data-viewport-pan-x', before!);
      const afterPointer = await surface.getAttribute('data-viewport-pan-x');
      await map.focus(); await page.keyboard.press('ArrowLeft');
      await expect.poll(async () => Number(await surface.getAttribute('data-viewport-pan-x'))).toBe(Number(afterPointer) + 80);
      await screenshot(page, info, 'minimap-real-viewport');
      await page.getByTestId('board-overview-fit').click();
      await expect(map).toBeHidden();
      expect(await canonicalBoardSnapshot(request, token, boardId)).toEqual(baseline);
    });

    test('05–08 upward submenu, compact instruments, five colors and custom ink', async ({ page }, info) => {
      const trigger = page.getByTestId('board-add-draw');
      const arrow = page.getByTestId('board-add-draw-submenu');
      await expect(arrow).toHaveAttribute('data-state', 'closed');
      await expect(arrow).not.toHaveClass(/rotate-180/);
      await trigger.click();
      await expect(arrow).toHaveAttribute('data-state', 'open');
      await expect(arrow).toHaveClass(/rotate-180/);
      const panel = page.getByTestId('board-draw-tool-panel');
      await expect(panel).toBeVisible(); await withinViewport(panel, viewport.width);
      const instruments = ['pen', 'marker', 'pencil', 'highlighter', 'eraser'];
      const positions = [];
      for (const instrument of instruments) {
        const button = panel.getByTestId(`board-draw-${instrument}`);
        positions.push((await button.boundingBox())!.y);
        await expect(panel.getByTestId(`board-draw-preview-${instrument}`)).toHaveCount(0);
      }
      expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(2);
      await expect(panel.getByRole('button', { name: /^Color #/ })).toHaveCount(5);
      await panel.getByTestId('board-draw-pencil').click();
      await panel.getByTestId('board-draw-color-2563eb').click();
      await expect(panel.getByTestId('board-draw-color-2563eb')).toHaveAttribute('aria-pressed', 'true');
      // This exercises the browser's input event path, rather than calling editor state.
      await panel.getByTestId('board-draw-color-custom').fill('#abcdef');
      await expect(panel.getByTestId('board-draw-color-custom')).toHaveValue('#abcdef');
      const stroke = (await panel.getByTestId('board-draw-stroke-3').boundingBox())!;
      const color = (await panel.getByTestId('board-draw-color-18181b').boundingBox())!;
      expect(Math.abs(stroke.y + stroke.height / 2 - color.y - color.height / 2)).toBeLessThan(2);
      await screenshot(page, info, 'compact-draw-palette');
      await panel.getByRole('button', { name: 'Close draw tools' }).click();
      await expect(arrow).toHaveAttribute('data-state', 'closed');
    });

    test('09–11 layout categories and native alignment persist after reload', async ({ page, request }, info) => {
      await selectAll(page, 3);
      await page.getByTestId('board-inspector-layout').click();
      const panel = page.getByTestId('board-tool-popover');
      await withinViewport(panel, viewport.width);
      await expect(page.getByTestId('board-layout-tab-align')).toBeVisible();
      await page.getByTestId('board-layout-tab-arrange').click();
      await expect(page.getByTestId('board-layout-grid')).toBeVisible();
      await page.getByTestId('board-layout-tab-smart').click();
      for (const kind of ['grid', 'cards', 'cluster', 'journey', 'mind-map', 'flow', 'timeline']) {
        await expect(page.getByTestId(`board-smart-${kind}`).locator('svg')).toBeVisible();
      }
      await screenshot(page, info, 'layout-smart-thumbnails');
      await page.getByTestId('board-layout-tab-align').click();
      await page.getByTestId('board-layout-align-left').click();
      await expectBoardSynced(page);
      await expect.poll(async () => new Set((await canonicalBoardSnapshot(request, token, boardId)).objects.map(item => Math.round(item.geometry.x))).size).toBe(1);
      const aligned = await canonicalBoardSnapshot(request, token, boardId);
      await page.reload(); await expectBoardSynced(page);
      expect(await canonicalBoardSnapshot(request, token, boardId)).toEqual(aligned);
    });

    test('12–14 shape categories have icon-only cells and database paints a complete cylinder', async ({ page, request }, info) => {
      await page.getByTestId('board-add-shape').click();
      const picker = page.getByTestId('board-shape-picker');
      await expect(picker).toBeVisible();
      await withinViewport(page.getByTestId('board-tool-picker'), viewport.width);
      await expect(picker.getByRole('tab')).toHaveCount(3);
      await picker.getByRole('tab', { name: '流程', exact: true }).click();
      await expect(picker.getByTestId('board-shape-predefined-process')).toBeVisible();
      await picker.getByRole('tab', { name: '资料', exact: true }).click();
      const database = picker.getByTestId('board-shape-database');
      await expect(database).toHaveText('');
      await expect(database.locator('svg')).toBeVisible();
      await database.click();
      // Close the picker while keeping the database creation tool selected.
      await page.getByTestId('board-add-shape').click();
      const surface = page.getByTestId('board-fabric-surface');
      const box = (await surface.boundingBox())!;
      await page.mouse.click(box.x + box.width * .55, box.y + box.height * .65);
      await expectBoardSynced(page);
      await expect.poll(async () => (await canonicalBoardSnapshot(request, token, boardId)).objects.filter(item => (item.extensionData?.contentObject as { type?: string } | undefined)?.type === 'shape').length).toBe(1);
      const created = (await canonicalBoardSnapshot(request, token, boardId)).objects.find(item => (item.extensionData?.contentObject as { type?: string } | undefined)?.type === 'shape')!;
      expect(created.extensionData?.contentObject).toMatchObject({ type: 'shape', variant: 'database' });
      await page.getByTestId('board-tool-select').click();
      await page.getByTestId('board-zoom-fit-board').click();
      await selectNote(page, created.id);
      await page.getByTestId('board-zoom-menu').click();
      await page.getByTestId('board-zoom-fit-selection').click();
      await expect.poll(async () => Number(await surface.getAttribute('data-viewport-zoom'))).toBeGreaterThan(.8);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      // Top and bottom cylinder outlines must both paint dark pixels on the native canvas.
      const ink = await surface.evaluate((node, id) => {
        const canvas = node.querySelector<HTMLCanvasElement>('canvas.lower-canvas')!;
        const rect = canvas.getBoundingClientRect();
        const scene = (JSON.parse(node.getAttribute('data-object-scenes')!) as Array<{id: string; left: number; top: number; width: number; height: number}>).find(item => item.id === id)!;
        const zoom = Number(node.getAttribute('data-viewport-zoom'));
        const ratio = canvas.width / rect.width;
        const x = Math.round((Number(node.getAttribute('data-viewport-pan-x')) + scene.left * zoom) * ratio);
        const y = Math.round((Number(node.getAttribute('data-viewport-pan-y')) + scene.top * zoom) * ratio);
        const width = Math.max(1, Math.round(scene.width * zoom * ratio));
        const height = Math.max(1, Math.round(scene.height * zoom * ratio));
        const data = canvas.getContext('2d')!.getImageData(x, y, width, height).data;
        let top = 0, bottom = 0;
        for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
          const offset = (row * width + col) * 4;
          if (data[offset + 3]! > 100 && data[offset]! < 100 && data[offset + 1]! < 100 && data[offset + 2]! < 100) {
            if (row < height * .3) top++;
            if (row > height * .7) bottom++;
          }
        }
        return { top, bottom };
      }, created.id);
      expect(ink.top).toBeGreaterThan(5);
      expect(ink.bottom).toBeGreaterThan(5);
      await screenshot(page, info, 'database-native-cylinder');
      await page.reload(); await expectBoardSynced(page);
      expect((await canonicalBoardSnapshot(request, token, boardId)).objects.find(item => item.id === created.id)).toEqual(created);
    });
    test('15–16 transparent note editing and handles adapt to rendered size', async ({ page, request }, info) => {
      await selectNote(page);
      await page.getByTestId('board-zoom-menu').click();
      await page.getByTestId('board-zoom-fit-selection').click();
      const surface = page.getByTestId('board-fabric-surface');
      await expect(surface).toHaveAttribute('data-object-controls-visible', 'true');
      const point = await objectPoint(page, 'feedback-note-a');
      await page.mouse.dblclick(point.x, point.y);
      const editor = page.getByTestId('board-thinking-editor');
      await expect(editor).toBeVisible();
      const style = await editor.evaluate(element => {
        const computed = getComputedStyle(element);
        return { background: computed.backgroundColor, border: computed.borderTopWidth, shadow: computed.boxShadow, outline: computed.outlineStyle };
      });
      expect(style).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px', shadow: 'none', outline: 'none' });
      await editor.fill('Edited 中文 English');
      await screenshot(page, info, 'transparent-sticky-editor');
      await editor.press('ControlOrMeta+Enter');
      await expectBoardSynced(page);
      await expect.poll(async () => (await canonicalBoardSnapshot(request, token, boardId)).objects.find(item => item.id === 'feedback-note-a')?.text).toBe('Edited 中文 English');
      // Real modified wheel input changes zoom around the note without editing the document.
      const zoomPoint = await objectPoint(page, 'feedback-note-a');
      await page.mouse.move(zoomPoint.x, zoomPoint.y);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, 2400);
      await page.keyboard.up('Control');
      await expect.poll(async () => Number(await surface.getAttribute('data-viewport-zoom'))).toBeLessThan(.25);
      await expect(surface).toHaveAttribute('data-object-controls-visible', 'false');
      await expect(page.locator('[data-testid^="connector-handle-feedback-note-a-"]')).toHaveCount(0);
      await expect(page.getByTestId('board-a11y-object-feedback-note-a')).toHaveAttribute('aria-pressed', 'true');
      await screenshot(page, info, 'small-note-without-crowded-handles');
      await page.reload(); await expectBoardSynced(page);
      expect((await canonicalBoardSnapshot(request, token, boardId)).objects.find(item => item.id === 'feedback-note-a')?.text).toBe('Edited 中文 English');
    });
    test('17 note formatting and text fonts survive canonical save and reload', async ({ page, request }, info) => {
      await selectNote(page);
      await page.getByTestId('board-sticky-text-open').click();
      const format = page.getByTestId('board-text-format-controls');
      await expect(format).toBeVisible();
      for (const label of ['左对齐', '水平居中', '右对齐', '顶对齐', '垂直居中', '底对齐']) await expect(format.getByRole('button', { name: label, exact: true })).toBeVisible();
      await format.getByRole('button', { name: '切换粗体', exact: true }).click();
      await format.getByRole('button', { name: '右对齐', exact: true }).click();
      await format.getByRole('button', { name: '底对齐', exact: true }).click();
      await format.getByTestId('board-format-font-size').fill('28');
      await expectBoardSynced(page);
      await expect.poll(async () => (await canonicalBoardSnapshot(request, token, boardId)).objects.find(item => item.id === 'feedback-note-a')?.extensionData?.thinkingInput).toMatchObject({ text: { bold: true, alignment: 'right', verticalAlignment: 'bottom', fontSize: 28 } });
      await screenshot(page, info, 'sticky-six-alignments-font-size');
      await page.keyboard.press('Escape');
      const text = object('feedback-text', 'text', 920, 100, '中文 / English title', 260, 80);
      text.style = { fill: 'transparent', fontSize: 24 };
      text.extensionData = { thinkingInput: { text: { preset: 'heading', fontFamily: 'Noto Sans SC', fontSize: 24 } } };
      await operate(request, token, boardId, createCommands([text]));
      await expect(page.getByTestId('board-a11y-mirror').locator('li[data-object-id]')).toHaveCount(4);
      await page.getByTestId('board-zoom-fit-board').click();
      await selectNote(page, text.id);
      await page.getByTestId('board-inspector-text').click();
      const textFormat = page.getByTestId('board-text-format-controls');
      await expect(textFormat.getByTestId('board-format-font-family')).toBeVisible();
      await textFormat.getByTestId('board-format-font-family').selectOption('Bitter');
      await textFormat.getByRole('button', { name: '添加字体', exact: true }).click();
      await textFormat.getByRole('textbox', { name: '本地字体名称', exact: true }).fill('BoardFeedbackMissingFont20261005');
      await textFormat.getByRole('button', { name: '加载字体', exact: true }).click();
      await expect(textFormat.getByRole('alert')).toHaveText('未找到该字体，请先在设备上安装后重试');
      await expect(textFormat.getByTestId('board-format-font-family')).toHaveValue('Bitter');
      await expectBoardSynced(page);
      const saved = await canonicalBoardSnapshot(request, token, boardId);
      expect(saved.objects.find(item => item.id === text.id)?.extensionData?.thinkingInput).toMatchObject({ text: { fontFamily: 'Bitter' } });
      await screenshot(page, info, 'text-font-family-and-add-validation');
      await page.reload(); await expectBoardSynced(page);
      expect(await canonicalBoardSnapshot(request, token, boardId)).toEqual(saved);
    });

    test('18 nearby native double-click copies note appearance and aligns its new neighbor', async ({ page, request }, info) => {
      const surface = page.getByTestId('board-fabric-surface');
      const point = await surface.evaluate(node => {
        const rect = node.getBoundingClientRect();
        const zoom = Number(node.getAttribute('data-viewport-zoom'));
        const panX = Number(node.getAttribute('data-viewport-pan-x'));
        const panY = Number(node.getAttribute('data-viewport-pan-y'));
        return { x: rect.x + panX + 190 * zoom, y: rect.y + panY + 100 * zoom - 40 };
      });
      expect(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.matches('canvas.upper-canvas'), point)).toBe(true);
      await page.mouse.dblclick(point.x, point.y);
      await expectBoardSynced(page);
      await expect.poll(async () => (await canonicalBoardSnapshot(request, token, boardId)).objects.length).toBe(4);
      const snapshot = await canonicalBoardSnapshot(request, token, boardId);
      const source = snapshot.objects.find(item => item.id === 'feedback-note-a')!;
      const created = snapshot.objects.find(item => !['feedback-note-a', 'feedback-note-b', 'feedback-note-c'].includes(item.id))!;
      expect(created.kind).toBe('sticky');
      expect(created.style).toEqual(source.style);
      expect(created.geometry).toEqual({ ...source.geometry, y: source.geometry.y - source.geometry.height - 24 });
      await page.keyboard.press('Escape');
      await page.getByTestId('board-zoom-fit-board').click();
      await screenshot(page, info, 'nearby-note-native-double-click');
      await page.reload(); await expectBoardSynced(page);
      expect((await canonicalBoardSnapshot(request, token, boardId)).objects.find(item => item.id === created.id)).toEqual(created);
    });

    test('19 standard tool shortcuts work on canvas while typing stays in the editor', async ({ page, request }, info) => {
      const surface = page.getByTestId('board-fabric-surface');
      const view = await surface.evaluate(node => {
        const canvas = node.querySelector<HTMLCanvasElement>('canvas.upper-canvas')!;
        const rect = canvas.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, zoom: Number(node.getAttribute('data-viewport-zoom')), panX: Number(node.getAttribute('data-viewport-pan-x')), panY: Number(node.getAttribute('data-viewport-pan-y')) };
      });
      const canonical = await canonicalBoardSnapshot(request, token, boardId);
      const diagnostics = [];
      let blank: { x: number; y: number } | undefined;
      const denseCandidates = [.1, .3, .5, .7, .9].flatMap(x => [.15, .25, .35, .55, .65, .75].map(y => ({ x: view.x + view.width * x, y: view.y + view.height * y }))).filter(point => canonical.objects.every(({ geometry: g }) => {
        const left = view.x + view.panX + g.x * view.zoom - 20, top = view.y + view.panY + g.y * view.zoom - 20;
        const right = view.x + view.panX + (g.x + g.width) * view.zoom + 20, bottom = view.y + view.panY + (g.y + g.height) * view.zoom + 20;
        return point.x < left || point.x > right || point.y < top || point.y > bottom;
      }));
      for (const candidate of [...compactBlankPoints(view, canonical.objects), ...denseCandidates]) {
        const hit = await page.evaluate(point => {
          const element = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
          return { canvas: element?.matches('canvas.upper-canvas') === true, tag: element?.tagName, testId: element?.dataset.testid, className: element?.className };
        }, candidate);
        diagnostics.push({ candidate, hit });
        if (!blank && hit.canvas) blank = candidate;
      }
      await info.attach('native-blank-hit-diagnostics', { body: JSON.stringify({ view, diagnostics }), contentType: 'application/json' });
      expect(blank, 'Canonical geometry and live hit testing must agree on an unobstructed native canvas point').toBeDefined();
      await page.mouse.click(blank!.x, blank!.y);
      const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, testId: (document.activeElement as HTMLElement | null)?.dataset.testid }));
      expect(focus.tag).not.toBe('BODY');
      await info.attach('native-canvas-shortcut-focus', { body: JSON.stringify(focus), contentType: 'application/json' });
      for (const [key, target] of [['n', 'board-add-sticky'], ['t', 'board-add-text'], ['s', 'board-add-shape'], ['p', 'board-add-draw'], ['l', 'board-add-connector']] as const) {
        await page.keyboard.press(key);
        await expect(page.getByTestId(target)).toHaveAttribute('aria-pressed', 'true');
        await page.keyboard.press('Escape');
      }
      await page.keyboard.press('e');
      await expect(page.getByTestId('board-draw-eraser')).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press('Escape');
      await selectNote(page);
      const point = await objectPoint(page, 'feedback-note-a');
      await page.mouse.dblclick(point.x, point.y);
      const editor = page.getByTestId('board-thinking-editor');
      await editor.fill(''); await editor.pressSequentially('ntspl e');
      await expect(editor).toHaveValue('ntspl e');
      await expect(surface).toBeVisible();
      await screenshot(page, info, 'shortcuts-do-not-intercept-note-typing');
      await editor.press('ControlOrMeta+Enter'); await expectBoardSynced(page);
      expect((await canonicalBoardSnapshot(request, token, boardId)).objects).toHaveLength(3);
      expect((await canonicalBoardSnapshot(request, token, boardId)).objects.find(item => item.id === 'feedback-note-a')?.text).toBe('ntspl e');
    });

    test('21 connector widths are icon-only, single-row and persist through reload', async ({ page, request }, info) => {
      const connector = WhiteboardObject.parse({ ...object('feedback-edge', 'connector', 120, 500, '', 600, 1), style: { stroke: '#27272A' }, connector: { fromPoint: { x: 120, y: 500 }, toPoint: { x: 720, y: 500 }, fromAnchor: 'right' as const, toAnchor: 'left' as const, type: 'straight' as const, strokeWidth: 4 } });
      await operate(request, token, boardId, createCommands([connector]));
      const row = page.getByTestId('board-a11y-object-feedback-edge');
      await expect(row).toBeVisible(); await row.focus(); await row.press('Enter');
      await expect(page.getByTestId('board-connector-toolbar')).toBeVisible();
      await page.getByTestId('board-connector-width-open').click();
      const presets = page.getByRole('group', { name: '连接线粗细预设', exact: true });
      await expect(presets.getByRole('button')).toHaveCount(6);
      const buttons = presets.getByRole('button');
      for (let index = 0; index < await buttons.count(); index++) await expect(buttons.nth(index)).toHaveText('');
      const popover = page.getByTestId('board-tool-popover');
      await popover.evaluate(async element => {
        await Promise.all(element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined)));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      // Read every button in one browser frame: opening animations move the whole popup.
      const layout = await presets.evaluate(element => {
        const style = getComputedStyle(element);
        return { display: style.display, flexWrap: style.flexWrap, buttons: Array.from(element.querySelectorAll('button')).map(button => ({ y: button.getBoundingClientRect().y, height: button.getBoundingClientRect().height })) };
      });
      await info.attach('connector-width-atomic-layout', { body: JSON.stringify(layout), contentType: 'application/json' });
      expect(layout.display).toBe('flex'); expect(layout.flexWrap).toBe('nowrap');
      expect(Math.max(...layout.buttons.map(button => button.y)) - Math.min(...layout.buttons.map(button => button.y))).toBeLessThan(2);
      await withinViewport(page.getByTestId('board-tool-popover'), viewport.width);
      await page.getByTestId('board-connector-width-8').click();
      await expectBoardSynced(page);
      await expect.poll(async () => (await canonicalBoardSnapshot(request, token, boardId)).objects.find(item => item.id === connector.id)?.connector?.strokeWidth).toBe(8);
      await screenshot(page, info, 'connector-six-widths-single-row');
      await page.reload(); await expectBoardSynced(page);
      expect((await canonicalBoardSnapshot(request, token, boardId)).objects.find(item => item.id === connector.id)?.connector?.strokeWidth).toBe(8);
    });

    if (viewport.width === 1440) test('20 eraser removes painted pixels before pointer release without early writes', async ({ page, request }, info) => {
      await page.getByTestId('board-add-draw').click();
      const surface = page.getByTestId('board-fabric-surface');
      const box = (await surface.boundingBox())!;
      const start = { x: box.x + 900, y: box.y + box.height * .7 };
      const center = { x: start.x + 40, y: start.y + 20 };
      const pixels = () => surface.evaluate((node, point) => {
        const canvas = node.querySelector<HTMLCanvasElement>('canvas.lower-canvas')!;
        const rect = canvas.getBoundingClientRect();
        const x = Math.round((point.x - rect.x) * canvas.width / rect.width);
        const y = Math.round((point.y - rect.y) * canvas.height / rect.height);
        const data = canvas.getContext('2d')!.getImageData(x - 1, y - 1, 3, 3).data;
        return [...data].filter((_, index) => index % 4 === 3 && data[index]! > 0).length;
      }, center);
      await expect.poll(pixels).toBe(0);
      expect(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.matches('canvas.upper-canvas'), center)).toBe(true);
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      await page.mouse.move(start.x + 80, start.y + 40, { steps: 12 }); await page.mouse.up();
      await expectBoardSynced(page);
      const before = await canonicalBoardSnapshot(request, token, boardId);
      expect(before.objects.filter(item => item.kind === 'drawing')).toHaveLength(1);
      await expect.poll(pixels).toBeGreaterThan(0);
      await page.getByTestId('board-draw-eraser').click();
      await page.mouse.move(center.x, center.y - 30); await page.mouse.down();
      await page.mouse.move(center.x, center.y + 30, { steps: 12 });
      await expect.poll(pixels).toBe(0);
      expect(await canonicalBoardSnapshot(request, token, boardId)).toEqual(before);
      await screenshot(page, info, 'eraser-live-before-release');
      await page.mouse.up(); await expectBoardSynced(page);
      const after = await canonicalBoardSnapshot(request, token, boardId);
      const drawing = after.objects.find(item => item.kind === 'drawing')!;
      expect(drawing.extensionData?.contentObject).toMatchObject({ type: 'drawing', strokes: [expect.anything(), expect.objectContaining({ tool: 'eraser' })] });
    });
  });
}
