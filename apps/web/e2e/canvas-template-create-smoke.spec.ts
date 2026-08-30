/**
 * 🟡 #496 —— 核心闭环第 4 步「**新增**可视化模板」的**真实浏览器**门控。
 *
 * 该契约面（`createTemplate`）**待人类补签**：2026-08-04 coord-main 在人类不在场时代裁
 * 「先做」并登记为 design-delta，见 `packages/contracts/src/canvas.ts` 的 `createTemplate`
 * 文件头。人类若推翻它，本文件与它验的那条路径一并回退。
 *
 * ⚠ 2026-08-23 改版：人类原话「新建画布，的时候，不要在这里放分区设计，也不要放key，
 *   只需要一个名字就可以，需要发布的生命周期的管理，所有的内容进入编辑的界面来管理」。
 *   `fillCreateForm` 因此不再手填 key/分区——只填显示名，建完自动打开
 *   `TemplateEditorPanel`，分区在那个面板里加、`updateTemplateDraft`（同样 design-delta，
 *   待补签）落库，`key` 由服务端返回的真实值决定，测试从这次真实响应里**读回**它，
 *   不再假设某个固定字符串。
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
  await page.goto("/canvas/template-admin?view=list");
  await expect(page.getByTestId("tpladmin-root")).toBeVisible();
}

/**
 * 2026-08-23 起，「新建」只问显示名——`key` 由服务端从显示名派生（`createMinimal`
 * 的自动生成逻辑，撞车会自动重试），前端事先不知道最终值是什么。这里从
 * `POST /canvas/templates` 的**真实响应体**里读回它，而不是假设一个固定字符串——
 * 假设固定字符串会让「key 到底是不是服务端定的」这件事测不出来。
 *
 * 建完会自动打开 `TemplateEditorPanel`（空白草稿），这里在面板里加一个分区、保存，
 * 再关掉面板回到列表——分区在「编辑界面」里定，不是在新建对话框里。
 */
async function fillCreateForm(page: Page, name: string): Promise<string> {
  const responsePromise = page.waitForResponse(
    (r) => new URL(r.url()).pathname === CREATE_PATH && r.request().method() === "POST",
  );

  await page.getByTestId("tpladmin-create").click();
  await expect(page.getByTestId("tpladmin-create-dialog")).toBeVisible();
  await page.getByTestId("tpladmin-create-name").fill(name);
  await page.getByTestId("tpladmin-create-submit").click();

  const response = await responsePromise;
  const created = await response.json() as { key: string };

  await expect(page.getByTestId("tpladmin-editor-panel")).toBeVisible();
  // R3 起编辑器顶栏是面包屑标题（显示名的编辑入口搬到了模板库的「改名 / 标签」弹窗，
  // 见 `Design.pdf` §3.1「保存只改元数据，不动字段与画布」）。
  await expect(page.getByTestId("tpladmin-editor-title")).toContainText(name);
  // 加分区 = 左栏底部常驻的「＋ 新增字段」（§4.1 末条）。
  await page.getByTestId("tpladmin-editor-new-key").fill("strengths");
  await page.getByTestId("tpladmin-editor-new-name").fill("优势");
  await page.getByTestId("tpladmin-editor-new-add").click();
  await page.getByTestId("tpladmin-editor-save").click();
  // 保存按钮的文案在 `updateTemplateDraft` 落库后从「保存改动」变回「已保存」——
  // 用它做「这次保存真的完成了」的信号，同 #952 那条「等 notice 而不是固定 sleep」的纪律。
  await expect(page.getByTestId("tpladmin-editor-save")).toHaveText("已保存");
  await page.getByTestId("tpladmin-editor-close").click();
  await expect(page.getByTestId("tpladmin-editor-panel")).toHaveCount(0);

  return created.key;
}

