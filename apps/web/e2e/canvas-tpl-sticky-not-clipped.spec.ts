/**
 * **贴纸不被外层容器裁掉一部分**——真实浏览器验收（2026-09-01 后续修复）。
 *
 * 人类反馈"便利贴还是被裁掉"、且排除了"画布缩得太小"（全屏下依然会切）之后的
 * 根因链：区块内标题行 + `{{token}} X列·Y条` 提示行此前用固定像素字号/内边距，
 * 不像贴纸本身那样按 `cqw`（纸宽比例）缩放，而"这块地方能放几行贴纸"的公式
 * （`sectionGeometryMm` 的 `titleReserveMm`）却假设标题区恒占纸面的固定比例——
 * 纸面渲染得越宽，标题区真实占用的"纸面比例"理应越小，固定像素不会跟着变小，
 * 于是在任何宽度下都会持续少算一点，多算出来的空间体现为最后一行贴纸被
 * `overflow-hidden` 切掉一截。改法是把标题行也换成 `cqw`（见 `BLOCK_HEADER_CQW`），
 * `titleReserveMm` 现在按*给定纸张的实际宽度*换算 mm，不再是三档纸张共用一个
 * 只在 A1 上精确的固定值。
 *
 * `canvas-template-library-design.spec.ts` 已有的「贴纸内文字不被裁切」用例
 * （§7 第 7 条，`scrollHeight ≤ clientHeight`）验的是**贴纸内部**文字有没有溢出
 * 贴纸自己——那是另一层（`noteFontSizePx`），治不了这一层。这里验的是**贴纸整体**
 * 有没有被贴纸网格外层的 `overflow-hidden` 从中间切掉一截：贴纸虽然还在 DOM 里
 * （`overflow: hidden` 不会移除元素，只是视觉上藏起来），但它的 `getBoundingClientRect()`
 * 仍然如实反映真实位置——量它的 `bottom` 有没有超出贴纸网格容器的 `bottom`，
 * 就是"这张贴纸有没有被腰斩"唯一可靠的判据（同"文字有没有被裁切"用
 * `scrollHeight` 而不是肉眼看截图的道理）。
 *
 * 覆盖三档纸张（人类 2026-08-27 要求「A1/A3/A4 可选」；`titleReserveMm` 现在
 * 按纸宽换算，这三档各自该精确，不该只有 A1 精确、A3/A4 只是"偏保守但不翻车"）
 * 与两档视口宽度（约束宽度 + 全屏），呼应人类原话"全屏下依然会切"——不能只在
 * 某一个宽度下测过就算数。
 */
import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.adminEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

/**
 * 逐张量：每个区块的贴纸网格容器 vs 它每张贴纸的 `getBoundingClientRect()`。
 * 结构对应 `template-canvas-grid.tsx` 的 `block > [标题块, 贴纸网格]`——不靠
 * testid（贴纸网格本身没有单独的 testid，靠结构定位比新增一个只为测试服务的
 * testid 更不容易在无关重构里悄悄漂移）。
 */
async function findClippedNotes(page: Page): Promise<{ blockId: string; noteBottom: number; gridBottom: number }[]> {
  return page.evaluate(() => {
    const blocks = [...document.querySelectorAll('[data-testid^="tpladmin-editor-block-"]')];
    const bad: { blockId: string; noteBottom: number; gridBottom: number }[] = [];
    for (const block of blocks) {
      const notesGrid = block.children[1];
      if (!notesGrid) continue;
      const gridRect = notesGrid.getBoundingClientRect();
      if (gridRect.height <= 0) continue;
      for (const note of Array.from(notesGrid.children)) {
        const r = note.getBoundingClientRect();
        // +1px 容忍亚像素取整，同仓库里 scrollHeight/clientHeight 那条既有断言的容差。
        if (r.height > 0 && r.bottom > gridRect.bottom + 1) {
          bad.push({ blockId: block.getAttribute("data-testid") ?? "", noteBottom: r.bottom, gridBottom: gridRect.bottom });
        }
      }
    }
    return bad;
  });
}

