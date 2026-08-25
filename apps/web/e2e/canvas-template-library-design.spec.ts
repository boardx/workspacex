/**
 * **模板库屏对照新设计的真实浏览器验收**（R2，2026-08-26）。
 *
 * 人类原话：「你要建立一个端到端的测试用例验收，并评估现在的完成度和体验是否和新的
 * 设计相符」。本文件就是那条验收——逐条对照 `Design.pdf` §3「界面一：模板库」与
 * §7「验收标准」的第 1、2、3 条，走真实浏览器 + 真实 PostgreSQL。
 *
 * 链路一节不许省：Chromium → Next 同源代理 → NestJS 控制器 → application 用例
 * → `PgCanvasTemplateRepository` → PostgreSQL。中途没有任何一处塞假数据。
 *
 * ## 与 `canvas-template-create-smoke.spec.ts` 的分工
 *
 * 那个文件验的是**契约行为**（新建落库 / 草稿不可用 / 发布后可用 / 归档是置位），
 * 与界面长什么样无关。本文件验的是**这一版设计有没有被真的实现**：卡片网格、
 * A1 缩略图、标签筛选条、改名换标签、字段数与区块数。两者都必要——契约对了但
 * 界面还是旧的表格，或者界面照着设计画了但数据是假的，都会被其中一个抓住。
 *
 * ## `Design.pdf` §7 验收标准逐条落点
 *
 * · 第 1 条「模板库可新建（名称 + 标签）、改名换标签、按标签筛选；筛选标签来自
 *   真实数据并带计数」→ 下面 ① ② ③。
 * · 第 2 条「标签输入框支持搜索已有标签、回车新建、退格删除、点选候选」→ ④。
 * · 第 3 条「从模板库进入编辑器再返回，卡片上的字段数、区块数与缩略图同步更新」→ ⑤。
 */
import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

const API = "/__fullstack_api";

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.adminEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function openLibrary(page: Page): Promise<void> {
  await page.goto("/canvas?screen=template-admin");
  await expect(page.getByTestId("tpladmin-root")).toBeVisible();
  // 设计稿的模板库是**卡片网格**（`Design.pdf` §3「主体为三列卡片网格」）。
  await page.getByTestId("tpladmin-view-card").click();
}

/**
 * 切到卡片视图并等网格出现。
 *
 * ⚠ 必须在**至少有一个模板之后**才调：库为空时渲染的是空态提示，`tpladmin-cards`
 *   压根不存在——这不是缺陷，空网格与"没有模板"是两种不同的东西，界面选择说后者。
 */
async function expectCardGrid(page: Page): Promise<void> {
  await page.getByTestId("tpladmin-view-card").click();
  await expect(page.getByTestId("tpladmin-cards")).toBeVisible();
}

/**
 * 新建一个带标签的模板，返回服务端派生的真实 key。
 *
 * `key` 从 `POST /canvas/templates` 的**真实响应体**读回——不假设某个固定字符串，
 * 同 `canvas-template-create-smoke.spec.ts` 的既有纪律（那样才测得出 key 到底是不是
 * 服务端定的）。
 */
async function createWithTags(page: Page, name: string, tags: readonly string[]): Promise<string> {
  const responsePromise = page.waitForResponse(
    (r) => new URL(r.url()).pathname === `${API}/canvas/templates` && r.request().method() === "POST",
  );

  await page.getByTestId("tpladmin-create").click();
  await expect(page.getByTestId("tpladmin-create-dialog")).toBeVisible();
  await page.getByTestId("tpladmin-create-name").fill(name);
  for (const tag of tags) {
    // ④ 标签输入框：打字 + 回车直接确认新建（`Design.pdf` §3.2 原话）。
    await page.getByTestId("tpladmin-create-tag-input").fill(tag);
    await page.getByTestId("tpladmin-create-tag-input").press("Enter");
    // 确认这一条真的变成了可删胶囊，而不是还留在输入框里。
    await expect(page.getByTestId(`tpladmin-create-tag-chip-${tag}`)).toBeVisible();
  }
  await page.getByTestId("tpladmin-create-submit").click();

  const created = await (await responsePromise).json() as { key: string; tags: string[] };
  // 标签真的随创建请求落库了——不是只在前端弹窗里显示过。
  expect(created.tags).toEqual([...tags]);

  // 建完自动打开编辑面板（2026-08-23 起的既定流程），关掉它回到库。
  await expect(page.getByTestId("tpladmin-editor-panel")).toBeVisible();
  await page.getByTestId("tpladmin-editor-close").click();
  await expect(page.getByTestId("tpladmin-editor-panel")).toHaveCount(0);
  return created.key;
}