/**
 * #952：publish / archive / restore 在组件里都是「mutation 落库 → `setNotice`
 * → 再 `await load()` 刷新当前筛选」。点完动作按钮到 `tpladmin-notice` 出现
 * 这句话之间，mutation 才真正落了库；notice 的文案在 mutation 的 fetch resolve
 * 之后才会 set，因此它是唯一能在浏览器里观察到的「后端已提交」信号。
 *
 * 之前的写法是点完 publish/archive/restore 按钮就立刻切过滤器 tab——那一次点击
 * 触发的是它自己独立的一次 GET，如果这次 GET 跟尚未落库的 mutation 赛跑赢了，
 * 切换后的筛选列表里就不会带上新状态，行断言会在默认超时后 element not found。
 * 这里不是加个固定 sleep，而是等一个真实会变化的状态信号：等 mutation 自己回填的
 * `tpladmin-notice` 文案出现，再去切筛选器/断言行状态。
 */
async function waitForNotice(page: Page, substring: string) {
  await expect(page.getByTestId("tpladmin-notice")).toContainText(substring);
}

/**
 * #1936 CI 复盘（`fullstack-smoke` run 32670321400 job 97270083136）：切换筛选 tab
 * 之后立刻 `page.reload()` 是竞态，不是 sleep 能补的坑——`TemplateAdmin` 里点击
 * 筛选按钮会同步更新 React state（tab 立刻显示选中），但地址栏 query string 是
 * `router.replace` 异步写回的（见 `components/canvas/template-admin.tsx` 里
 * `syncUrl`）；`reload()` 读的是**浏览器真实地址栏**，不是 React state。点击后不等
 * URL 真的落定就刷新，命中的窗口期里地址栏还停在刷新前那个筛选值，服务端用旧
 * query 渲染出的初始筛选就会把这一行滤掉——本机高负载下第一次就能稳定复现，
 * CI 上则表现为偶发。同 #952 的纪律：等一个真实会变化的信号（这里是地址栏本身），
 * 不是固定 sleep。
 */
async function waitForFilterUrl(page: Page, filter: "all" | "published" | "draft" | "archived") {
  await page.waitForURL((url) =>
    filter === "all" ? !url.searchParams.has("filter") : url.searchParams.get("filter") === filter
  );
}

