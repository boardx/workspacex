/**
 * 🟡 #496 —— 核心闭环第 4 步「**新增**可视化模板」的**真实浏览器**门控。
 *
 * 该契约面（`createTemplate`）**待人类补签**：2026-08-04 coord-main 在人类不在场时代裁
 * 「先做」并登记为 design-delta，见 `packages/contracts/src/canvas.ts` 的 `createTemplate`
 * 文件头。人类若推翻它，本文件与它验的那条路径一并回退。
 *
 * 链路一节不许省：Chromium → Next 同源代理 → NestJS 控制器 → application 用例
 * → `PgCanvasTemplateRepository` → PostgreSQL。中途没有任何一处塞假数据。
 *
 * ## 这里证明的四件事，别处证不了
 *
 * ① **「刷新后仍在」**。组件测试里的「刷新」只是再调一次 fetch mock；只有真的重新加载
 *    页面，才能区分「写进了库」和「写进了 React state」。
 * ② **新建 ≠ 可用**。建出来的是**草稿**：它不在「已发布」筛选里，直到发布为止。
 *    少了这条，`createTemplate` 可以被实现成绕开已签核的三段发布流程而所有断言照绿。
 * ③ **发布之后它真的能被用**。发布后它出现在已发布清单里，且**刷新后仍是已发布**。
 * ④ **归档语义不变**（O-10）：归档是置位不是删除 —— 归档后它仍在「已归档」筛选里
 *    查得到、能恢复，而不是从库里消失。
 *
 * ## ⚠ 反证是一条**常驻用例**，不是一次手工实验
 *
 * 下面第二个 test 把创建请求**在浏览器里截掉**，换成一个不落库的假 201。链路只少了
 * 「后端真的写了一行」这一段，其余全同。此时刷新后那一行必须**不在**——若它还在，
 * 说明上面第①条断言根本没在验持久化（本仓已九次「全绿但空转」）。
 * 把反证写成常驻用例，是因为一次手工实验只能证明**当天**它不空转。
 *
 * ⚠ 单独成文件而不是并进 `fullstack-smoke.spec.ts`：那个文件的每一条 `page.goto`
 *   都被 `.harness/scripts/fullstack-smoke.test.ts` 按出现次数钉死（#387 的反空转手段）。
 *   本文件与 #387 / #458 共用同一套 webServer 与同一个库，串行执行。
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

const API = "/__fullstack_api";
const CREATE_PATH = `${API}/canvas/templates`;

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.adminEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

/** 只记 `POST /canvas/templates` 的状态码；GET 列表不进这个数组。 */
function recordCreates(page: Page): number[] {
  const codes: number[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname === CREATE_PATH && response.request().method() === "POST") {
      codes.push(response.status());
    }
  });
  return codes;
}

async function openTemplateAdmin(page: Page) {
  await page.goto("/canvas?screen=template-admin");
  await expect(page.getByTestId("tpladmin-root")).toBeVisible();
}

async function fillCreateForm(page: Page, key: string, name: string) {
  await page.getByTestId("tpladmin-create").click();
  await expect(page.getByTestId("tpladmin-create-dialog")).toBeVisible();
  await page.getByTestId("tpladmin-create-key").fill(key);
  await page.getByTestId("tpladmin-create-name").fill(name);
  await page.getByTestId("tpladmin-create-section-0").fill("优势");
  await page.getByTestId("tpladmin-create-submit").click();
}