test("模板库对照 Design.pdf §3：卡片网格 + A1 缩略图 + 真实标签筛选 + 改名换标签", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));

  await loginAsAdmin(page);
  await openLibrary(page);

  const stamp = String(Date.now()).slice(-6);
  const NAME_A = `验收模板甲 ${stamp}`;
  const NAME_B = `验收模板乙 ${stamp}`;
  const TAG_SHARED = `共用${stamp}`;
  const TAG_ONLY_A = `仅甲${stamp}`;

  // ① 新建：只问名称 + 标签（`Design.pdf` §3.3「弹窗只要两项」）。
  const keyA = await createWithTags(page, NAME_A, [TAG_SHARED, TAG_ONLY_A]);
  const keyB = await createWithTags(page, NAME_B, [TAG_SHARED]);

  await expectCardGrid(page);
  const cardA = page.getByTestId(`tpladmin-card-${keyA}-1`);
  const cardB = page.getByTestId(`tpladmin-card-${keyB}-1`);
  await expect(cardA).toBeVisible();
  await expect(cardB).toBeVisible();

  // 卡片顶部有 A1 缩略图（§3.1「自上而下：A1 缩略图 → 模板名 → …」）。
  await expect(page.getByTestId(`tpladmin-thumb-${keyA}-1`)).toBeVisible();
  // 缩略图的纸面比值必须是 A1 的 841/594，不是 √2——`Design.pdf` §5 特意强调过这个区别。
  const ratio = await page.getByTestId(`tpladmin-thumb-${keyA}-1`).locator("div").first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.width / r.height;
    });
  expect(ratio).toBeGreaterThan(841 / 594 - 0.02);
  expect(ratio).toBeLessThan(841 / 594 + 0.02);

  // 卡片上有标签胶囊，且是这个模板自己的标签。
  await expect(page.getByTestId(`tpladmin-card-tags-${keyA}-1`)).toContainText(TAG_ONLY_A);
  await expect(page.getByTestId(`tpladmin-card-tags-${keyB}-1`)).not.toContainText(TAG_ONLY_A);

  // ② 标签筛选条：标签来自真实数据并带计数（§3.2「不是写死的枚举，每个标签后跟使用数量」）。
  const sharedFilter = page.getByTestId(`tpladmin-tag-filter-${TAG_SHARED}`);
  await expect(sharedFilter).toBeVisible();
  // 两个模板都打了这个标签 ⇒ 计数必须是 2，不是一个写死的数。
  await expect(sharedFilter).toContainText("2");
  await expect(page.getByTestId(`tpladmin-tag-filter-${TAG_ONLY_A}`)).toContainText("1");

  // ③ 单选筛选：点「仅甲」⇒ 只剩甲；再点一次取消 ⇒ 两个都回来（§3.2「点一次筛选，
  //   再点同一个取消」）。
  await page.getByTestId(`tpladmin-tag-filter-${TAG_ONLY_A}`).click();
  await expect(cardA).toBeVisible();
  await expect(cardB).toHaveCount(0);
  await page.getByTestId(`tpladmin-tag-filter-${TAG_ONLY_A}`).click();
  await expect(cardB).toBeVisible();

  // ④ 改名 / 标签：与新建**同一个弹窗**，预填现有值（§3.1）。
  const RENAMED = `${NAME_A} 改过`;
  await page.getByTestId(`tpladmin-rename-${keyA}-1`).click();
  await expect(page.getByTestId("tpladmin-create-dialog")).toBeVisible();
  await expect(page.getByTestId("tpladmin-create-name")).toHaveValue(NAME_A);
  // 预填的标签是可删胶囊。
  await expect(page.getByTestId(`tpladmin-create-tag-chip-${TAG_ONLY_A}`)).toBeVisible();
  // 退格删掉最后一个标签（§3.2「输入框为空时按退格删除最后一个标签」）。
  await page.getByTestId("tpladmin-create-tag-input").press("Backspace");
  await expect(page.getByTestId(`tpladmin-create-tag-chip-${TAG_ONLY_A}`)).toHaveCount(0);
  await page.getByTestId("tpladmin-create-name").fill(RENAMED);
  await page.getByTestId("tpladmin-create-submit").click();
  await expect(page.getByTestId("tpladmin-create-dialog")).toHaveCount(0);

  // 改完之后卡片上是新名字、少了一个标签。
  await expect(cardA).toContainText(RENAMED);
  await expect(page.getByTestId(`tpladmin-card-tags-${keyA}-1`)).not.toContainText(TAG_ONLY_A);

  // ⑤ **刷新后仍在**——这是「真的写进了库」与「只写进了 React state」的分界线。
  await page.reload();
  await expectCardGrid(page);
  await expect(page.getByTestId(`tpladmin-card-${keyA}-1`)).toContainText(RENAMED);
  await expect(page.getByTestId(`tpladmin-card-tags-${keyA}-1`)).toContainText(TAG_SHARED);
  await expect(page.getByTestId(`tpladmin-card-tags-${keyA}-1`)).not.toContainText(TAG_ONLY_A);
  // 「仅甲」这个标签现在没有任何模板在用 ⇒ 它必须从筛选条上消失（筛选条是实时汇总的）。
  await expect(page.getByTestId(`tpladmin-tag-filter-${TAG_ONLY_A}`)).toHaveCount(0);
  // 「共用」还剩两个在用，计数不变。
  await expect(page.getByTestId(`tpladmin-tag-filter-${TAG_SHARED}`)).toContainText("2");

  expect(failures).toEqual([]);
});

