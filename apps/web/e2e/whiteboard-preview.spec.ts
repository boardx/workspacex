import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
const evidence = path.resolve(__dirname, '../../../docs/design/whiteboard/ui-preview');
test.beforeAll(() => fs.mkdirSync(evidence, { recursive: true }));
for (const width of [375, 768, 1280]) {
  test(`default at ${width}px has no document overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/preview/whiteboard');
    await expect(page.getByTestId('whiteboard-screen')).toBeVisible();
    // 这两颗 testid **仍然存在于源码里**（全局导航在非全屏壳里照常渲染），这里断言的是
    // 它们在全屏画布下**不被渲染**。所以这里不挂 lint-e2e-testid-gate 的 absent 豁免标注：
    // 那个标注的语义是「该 testid 已从代码库删除」，而该门控自己写明它不检查条件渲染。
    // 挂上去会被判成「豁免已无意义」而红，且等于给未来真的删掉这两颗开一张永久通行证。
    await expect(page.getByTestId('shell-rail')).toHaveCount(0); // 全屏画布隐藏全局导航
    await expect(page.getByTestId('shell-mobile-tabs')).toHaveCount(0); // 全屏画布隐藏移动端导航
    await expect(page.getByTestId('whiteboard-exit')).toHaveAttribute('href', '/projects');
    const main = await page.getByTestId('shell-main').boundingBox();
    expect(main?.x).toBe(0);
    expect(main?.width).toBe(width);
    expect(main?.height).toBe(900);
    await expect(page.getByTestId('whiteboard-preview-notice')).toContainText('未保存');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width < 1024) {
      await expect(page.getByRole('complementary', { name: '对象属性' })).toBeHidden();
      const surface = await page.getByTestId('whiteboard-surface').boundingBox();
      if (!surface) throw new Error('Canvas has no bounds');
      for (const id of ['note-1', 'note-2', 'note-3']) {
        const note = await page.getByTestId(`whiteboard-object-${id}`).boundingBox();
        if (!note) throw new Error(`${id} has no bounds`);
        expect(note.x).toBeGreaterThanOrEqual(surface.x);
        expect(note.y).toBeGreaterThanOrEqual(surface.y);
        expect(note.x + note.width).toBeLessThanOrEqual(surface.x + surface.width);
        expect(note.y + note.height).toBeLessThanOrEqual(surface.y + surface.height);
      }
    }
    await page.screenshot({ path: path.join(evidence, `default-${width}.png`), fullPage: true });
    if (width < 1024) {
      const panel = page.getByRole('complementary', { name: '对象属性' });
      await page.getByTestId('whiteboard-object-note-1').click();
      await expect(panel).toBeVisible();
      await expect(page.getByTestId('whiteboard-object-text')).toHaveValue('先独立思考\n再一起讨论');
      await page.getByTestId('whiteboard-panel-close').click();
      await expect(panel).toBeHidden();
      await page.getByTestId('whiteboard-panel-toggle').click();
      await expect(panel).toBeVisible();
      await page.getByTestId('whiteboard-panel-close').click();
      await expect(panel).toBeHidden();
    }
  });
}
const states = [
  ['default', '团队创意工作坊'], ['loading', '正在打开白板…'], ['empty', '从一个想法开始'],
  ['invalid', '无法插入：图表尚未生成完整，请等待生成完成。'],
  ['dep-failed', '暂时无法连接白板'], ['denied', '你还没有这块白板的访问权限'],
  ['success', '成功状态示例：操作已应用到本地预览，尚未写入服务端。'],
] as const;
for (const [state, text] of states) {
  test(`renders ${state} visibly`, async ({ page }) => {
    await page.goto(`/preview/whiteboard?state=${state}`);
    if (state === 'default') await expect(page.getByTestId('whiteboard-title')).toHaveValue(text);
    else await expect(page.getByText(text, { exact: true })).toBeVisible();
    if (state === 'denied' || state === 'dep-failed') await expect(page.getByTestId(state)).toBeVisible();
    await page.screenshot({ path: path.join(evidence, `state-${state}.png`), fullPage: true });
  });
}
test('create, edit, drag, undo and redo a sticky', async ({ page }) => {
  await page.goto('/preview/whiteboard?state=empty');
  await page.getByTestId('whiteboard-add-sticky').click();
  const note = page.getByRole('button', { name: '图形：验证便利贴', exact: true });
  await page.getByTestId('whiteboard-object-text').fill('验证便利贴');
  await page.getByTestId('whiteboard-title').click();
  await expect(note).toBeVisible();
  const before = await note.boundingBox();
  if (!before) throw new Error('Sticky has no visible box');
  await page.mouse.move(before.x + 30, before.y + 30);
  await page.mouse.down(); await page.mouse.move(before.x + 110, before.y + 90, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await note.boundingBox())?.x).toBeCloseTo(before.x + 80, 0);
  await page.getByTestId('whiteboard-undo').click();
  await expect.poll(async () => (await note.boundingBox())?.x).toBeCloseTo(before.x, 0);
  await page.getByTestId('whiteboard-redo').click();
  await expect.poll(async () => (await note.boundingBox())?.x).toBeCloseTo(before.x + 80, 0);
  await page.getByTestId('whiteboard-undo').click();
  await page.getByTestId('whiteboard-undo').click();
  await expect(page.getByRole('button', { name: '图形：写下一个想法', exact: true })).toBeVisible();
  await page.getByTestId('whiteboard-redo').click(); await expect(note).toBeVisible();
});
test('connect objects, delete cancellation, Escape, confirmation and undo', async ({ page }) => {
  await page.goto('/preview/whiteboard');
  const lines = page.getByTestId('whiteboard-surface').locator('svg line');
  await expect(lines).toHaveCount(2);
  await page.getByTestId('whiteboard-tool-connect').click();
  await page.getByTestId('whiteboard-object-note-1').click();
  await page.getByTestId('whiteboard-object-note-2').click();
  await expect(lines).toHaveCount(3);
  await expect(page.getByTestId('whiteboard-announcement')).toContainText('已建立连接');
  await page.getByTestId('whiteboard-delete').click();
  await page.getByTestId('whiteboard-delete-cancel').click();
  await expect(page.getByTestId('whiteboard-object-note-2')).toBeVisible();
  await page.getByTestId('whiteboard-delete').click(); await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(lines).toHaveCount(3);
  await page.getByTestId('whiteboard-delete').click(); await page.getByTestId('whiteboard-delete-confirm').click();
  await expect(page.getByTestId('whiteboard-object-note-2')).toHaveCount(0); await expect(lines).toHaveCount(0);
  await page.getByTestId('whiteboard-undo').click(); await expect(lines).toHaveCount(3);
});
test('bulk adds nonempty lines and enforces the 50-note limit', async ({ page }) => {
  await page.goto('/preview/whiteboard?state=empty');
  await page.getByTestId('whiteboard-bulk-open').click();
  await expect(page.getByTestId('whiteboard-bulk-apply')).toBeDisabled();
  await page.getByTestId('whiteboard-bulk-text').fill(Array.from({ length: 51 }, (_, i) => `想法 ${i}`).join('\n'));
  await expect(page.getByTestId('whiteboard-bulk-apply')).toBeDisabled();
  await page.getByTestId('whiteboard-bulk-text').fill('想法一\n\n想法二\n想法三');
  await page.getByTestId('whiteboard-bulk-apply').click();
  for (const text of ['想法一', '想法二', '想法三']) await expect(page.getByRole('button', { name: `图形：${text}`, exact: true })).toBeVisible();
  await expect(page.getByTestId('whiteboard-announcement')).toContainText('已添加 3 张便签');
});