test("admin creates a canvas template in the browser; PostgreSQL keeps it across reloads, and publishing makes it usable", async ({ page }) => {
  const failures: string[] = [];
  const creates = recordCreates(page);
  page.on("console", (m) => {
    if (m.type() === "error") failures.push(`console error: ${m.text()}`);
  });
  page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));

  const { canvasTemplateName: NAME } = FULLSTACK_E2E;

  await loginAsAdmin(page);
  await openTemplateAdmin(page);

  // 种子刻意没有预置任何模板行——空态是这条链路的真实起点，
  // 也是「后面看到的那一行确实是这次建出来的」的前提。
  await expect(page.getByTestId("tpladmin-empty")).toBeVisible();

  // ── ① 新建（只填名字）+ 在编辑面板里加分区、保存 ────────────────────────────
  const KEY = await fillCreateForm(page, NAME);

  const row = page.getByTestId(`tpladmin-card-${KEY}-1`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(NAME);
  // 201，不是 200：这条路由真的造出了一行资源（其余四条模板路由都是 200 的状态转移）。
  expect(creates).toEqual([201]);

  // ── ② 建出来的是草稿，还不能用 ──────────────────────────────────────────
  await expect(row).toContainText("草稿");
  await page.getByTestId("tpladmin-filter-published").click();
  await expect(page.getByTestId(`tpladmin-card-${KEY}-1`)).toHaveCount(0);
  await page.getByTestId("tpladmin-filter-all").click();
  // 等地址栏真的落回「全部」（无 filter 参数）再刷新——见 waitForFilterUrl 上方注释。
  await waitForFilterUrl(page, "all");

  // ── ③ 刷新后仍在 = 它在库里，不在 React state 里；分区也真的存进去了 ────────
  await page.reload();
  await expect(page.getByTestId(`tpladmin-card-${KEY}-1`)).toBeVisible();
  await expect(page.getByTestId("tpladmin-empty")).toHaveCount(0);
  // 刷新没有再发一次创建请求——那一行来自 GET，不是重放。
  expect(creates).toEqual([201]);
  await page.getByTestId(`tpladmin-edit-${KEY}-1`).click();
  // 字段卡片在（key 对上）+ 卡片里那个中文名输入框的**值**是「优势」。
  // ⚠ 用 `toHaveValue` 而不是 `toContainText`：中文名在新编辑器里是可直接改的
  //   `<input>`，输入框的值不进 textContent，`toContainText` 永远看不到它。
  await expect(page.getByTestId("tpladmin-editor-field-strengths")).toBeVisible();
  await expect(page.getByTestId("tpladmin-editor-section-0")).toHaveValue("优势");
  await page.getByTestId("tpladmin-editor-close").click();

  // ── ④ 发布 → 可被使用 ───────────────────────────────────────────────────
  await page.getByTestId(`tpladmin-publish-${KEY}-1`).click();
  // #952：先等 publish 的 mutation 真正落库（notice 是它落库后才回填的信号），
  // 再切筛选器——否则切筛选器发出的 GET 可能赢过还没落库的 publish。
  await waitForNotice(page, "已发布");
  await expect(page.getByTestId(`tpladmin-card-${KEY}-1`)).toContainText("已发布");

  await page.getByTestId("tpladmin-filter-published").click();
  await expect(page.getByTestId(`tpladmin-card-${KEY}-1`)).toBeVisible();

  // 发布也是持久的，不是屏上一次乐观更新。
  await page.reload();
  await page.getByTestId("tpladmin-filter-published").click();
  await expect(page.getByTestId(`tpladmin-card-${KEY}-1`)).toContainText("已发布");

  // ── ⑤ 归档语义不变（O-10）：置位，不是删除 ──────────────────────────────
  await page.getByTestId("tpladmin-filter-all").click();
  await page.getByTestId(`tpladmin-archive-${KEY}-1`).click();
  await expect(page.getByTestId("tpladmin-archive-dialog")).toBeVisible();
  // 影响面那个数来自服务端 `confirmed:false` 的真实预检。
  await expect(page.getByTestId("tpladmin-archive-impact")).toContainText("0");
  await page.getByTestId("tpladmin-archive-confirm").click();
  // #952：同上，等归档 mutation 落库的 notice 信号，再切到「已归档」筛选。
  await waitForNotice(page, "已归档");

  await page.getByTestId("tpladmin-filter-archived").click();
  // 归档后它**还在**——查得到、能恢复。删除的话这里会是空的。
  await expect(page.getByTestId(`tpladmin-card-${KEY}-1`)).toContainText("已归档");
  await page.getByTestId(`tpladmin-restore-${KEY}-1`).click();
  // #952：restore 也是同一形状的竞态——等它自己的 notice 落库信号，
  // 再切到「已发布」筛选断言，而不是打完 restore 立刻切。
  await waitForNotice(page, "已恢复");
  await page.getByTestId("tpladmin-filter-published").click();
  await expect(page.getByTestId(`tpladmin-card-${KEY}-1`)).toContainText("已发布");

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
 *
 * ⚠ 这里拦截的响应体是测试**自己拼的**，`key` 用固定值没问题——它从来没有经过真实的
 *   `createMinimal` 派生逻辑，本来就是假的，断言的是「界面暂时显示了它、刷新后消失」，
 *   不依赖 key 具体是什么。
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
        sections: [],
      }),
    });
  });

  await loginAsAdmin(page);
  await openTemplateAdmin(page);

  await page.getByTestId("tpladmin-create").click();
  await expect(page.getByTestId("tpladmin-create-dialog")).toBeVisible();
  await page.getByTestId("tpladmin-create-name").fill(NAME);
  await page.getByTestId("tpladmin-create-submit").click();

  // 拦截真的发生了——否则下面的「刷新后不在」可能只是因为这次根本没建。
  expect(intercepted).toBe(1);

  // 界面一度显示成功：建完自动打开的编辑面板证明了这一点（草稿的 displayName 就是它）。
  await expect(page.getByTestId("tpladmin-editor-panel")).toBeVisible();
  await expect(page.getByTestId("tpladmin-editor-title")).toContainText(NAME);
  await page.getByTestId("tpladmin-editor-close").click();

  // ⚠ 关键：这一行从来没进过库。刷新之后它不在。
  await page.reload();
  await expect(page.getByTestId("tpladmin-root")).toBeVisible();

  // ⚠ 先证明这次列表**真的读成功了**，再说「那一行不在」。
  //   少了这两条，一次读取失败会让「不在」恒成立，反证就变成了它自己要防的空转：
  //   屏上什么都没有，而断言全绿。
  await expect(page.getByTestId("tpladmin-loading")).toHaveCount(0);
  await expect(page.getByTestId("tpladmin-error")).toHaveCount(0);

  await expect(page.getByTestId(`tpladmin-card-${KEY}-1`)).toHaveCount(0);
  await expect(page.getByText(NAME)).toHaveCount(0);
});