for (const paperSize of ["A1", "A3", "A4"] as const) {
  test(`${paperSize} 纸：贴纸不被贴纸网格外层裁掉一部分（约束宽度 + 全屏两档）`, async ({ page }) => {
    const failures: string[] = [];
    page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));

    await loginAsAdmin(page);
    await page.goto("/canvas/template-admin");
    await expect(page.getByTestId("tpladmin-root")).toBeVisible();

    const stamp = String(Date.now()).slice(-6);
    const responsePromise = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/__fullstack_api/canvas/templates" && r.request().method() === "POST",
    );
    await page.getByTestId("tpladmin-create").click();
    await expect(page.getByTestId("tpladmin-create-dialog")).toBeVisible();
    await page.getByTestId("tpladmin-create-name").fill(`贴纸裁切验收${paperSize} ${stamp}`);
    await page.getByTestId("tpladmin-create-submit").click();
    await responsePromise;
    await expect(page.getByTestId("tpladmin-editor-panel")).toBeVisible();

    // 切纸张——`defaultLayoutAt` 的 h=3（列表型默认高）是这次要盯的"偏矮常见区块"，
    // 不手动调宽高，就是要用这个默认值（挑一个更高的区块反而绕开了要测的边界）。
    await page.getByTestId(`tpladmin-editor-papersize-${paperSize}`).click();

    await page.getByTestId("tpladmin-editor-new-key").fill("items");
    await page.getByTestId("tpladmin-editor-new-name").fill("条目");
    await page.getByTestId("tpladmin-editor-new-add").click();
    const field = page.getByTestId("tpladmin-editor-field-items");
    await expect(field).toBeVisible();

    const canvasEl = page.getByTestId("tpladmin-editor-canvas");
    const box = (await canvasEl.boundingBox())!;
    // 落在左上区域，同 `canvas-template-library-design.spec.ts` 既有的落点纪律
    // （默认中心点可能落进 `fits===0` 的位置，见该文件的详细注释）。
    await field.dragTo(canvasEl, { targetPosition: { x: box.width * 0.15, y: box.height * 0.2 } });
    const block = page.locator('[data-testid^="tpladmin-editor-block-"]').first();
    await expect(block).toBeVisible();

    // 试运行填够多条数据，逼近/超过这块地方的物理容量——这正是"最后一行被切"最容易
    // 复现的边界（容量算多了，超出来的那一行才会露馅；条数不够多，公式即使算错也
    // 表现不出来）。长短混合，同时压字数与压条数两个维度。
    await page.getByTestId("tpladmin-editor-dryrun-toggle").click();
    await expect(page.getByTestId("tpladmin-editor-dryrun-drawer")).toBeVisible();
    const items = Array.from({ length: 12 }, (_, i) =>
      i % 3 === 0 ? `条目 ${i + 1}：一段稍微长一点的示例文字用来撑满贴纸的宽度和高度` : `条目 ${i + 1}`);
    await page.getByTestId("tpladmin-editor-dryrun-input").fill(JSON.stringify({ items }));
    await page.getByTestId("tpladmin-editor-dryrun-run").click();
    await expect(block).toContainText("条目 1");

    for (const viewport of [{ width: 900, height: 800 }, { width: 1920, height: 1080 }] as const) {
      await page.setViewportSize(viewport);
      // 视口变了，等一帧布局稳定，再量。
      await page.waitForTimeout(150);
      const clipped = await findClippedNotes(page);
      expect(
        clipped,
        `${paperSize} 纸、视口 ${viewport.width}×${viewport.height} 下，这些贴纸被外层容器裁掉了一部分（getBoundingClientRect().bottom 超出贴纸网格容器）：${JSON.stringify(clipped)}`,
      ).toEqual([]);
    }

    expect(failures).toEqual([]);
  });
}