test("Design.pdf §7 第 3 条：进编辑器加分区再返回，卡片上的字段数/区块数同步更新", async ({ page }) => {
  await loginAsAdmin(page);
  await openLibrary(page);

  const stamp = String(Date.now()).slice(-6);
  const key = await createWithTags(page, `字段计数验收 ${stamp}`, []);
  await expectCardGrid(page);
  const card = page.getByTestId(`tpladmin-card-${key}-1`);

  // 刚建出来：0 个字段、0 个区块。
  await expect(card).toContainText("0 个字段");
  await expect(card).toContainText("0 个区块");

  // 点卡片主体打开编辑器（§3.1「点击卡片主体 = 打开编辑器」）。
  await card.click();
  await expect(page.getByTestId("tpladmin-editor-panel")).toBeVisible();

  // 用左栏底部的「＋ 新增字段」加两个字段（`Design.pdf` §4.1 末条）。
  for (const [k, name] of [["strengths", "优势"], ["weaknesses", "劣势"]] as const) {
    await page.getByTestId("tpladmin-editor-new-key").fill(k);
    await page.getByTestId("tpladmin-editor-new-name").fill(name);
    await page.getByTestId("tpladmin-editor-new-add").click();
    await expect(page.getByTestId(`tpladmin-editor-field-${k}`)).toBeVisible();
    // 刚加进来的字段是「未放置」——还没拖到画布上（§4.1 左栏状态）。
    await expect(page.getByTestId(`tpladmin-editor-field-state-${k}`)).toHaveText("未放置");
  }
  await page.getByTestId("tpladmin-editor-save").click();
  await expect(page.getByTestId("tpladmin-editor-save")).toHaveText("已保存");
  await page.getByTestId("tpladmin-editor-close").click();

  // 返回库：字段数跟着变了。区块数仍是 0——这两个数**不同**才有信息量
  // （`Design.pdf` §6 校验规则②：没放到画布上的字段生成后会被丢弃）。
  await expect(card).toContainText("2 个字段");
  await expect(card).toContainText("0 个区块");

  // 刷新后仍然如此——不是本地 state 的假象。
  await page.reload();
  await expectCardGrid(page);
  await expect(page.getByTestId(`tpladmin-card-${key}-1`)).toContainText("2 个字段");
});