/**
 * 🟡 #988 / #1493 —— 「基于此开新版」（`mintTemplateVersion`）的**真实浏览器**门控。
 *
 * 端到端验收链「后台开新版 → chat 生成画像 → 编辑保存 → 重开」的后三步已由
 * `chat-diagram-save-reopen-roundtrip.spec.ts` 门控（#1541）；第一步此前只有 API 层
 * http 测试与组件测试——组件测试里的「列表刷新」只是再调一次 fetch mock，证不了
 * 「v2 写进了 PostgreSQL」。这条把最后一节补上：Chromium → Next 同源代理 → NestJS
 * `POST /canvas/templates/:key/versions` → `mintTemplateVersion` 用例 → PostgreSQL。
 *
 * ## 为什么来源模板现场建，而不是用种子里 #493 那条 published 模板
 *
 * `boundTemplateKey` 是 **team-only（归 fullstack 团队）**，本条用组织管理员登录，
 * 管理员不属于任何团队 ⇒ 那一行对他不可见（上面第一条 test 的空态断言正建立在
 * 这件事上）。往种子里塞一条 org-wide published 模板则会把那条反空转断言当场打红。
 * ⇒ 现场走 #496 已门控的「新建 → 发布」把来源造出来，再对它开新版——多走的两步
 * 都是本文件上面已经单独验过的路径，失败时归因不混。
 *
 * ## 断言清单
 * ① 草稿行**没有**「基于此开新版」按钮（签核裁决：仅非 draft 挂）——这是常驻反证；
 * ② 发布后按钮出现；对话框里 key 锁定（disabled 且值=来源 key）、显示名/分区名预填自来源；
 * ③ 改显示名与分区名提交 → 服务端真的回了 201（记录真实 POST，不信 UI）；
 * ④ 成功通知出现，且「草稿」筛选里有 v2 行、显示名与分区名是改过的，来源 v1 仍是已发布；
 * ⑤ **reload 后 v2 草稿行仍在**（写进了库，不是 React state）；
 * ⑥ v2 自己是 draft ⇒ 它同样没有「基于此开新版」按钮（反证在新行上再验一次）。
 */
