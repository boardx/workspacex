#!/usr/bin/env node
// LEGACY SOURCE ARCHIVE (#5001): not executed/accepted against this PR. See docs/design/board-acceptance-history/README.md.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback;
const base = arg('base', 'http://127.0.0.1:3317'), apiOrigin = arg('api', 'http://127.0.0.1:3320');
const storageState = arg('storage-state'), out = resolve(arg('out', '/private/tmp/wsx-board-tools-visual-evidence'));
assert(storageState, 'Provide --storage-state with an explicitly exported authenticated browser session.');
const {chromium} = createRequire(join(root, 'apps/web/package.json'))('playwright-core');
mkdirSync(out, {recursive: true});
let browser, page, token, boardId, completed = false;
const results = [];
const browserErrors = [];
const narrowLayouts = [];
const narrowCreationPoints = [];
const redact = value => String(value).replaceAll(token ?? '\0', '[token]');
const poll = async (read, predicate, label) => {
  const until = Date.now() + 30000;
  do { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < until);
  throw new Error(`Timed out: ${label}`);
};
const check = async (name, run) => {
  try { const detail = await run(); results.push({name, ok: true, detail}); console.log('PASS', name); }
  catch (error) { results.push({name, ok: false, detail: redact(error.stack ?? error)}); await page?.screenshot({path: join(out, `failure-${results.length}.png`)}).catch(() => {}); throw error; }
};
const api = async (method, path, data) => {
  const response = await page.request.fetch(`${apiOrigin}${path}`, {method, data, headers: {authorization: `Bearer ${token}`}});
  assert(response.ok(), `${method} ${path}: ${response.status()}`); return response;
};
const snapshot = async () => {
  const exported = await (await api('POST', `/whiteboards/${boardId}/imports/standard-export`, {requestId: randomUUID()})).json();
  const payload = await (await api('GET', exported.downloadPath)).json(), bytes = Buffer.from(payload.contentBase64, 'base64');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), exported.sha256); assert.equal(bytes.length, exported.sizeBytes);
  const value = JSON.parse(bytes.toString('utf8')); assert.equal(value.board.id, boardId); return value.objects;
};
const synced = async () => { await page.getByTestId('board-sync-status').waitFor(); await poll(() => page.getByTestId('board-sync-status').getAttribute('data-sync-state'), state => state === 'saved', 'saved state'); };
const surface = () => page.getByTestId('board-fabric-surface');
const shot = async name => { await page.mouse.move(Math.min(1200, page.viewportSize().width - 20), 100); await page.screenshot({path: join(out, `${name}.png`)}); };
const previewStyle = locator => locator.evaluate(element => { const style = getComputedStyle(element); return {color: style.backgroundColor, radius: style.borderRadius, width: style.width, height: style.height}; });
const exitCreation = async expectedCount => {
  const editor = page.getByTestId('board-thinking-editor');
  if (await editor.isVisible()) { await editor.fill(`Visual acceptance ${expectedCount}`); await editor.press('Control+Enter'); }
  await page.keyboard.press('Escape'); await synced();
  assert.equal(await page.getByTestId('board-tool-select').getAttribute('aria-pressed'), 'true');
  await surface().click({position: {x: 1100, y: 140}}); await synced();
  assert.equal((await snapshot()).length, expectedCount, 'single-shot creates exactly once');
};
const exitCreationNarrow = async expectedCount => {
  const editor = page.getByTestId('board-thinking-editor');
  if (await editor.isVisible()) { await editor.fill(`Narrow acceptance ${expectedCount}`); await editor.press('Control+Enter'); }
  await page.keyboard.press('Escape'); await synced();
  assert.equal(await page.getByTestId('board-tool-select').getAttribute('aria-pressed'), 'true');
  await surface().click({position: {x: 80, y: 120}}); await synced();
  assert.equal((await snapshot()).length, expectedCount, 'narrow single-shot creates exactly once');
};
try {
  browser = await chromium.launch(process.env.PW_EXECUTABLE ? {executablePath: process.env.PW_EXECUTABLE} : {});
  const context = await browser.newContext({storageState, viewport: {width: 1440, height: 900}, locale: 'zh-CN'});
  page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => browserErrors.push({kind: 'pageerror', message: redact(error.message)}));
  page.on('console', message => { if (message.type() === 'error') browserErrors.push({kind: 'console', message: redact(message.text())}); });
  const originState = (await context.storageState()).origins.find(origin => origin.origin === new URL(base).origin);
  assert(originState, 'Supplied session must include --base origin');
  const local = new Map(originState.localStorage.map(item => [item.name, item.value]));
  token = local.get('wsx.sessionToken'); assert(token);
  const session = JSON.parse(local.get('wsx.session'));
  assert(session.version === 2 && session.revision === local.get('wsx.sessionCommit') && session.orgs.includes(session.currentOrgId) && Date.parse(session.expiresAt) > Date.now(), 'Session must be committed and valid');
  await api('GET', `/identity/me?orgId=${encodeURIComponent(session.currentOrgId)}`);
  boardId = (await (await api('POST', '/whiteboards', {requestId: randomUUID(), name: `Tools visual acceptance ${randomUUID()}`})).json()).id;
  assert(boardId); await page.goto(`${base}/studio/board/${boardId}`); await synced();
  await check('text presets expose distinct actual size and weight', async () => {
    await page.getByTestId('board-add-text').click();
    const styles = [];
    for (const preset of ['title', 'heading', 'subheading', 'body', 'caption']) styles.push(await page.getByTestId(`board-text-${preset}`).evaluate((element, preset) => { const style = getComputedStyle(element); return {preset, size: parseFloat(style.fontSize), weight: Number(style.fontWeight)}; }, preset));
    for (let index = 1; index < styles.length; index++) assert(styles[index - 1].size > styles[index].size, 'preset size hierarchy');
    assert(styles[1].weight > styles[3].weight, 'heading must be bolder than body');
    await shot('text-presets'); await page.keyboard.press('Escape'); return styles;
  });
  await check('shape picker renders actual varied SVG outlines', async () => {
    await page.getByTestId('board-add-shape').click();
    const shapes = [];
    for (const variant of ['rectangle', 'rounded-rectangle', 'circle', 'ellipse', 'diamond', 'triangle', 'hexagon', 'cloud', 'database', 'document', 'process', 'decision', 'terminator', 'data', 'predefined-process']) {
      const svg = page.getByTestId(`board-shape-${variant}`).locator('svg'); assert.equal(await svg.count(), 1);
      shapes.push({variant, outline: await svg.innerHTML()});
    }
    assert(new Set(shapes.map(shape => shape.outline)).size >= 12);
    await shot('shape-outlines'); await page.keyboard.press('Escape'); return shapes;
  });
  await check('sticky circle and rectangle preserve selected color and dock preview after placement', async () => {
    const details = [];
    for (const [variant, color, x] of [['circle', 'pink', 350], ['rectangle', 'blue', 750]]) {
      const count = (await snapshot()).length;
      await page.getByTestId('board-add-sticky').click(); await page.getByTestId(`board-sticky-default-${color}`).click(); await page.getByTestId(`board-sticky-${variant}`).click();
      assert.equal((await snapshot()).length, count, 'choosing a tool does not create');
      assert.equal(await page.getByTestId(`board-sticky-${variant}`).getAttribute('aria-pressed'), 'true');
      const dock = page.getByTestId('board-add-sticky').locator('[data-sticky-variant]');
      assert.equal(await dock.getAttribute('data-sticky-variant'), variant);
      const selectedStyle = await previewStyle(dock);
      assert.deepEqual(selectedStyle, await previewStyle(page.getByTestId(`board-sticky-${variant}`).locator('[data-sticky-variant]')));
      await shot(`sticky-${variant}-picker`); await surface().click({position: {x, y: 270}});
      await poll(snapshot, objects => objects.length === count + 1, 'one sticky'); await exitCreation(count + 1);
      const object = (await snapshot()).find(object => object.extensionData?.thinkingInput?.sticky?.variant === variant); assert(object);
      const sticky = object.extensionData.thinkingInput.sticky;
      const rgb = sticky.color.slice(1).match(/../g).map(value => parseInt(value, 16)); assert.equal(selectedStyle.color, `rgb(${rgb.join(', ')})`);
      assert.equal(await dock.getAttribute('data-sticky-variant'), variant); assert.deepEqual(await previewStyle(dock), selectedStyle);
      details.push({variant, selectedStyle, objectId: object.id});
    }
    await shot('sticky-placed'); return details;
  });
  await check('submenu chevrons and native HTML tool drags place once at zoomed world center', async () => {
    for (const tool of ['sticky', 'text', 'shape', 'draw', 'image', 'more']) assert(await page.getByTestId(`board-add-${tool}-submenu`).isVisible());
    const box = await surface().boundingBox(); assert(box); await page.mouse.move(box.x + 1000, box.y + 220);
    await page.keyboard.down('Control'); try { await page.mouse.wheel(0, -180); } finally { await page.keyboard.up('Control'); }
    await poll(() => surface().getAttribute('data-viewport-zoom'), value => Number(value) !== 1, 'non-default zoom');
    const details = [];
    for (const [source, x, y] of [['dock', 430, 440], ['submenu', 760, 430]]) {
      const before = await snapshot();
      const zoom = Number(await surface().getAttribute('data-viewport-zoom')), panX = Number(await surface().getAttribute('data-viewport-pan-x')), panY = Number(await surface().getAttribute('data-viewport-pan-y'));
      const expected = {x: (x - panX) / zoom, y: (y - panY) / zoom};
      if (source === 'submenu') await page.getByTestId('board-add-sticky').click();
      await page.getByTestId(source === 'dock' ? 'board-add-sticky' : 'board-sticky-circle').dragTo(surface(), {targetPosition: {x, y}});
      await poll(snapshot, objects => objects.length === before.length + 1, `${source} drop`); await exitCreation(before.length + 1);
      const added = (await snapshot()).find(object => !before.some(prior => prior.id === object.id)); assert(added);
      const actual = {x: added.geometry.x + added.geometry.width / 2, y: added.geometry.y + added.geometry.height / 2};
      assert(Math.abs(actual.x - expected.x) < 1 && Math.abs(actual.y - expected.y) < 1, `${source} drop center matches transformed pointer`);
      details.push({source, zoom, expected, actual, objectId: added.id});
    }
    await shot('zoomed-tool-drag'); return details;
  });
  await check('compact draw has no opacity control and four distinct nominal brush previews', async () => {
    await page.getByTestId('board-add-draw').click(); const panel = page.getByTestId('board-draw-tool-panel');
    const bounds = await panel.boundingBox(); assert(bounds && bounds.height <= 160, `draw panel height ${bounds?.height}`);
    assert.equal(await panel.locator('[data-testid^="board-draw-opacity-"]').count(), 0);
    const styles = [];
    for (const choice of ['pen', 'marker', 'pencil', 'highlighter']) {
      await page.getByTestId(`board-draw-${choice}`).click();
      const preview = await page.getByTestId('board-draw-preview').locator('path').evaluate(element => ({color: element.getAttribute('stroke'), width: Number(element.getAttribute('stroke-width')), opacity: Number(element.getAttribute('stroke-opacity'))}));
      styles.push({choice, ...preview}); await shot(`draw-${choice}`);
    }
    assert.equal(new Set(styles.map(({width, opacity}) => `${width}/${opacity}`)).size, 4);
    assert.deepEqual(styles.map(({width, opacity}) => [width, opacity]), [[3, 1], [8, .9], [2, .65], [20, .35]]);
    await page.getByTestId('board-draw-select').click(); assert.equal(await panel.count(), 0);
    return {height: bounds.height, styles, pressureScope: 'DOM preview uses nominal width; live stroke pressure pixels are tested separately'};
  });
  await check('390px menus fit and text shape sticky draw remain operable', async () => {
    await page.setViewportSize({width: 390, height: 844});
    const details = [];
    const recordLayout = async label => {
      const detail = await page.evaluate(() => ['board-creation-dock','collaborative-editor'].map(testid => {
        const element=document.querySelector(`[data-testid="${testid}"]`),style=getComputedStyle(element),box=element.getBoundingClientRect();
        return {testid,className:element.className,left:style.left,right:style.right,marginLeft:style.marginLeft,marginRight:style.marginRight,transform:style.transform,box:{x:box.x,y:box.y,width:box.width,height:box.height},scrollLeft:element.scrollLeft,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth,children:[...element.children].map(child=>({testid:child.getAttribute('data-testid'),className:child.className,clientWidth:child.clientWidth,scrollWidth:child.scrollWidth,scrollLeft:child.scrollLeft}))};
      }));
      narrowLayouts.push({label,detail}); writeFileSync(join(out,'narrow-layout.json'),JSON.stringify(narrowLayouts,null,2));
    };
    const fits = async locator => {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const bounds = await poll(() => locator.boundingBox(), box => box && box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844, 'stable menu fits narrow viewport').catch(async error => {
        const geometry = await page.evaluate(() => ({scrollX:window.scrollX,scrollY:window.scrollY,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,ancestors:[...document.querySelector('[data-testid="board-tool-picker"]').parentElement.parentElement.querySelectorAll('[data-testid="board-creation-dock"], [data-testid="collaborative-editor"]')].map(element=>({testid:element.getAttribute('data-testid'),scrollLeft:element.scrollLeft,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth})),editor:(()=>{const element=document.querySelector('[data-testid="collaborative-editor"]');return{scrollLeft:element.scrollLeft,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth};})()}));
        throw new Error(`${error.message}; bounds=${JSON.stringify(await locator.boundingBox())}; document=${JSON.stringify(geometry)}`);
      });
      const overflow = await locator.evaluate(element => ({client: element.clientWidth, scroll: element.scrollWidth})); assert(overflow.scroll <= overflow.client + 1, 'menu has no horizontal content overflow');
      for (const button of await locator.locator('button').all()) {
        const box = await button.boundingBox(); assert(box && box.x >= bounds.x - 1 && box.x + box.width <= bounds.x + bounds.width + 1, 'menu control fits its horizontal boundary');
        if (await button.isDisabled()) continue;
        const hit = await button.evaluate(element => {
          const box = element.getBoundingClientRect(), target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return {ok: Boolean(target && element.contains(target)), option: element.getAttribute('data-testid') ?? element.getAttribute('aria-label') ?? element.textContent, target: target?.getAttribute('data-testid') ?? target?.tagName, box: {x: box.x, y: box.y, width: box.width, height: box.height}};
        });
        assert(hit.ok, `every enabled submenu option is unobstructed: ${JSON.stringify(hit)}`);
      }
      return bounds;
    };
    for (const [tool, option] of [['text', 'board-text-caption'], ['shape', 'board-shape-triangle'], ['sticky', 'board-sticky-rectangle']]) {
      const button = page.getByTestId(`board-add-${tool}`); await recordLayout(`${tool}:before-scroll`); await button.scrollIntoViewIfNeeded(); await recordLayout(`${tool}:after-scroll`); await button.click(); await recordLayout(`${tool}:after-click`);
      assert.equal(await button.getAttribute('aria-pressed'), 'true'); assert(await page.getByTestId(`board-add-${tool}-submenu`).isVisible());
      const bounds = await fits(page.getByTestId('board-tool-picker')); await page.getByTestId(option).click();
      assert.equal(await page.getByTestId(option).getAttribute('aria-pressed'), 'true');
      await shot(`narrow-${tool}-menu`);
      const count = (await snapshot()).length;
      const recordCreationPoint = async stage => {
        const detail=await surface().evaluate((element,{tool,stage})=>{
          const bounds=element.getBoundingClientRect(),client={x:bounds.x+220,y:bounds.y+150},target=document.elementFromPoint(client.x,client.y);
          const zoom=Number(element.getAttribute('data-viewport-zoom')),panX=Number(element.getAttribute('data-viewport-pan-x')),panY=Number(element.getAttribute('data-viewport-pan-y')),world={x:(220-panX)/zoom,y:(150-panY)/zoom};
          const scenes=JSON.parse(element.getAttribute('data-object-scenes')??'[]');
          return{tool,stage,client,world,target:target?{tag:target.tagName,testid:target.getAttribute('data-testid'),className:typeof target.className==='string'?target.className:target.className.baseVal}:null,armed:[...document.querySelectorAll('[data-testid^="board-add-"][aria-pressed="true"]')].map(button=>button.getAttribute('data-testid')),selectPressed:document.querySelector('[data-testid="board-tool-select"]').getAttribute('aria-pressed'),overlappingSceneIds:scenes.filter(scene=>world.x>=scene.left&&world.x<=scene.left+scene.width&&world.y>=scene.top&&world.y<=scene.top+scene.height).map(scene=>scene.id)};
        },{tool,stage});
        narrowCreationPoints.push(detail);writeFileSync(join(out,'narrow-creation.json'),JSON.stringify(narrowCreationPoints,null,2));
      };
      await recordCreationPoint('before-click');await surface().click({position: {x: 220, y: 150}});await recordCreationPoint('after-click');
      await poll(snapshot, objects => objects.length === count + 1, `narrow ${tool} creation`); await exitCreationNarrow(count + 1);await recordCreationPoint('after-single-shot');
      details.push({tool, bounds, createdCount: count + 1});
    }
    const draw = page.getByTestId('board-add-draw'); await draw.scrollIntoViewIfNeeded(); await draw.click();
    const bounds = await fits(page.getByTestId('board-draw-tool-panel')); await page.getByTestId('board-draw-marker').click();
    assert.equal(await page.getByTestId('board-draw-marker').getAttribute('aria-pressed'), 'true');
    await shot('narrow-draw-menu'); await page.getByTestId('board-draw-select').click();
    assert.equal(await page.getByTestId('board-tool-select').getAttribute('aria-pressed'), 'true');
    details.push({tool: 'draw', bounds}); return details;
  });
  await check('browser runtime has no page or console errors', async () => { assert.equal(browserErrors.length, 0, JSON.stringify(browserErrors)); return {count: browserErrors.length}; });
  completed = true;
} catch (error) { if (!results.some(result => !result.ok)) results.push({name: 'setup', ok: false, detail: redact(error.stack ?? error)}); }
finally {
  await browser?.close(); const ok = completed && results.length === 7 && results.every(result => result.ok);
  writeFileSync(join(out, 'results.json'), JSON.stringify({ok, boardId, base, apiOrigin, results, browserErrors}, null, 2));
  writeFileSync(join(out, 'report.md'), `# Board Tools Visual Acceptance\n\nResult: ${ok ? 'PASS' : 'FAIL'}\n\n${results.map(result => `- ${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.ok ? '' : `: ${result.detail.split('\n')[0]}`}`).join('\n')}\n\nReal browser and authenticated API; no service startup or mocked objects. Drag uses native HTML drag events through Playwright, not native OS drag. Brush previews check nominal DOM appearance; live pressure pixels are outside this script. Reload preference persistence is outside this script.\n`);
  process.exitCode = ok ? 0 : 1;
}