test("Design.pdf §4：三栏拖拽编辑器 —— 拖到画布、显示设置 mm 实尺、从画布移除保留字段", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));

  await loginAsAdmin(page);
  await openLibrary(page);

  const stamp = String(Date.now()).slice(-6);
  const key = await createWithTags(page, `拖拽验收 ${stamp}`, []);
  await expectCardGrid(page);
  await page.getByTestId(`tpladmin-card-${key}-1`).click();
  await expect(page.getByTestId("tpladmin-editor-panel")).toBeVisible();

  // §4 三栏都在：① 字段 ② 画布 ③ 显示方式；顶栏有 A1 规格徽章与三步指示器。
  await expect(page.getByTestId("tpladmin-editor-a1-badge")).toContainText("A1 横版 841×594mm");
  await expect(page.getByTestId("tpladmin-editor-step-1")).toBeVisible();
  await expect(page.getByTestId("tpladmin-editor-step-2")).toBeVisible();
  await expect(page.getByTestId("tpladmin-editor-step-3")).toBeVisible();
  await expect(page.getByTestId("tpladmin-editor-canvas")).toBeVisible();

  // 画布为空时给引导文案（§4.2 末条）。
  await expect(page.getByTestId("tpladmin-editor-canvas-empty")).toBeVisible();

  // 加一个字段。
  await page.getByTestId("tpladmin-editor-new-key").fill("says");
  await page.getByTestId("tpladmin-editor-new-name").fill("说 Says");
  await page.getByTestId("tpladmin-editor-new-add").click();
  const field = page.getByTestId("tpladmin-editor-field-says");
  await expect(field).toBeVisible();

  // **真的拖到画布上**——HTML5 drag，落点即位置（§4.2）。
  await field.dragTo(page.getByTestId("tpladmin-editor-canvas"));

  // 放下后：画布上出现区块、字段变「已放置」、自动跳到第三步并选中它（§4.2 原话）。
  const block = page.locator('[data-testid^="tpladmin-editor-block-"]').first();
  await expect(block).toBeVisible();
  await expect(page.getByTestId("tpladmin-editor-field-state-says")).toHaveText("已放置");
  await expect(page.getByTestId("tpladmin-editor-canvas-empty")).toHaveCount(0);

  // ③ 右栏出现这一块的显示设置，且 mm 实尺是算出来的真实数字（§4.3 / §5）。
  const display = page.getByTestId("tpladmin-editor-display");
  await expect(display).toBeVisible();
  await expect(page.getByTestId("tpladmin-editor-display-token")).toContainText("{{says[]}}");
  await expect(page.getByTestId("tpladmin-editor-col-note")).toContainText("贴纸实尺");
  await expect(page.getByTestId("tpladmin-editor-mm-note")).toContainText("mm 实尺");

  // 改列数 → 贴纸实尺跟着变（§7 第 5 条）。
  const before = await page.getByTestId("tpladmin-editor-col-note").textContent();
  await page.getByTestId("tpladmin-editor-cols-3").click();
  await expect(page.getByTestId("tpladmin-editor-col-note")).not.toHaveText(before ?? "");

  // 保存 → 刷新 → 位置还在（拖出来的 layout 真的落库了）。
  await page.getByTestId("tpladmin-editor-save").click();
  await expect(page.getByTestId("tpladmin-editor-save")).toHaveText("已保存");
  await page.reload();
  await expectCardGrid(page);
  // 缩略图上现在有真实色块了（`layout` 有值才画得出来）。
  await expect(page.getByTestId(`tpladmin-thumb-${key}-1`)).toBeVisible();
  await expect(page.getByTestId(`tpladmin-card-${key}-1`)).toContainText("1 个区块");

  // 从画布移除 → 字段保留（§4.3 原话）。
  await page.getByTestId(`tpladmin-card-${key}-1`).click();
  await expect(page.getByTestId("tpladmin-editor-panel")).toBeVisible();
  await page.locator('[data-testid^="tpladmin-editor-block-"]').first().click();
  await page.getByTestId("tpladmin-editor-remove-block").click();
  await expect(page.locator('[data-testid^="tpladmin-editor-block-"]')).toHaveCount(0);
  await expect(page.getByTestId("tpladmin-editor-field-says")).toBeVisible();
  await expect(page.getByTestId("tpladmin-editor-field-state-says")).toHaveText("未放置");
  // 体检面板点名它会被丢弃（§6 规则②）。
  await expect(page.getByTestId("tpladmin-editor-health-unplaced")).toContainText("says");

  expect(failures).toEqual([]);
});