test("admin creates a canvas template in the browser; PostgreSQL keeps it across reloads, and publishing makes it usable", async ({ page }) => {
  const failures: string[] = [];
  const creates = recordCreates(page);
  page.on("console", (m) => {
    if (m.type() === "error") failures.push(`console error: ${m.text()}`);
  });
  page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));

  const { canvasTemplateKey: KEY, canvasTemplateName: NAME } = FULLSTACK_E2E;

  await loginAsAdmin(page);
  await openTemplateAdmin(page);

  // 种子刻意没有预置任何模板行——空态是这条链路的真实起点，
  // 也是「后面看到的那一行确实是这次建出来的」的前提。
  await expect(page.getByTestId("tpladmin-empty")).toBeVisible();

  // ── ① 新建 ───────────────────────────────────────────────────────────────
  await fillCreateForm(page, KEY, NAME);

  const row = page.getByTestId(`tpladmin-row-${KEY}-1`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(NAME);
  // 201，不是 200：这条路由真的造出了一行资源（其余四条模板路由都是 200 的状态转移）。
  expect(creates).toEqual([201]);

  // ── ② 建出来的是草稿，还不能用 ──────────────────────────────────────────
  await expect(row).toContainText("草稿");
  await page.getByTestId("tpladmin-filter-published").click();
  await expect(page.getByTestId(`tpladmin-row-${KEY}-1`)).toHaveCount(0);
  await page.getByTestId("tpladmin-filter-all").click();

  // ── ③ 刷新后仍在 = 它在库里，不在 React state 里 ────────────────────────
  await page.reload();
  await expect(page.getByTestId(`tpladmin-row-${KEY}-1`)).toBeVisible();
  await expect(page.getByTestId("tpladmin-empty")).toHaveCount(0);
  // 刷新没有再发一次创建请求——那一行来自 GET，不是重放。
  expect(creates).toEqual([201]);

  // ── ④ 发布 → 可被使用 ───────────────────────────────────────────────────
  await page.getByTestId(`tpladmin-publish-${KEY}-1`).click();
  await expect(page.getByTestId(`tpladmin-row-${KEY}-1`)).toContainText("已发布");

  await page.getByTestId("tpladmin-filter-published").click();
  await expect(page.getByTestId(`tpladmin-row-${KEY}-1`)).toBeVisible();

  // 发布也是持久的，不是屏上一次乐观更新。
  await page.reload();
  await page.getByTestId("tpladmin-filter-published").click();
  await expect(page.getByTestId(`tpladmin-row-${KEY}-1`)).toContainText("已发布");

  // ── ⑤ 归档语义不变（O-10）：置位，不是删除 ──────────────────────────────
  await page.getByTestId("tpladmin-filter-all").click();
  await page.getByTestId(`tpladmin-archive-${KEY}-1`).click();
  await expect(page.getByTestId("tpladmin-archive-dialog")).toBeVisible();
  // 影响面那个数来自服务端 `confirmed:false` 的真实预检。
  await expect(page.getByTestId("tpladmin-archive-impact")).toContainText("0");
  await page.getByTestId("tpladmin-archive-confirm").click();

  await page.getByTestId("tpladmin-filter-archived").click();
  // 归档后它**还在**——查得到、能恢复。删除的话这里会是空的。
  await expect(page.getByTestId(`tpladmin-row-${KEY}-1`)).toContainText("已归档");
  await page.getByTestId(`tpladmin-restore-${KEY}-1`).click();
  await page.getByTestId("tpladmin-filter-published").click();
  await expect(page.getByTestId(`tpladmin-row-${KEY}-1`)).toContainText("已发布");

  expect(failures).toEqual([]);
});

/**
 * 🔴 反证（常驻）：把创建的**后端调用摘掉**，上面那条「刷新后仍在」必须当场失效。
 *
 * 做法是在浏览器里拦截 `POST /canvas/templates`，用一个形状完全合法、但**没有落库**的
 * 201 顶替它。界面收到的东西与真实成功一模一样，于是它会照常显示出那一行——
 * 这正是「写进 React state 就以为成了」的形状。刷新之后真相才出现。
 *
 * ⚠ 断言写成「刷新后**不在**」，而不是 `test.fail()`：后者只知道整条用例红了，
 *   不知道它是不是因为对的原因红的（比如登录挂了也会红）。这里逐条检查：
 *   拦截确实发生过、界面确实一度显示了那一行、刷新后它确实不在、且**库里本来就没有**
 *   （用真实 GET 列表复核，不只看界面）。
 */
test("counterproof: with the create request stubbed out in the browser, the row does not survive a reload", async ({ page }) => {
  const {
    canvasTemplateCounterproofKey: KEY,
    canvasTemplateCounterproofName: NAME,
  } = FULLSTACK_E2E;

  let intercepted = 0;
  await page.route(`**${CREATE_PATH}`, async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    intercepted += 1;
    // 契约 `createTemplate.out` 的合法形状，只是从来没有到过服务端。
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        key: KEY,
        displayName: NAME,
        version: 1,
        status: "draft",
        builtin: false,
        visibility: "org-wide",
        underlyingType: "canvas",
        sections: [{ sectionId: "s1", name: "优势", order: 0, required: false, capacity: null }],
      }),
    });
  });

  await loginAsAdmin(page);
  await openTemplateAdmin(page);
  await fillCreateForm(page, KEY, NAME);

  // 拦截真的发生了——否则下面的「刷新后不在」可能只是因为这次根本没建。
  expect(intercepted).toBe(1);

  // 界面一度显示成功：`notice` 是提交成功后才出现的。
  await expect(page.getByTestId("tpladmin-notice")).toContainText(NAME);

  // ⚠ 关键：这一行从来没进过库。刷新之后它不在。
  await page.reload();
  await expect(page.getByTestId("tpladmin-root")).toBeVisible();

  // ⚠ 先证明这次列表**真的读成功了**，再说「那一行不在」。
  //   少了这两条，一次读取失败会让「不在」恒成立，反证就变成了它自己要防的空转：
  //   屏上什么都没有，而断言全绿。
  await expect(page.getByTestId("tpladmin-loading")).toHaveCount(0);
  await expect(page.getByTestId("tpladmin-error")).toHaveCount(0);

  await expect(page.getByTestId(`tpladmin-row-${KEY}-1`)).toHaveCount(0);
  await expect(page.getByText(NAME)).toHaveCount(0);
});