test("admin mints a new draft version from a published template; the v2 draft survives a reload and draft rows expose no mint entry", async ({ page }) => {
  const { mintSourceName: SOURCE, mintedDisplayName: MINTED } = FULLSTACK_E2E;

  await loginAsAdmin(page);
  await openTemplateAdmin(page);

  // ── 前置：现场建出来源 v1 并发布（#496 已门控的两步，这里只当脚手架用）────────
  const KEY = await fillCreateForm(page, SOURCE);
  const MINT_PATH = `${API}/canvas/templates/${KEY}/versions`;

  // 只记「开新版」那条 POST 的状态码；创建/发布/GET 都不进这个数组。
  const mints: number[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname === MINT_PATH && response.request().method() === "POST") {
      mints.push(response.status());
    }
  });

  const sourceRow = page.getByTestId(`tpladmin-card-${KEY}-1`);
  await expect(sourceRow).toBeVisible();
  await expect(sourceRow).toContainText("草稿");

  // ── ① 常驻反证：draft 行没有「基于此开新版」（签核裁决：仅非 draft 挂）─────────
  //    先证行操作区真的渲染了（draft 行有「试跑」按钮，2026-08-22 起真接了后端），
  //    再说「基于此开新版」按钮不在——否则一次渲染失败会让「不在」恒成立。
  await expect(page.getByTestId(`tpladmin-trial-${KEY}-1`)).toBeVisible();
  await expect(page.getByTestId(`tpladmin-mint-version-${KEY}-1`)).toHaveCount(0);

  await page.getByTestId(`tpladmin-publish-${KEY}-1`).click();
  await waitForNotice(page, "已发布");
  await expect(sourceRow).toContainText("已发布");

  // ── ② 发布后按钮出现；对话框 key 锁定 + 字段预填自来源 ─────────────────────────
  await page.getByTestId(`tpladmin-mint-version-${KEY}-1`).click();
  await expect(page.getByTestId("tpladmin-mint-dialog")).toBeVisible();
  const keyInput = page.getByTestId("tpladmin-create-key");
  await expect(keyInput).toBeDisabled();
  await expect(keyInput).toHaveValue(KEY);
  await expect(page.getByTestId("tpladmin-create-name")).toHaveValue(SOURCE);
  await expect(page.getByTestId("tpladmin-create-section-0")).toHaveValue("优势");

  // ── ③ 改显示名与一个分区名，提交 ──────────────────────────────────────────────
  await page.getByTestId("tpladmin-create-name").fill(MINTED);
  await page.getByTestId("tpladmin-create-section-0").fill("劣势");
  await page.getByTestId("tpladmin-mint-submit").click();

  // ── ④ 成功通知 + 「草稿」筛选里的 v2 行是改过的；来源 v1 不受影响 ─────────────
  await waitForNotice(page, "已基于 v1 新建草稿");
  await expect(page.getByTestId("tpladmin-notice")).toContainText(`${MINTED} v2`);
  // 201，不是 200：这条路由真的造出了一行新资源，且只被调了一次。
  expect(mints).toEqual([201]);

  await page.getByTestId("tpladmin-filter-draft").click();
  const mintedRow = page.getByTestId(`tpladmin-card-${KEY}-2`);
  await expect(mintedRow).toBeVisible();
  await expect(mintedRow).toContainText(MINTED);
  await expect(mintedRow).toContainText("草稿");
  // 分区名那一栏（lg 视口可见）显示的是这次改过的名字，不是来源的「优势」。
  await expect(mintedRow).toContainText("劣势");

  await page.getByTestId("tpladmin-filter-all").click();
  await expect(page.getByTestId(`tpladmin-card-${KEY}-1`)).toContainText("已发布");
  await expect(page.getByTestId(`tpladmin-card-${KEY}-1`)).toContainText(SOURCE);

  // ── ⑤ reload 后 v2 草稿行仍在 = 在库里，不在 React state 里 ───────────────────
  await page.reload();
  await expect(page.getByTestId("tpladmin-root")).toBeVisible();
  await page.getByTestId("tpladmin-filter-draft").click();
  await expect(page.getByTestId(`tpladmin-card-${KEY}-2`)).toContainText(MINTED);
  await expect(page.getByTestId(`tpladmin-card-${KEY}-2`)).toContainText("劣势");
  // reload 没有重放开新版请求——那一行来自 GET。
  expect(mints).toEqual([201]);

  // ── ⑥ 反证在新行上再验一次：v2 是 draft ⇒ 同样没有开新版入口 ──────────────────
  await expect(page.getByTestId(`tpladmin-trial-${KEY}-2`)).toBeVisible();
  await expect(page.getByTestId(`tpladmin-mint-version-${KEY}-2`)).toHaveCount(0);
});