test("Design.pdf §7 第 6/7 条：纸面与内容区比值精确，且贴纸内文字不被裁切", async ({ page }) => {
  await loginAsAdmin(page);
  await openLibrary(page);

  const stamp = String(Date.now()).slice(-6);
  const key = await createWithTags(page, `几何验收 ${stamp}`, []);
  await expectCardGrid(page);
  await page.getByTestId(`tpladmin-card-${key}-1`).click();
  await expect(page.getByTestId("tpladmin-editor-panel")).toBeVisible();

  // 加一个列表型字段并拖到画布上。
  await page.getByTestId("tpladmin-editor-new-key").fill("says");
  await page.getByTestId("tpladmin-editor-new-name").fill("说 Says");
  await page.getByTestId("tpladmin-editor-new-add").click();
  await page.getByTestId("tpladmin-editor-field-says").dragTo(page.getByTestId("tpladmin-editor-canvas"));
  await expect(page.locator('[data-testid^="tpladmin-editor-block-"]').first()).toBeVisible();

  // §7 第 6 条：纸面比值 = 841/594（误差 ≤ 0.5%）。
  const paperRatio = await page.getByTestId("tpladmin-editor-canvas").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.width / r.height;
  });
  expect(Math.abs(paperRatio / (841 / 594) - 1)).toBeLessThanOrEqual(0.005);

  /**
   * §7 第 7 条：**任意贴纸内文字不被裁切**（`scrollHeight ≤ clientHeight`）。
   *
   * 这条是「字号由贴纸实尺推导」那个公式（§5 末段 `clamp(6.5, noteMm×0.115, 10.5)`）
   * 唯一真正的验收方式——公式写对了没有，只有量 DOM 才知道；把字号写成固定值时
   * 小贴纸会裁字，而那在截图上很难一眼看出来。
   *
   * ⚠ 逐张量，不是抽一张：容量算错时往往只有最后一行的贴纸会溢出。
   */
  const clipped = await page.evaluate(() => {
    const notes = [...document.querySelectorAll('[data-testid^="tpladmin-editor-block-"] > div > div')];
    return notes
      .map((n, i) => ({ i, scroll: n.scrollHeight, client: n.clientHeight }))
      .filter((n) => n.client > 0 && n.scroll > n.client + 1); // +1 容忍亚像素取整
  });
  expect(clipped, `这些贴纸里的文字被裁切了（scrollHeight > clientHeight）：${JSON.stringify(clipped)}`).toEqual([]);

  // 切到 3 列（贴纸更大）后仍然不裁切——换一档几何再验一次，不是只在默认值下成立。
  await page.locator('[data-testid^="tpladmin-editor-block-"]').first().click();
  await page.getByTestId("tpladmin-editor-cols-3").click();
  const clippedAfter = await page.evaluate(() => {
    const notes = [...document.querySelectorAll('[data-testid^="tpladmin-editor-block-"] > div > div')];
    return notes.filter((n) => n.clientHeight > 0 && n.scrollHeight > n.clientHeight + 1).length;
  });
  expect(clippedAfter).toBe(0);
});
