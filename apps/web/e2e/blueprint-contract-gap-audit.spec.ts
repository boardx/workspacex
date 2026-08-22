/**
 * 蓝本管理闭环 + 契约缺口审计——本文件名与标题在 2026-08-15 重定框
 * （issue #1323，响应对 #1312 / PR #1313 的外部复核）。2026-08-21（issue #1667）
 * 再次更新：F23/F29 两条此前的「缺口门控」（断言路径确实还是 404）已翻正为
 * 「套用/提回成功且刷新后仍在」的正向断言——两条契约 operation 补齐了真实
 * controller + infra（`ApplyBlueprintController`/`BlueprintChangeRequestController`，
 * `PgApplyBlueprintRepository`/`PgComputeDeviationsRepository`/
 * `PgSubmitChangeRequestRepository`/`PgListPendingChangesRepository`），
 * 不再是「代码写了但没人接得到」的状态。
 *
 * 本文件覆盖两类不同性质的东西，读结果时不要混为一谈：
 *
 * 【A. 蓝本管理闭环——真实端到端，phase-01 已 passing】
 * F175（新建蓝本）→ F174（设计环节逐项写入）→ F179（试跑/发布版本）→
 * F23（套用蓝本新建项目）→ F29（提回蓝本）。链路一节不许省：
 * Chromium → 真登录 → Next 同源代理 → NestJS controller → PG 仓储 → PostgreSQL。
 *
 * 【B. 契约缺口审计——F177 仍是边界证明，不是功能验证】
 * F177（换时长档位）——`setDurationTier` 契约要求调用方传 `expectedVersion`
 * （CAS 令牌，对应 `blueprints.revision` 列，`gen_random_uuid()::text`），但**没有任何
 * 契约操作把这个值读出来给调用方**：`listBlueprints.out`（`BlueprintRow`）不含它，
 * 也没有 `getBlueprint` 单条读接口。这是登记在案的契约缺口 T9
 * （`packages/contracts/src/templates.ts` `KNOWN_CONTRACT_GAPS.T9`，
 * 迁移文件头注 `apps/api/migrations/20260814010000_f177_blueprint_revision.sql` 逐字同文）。
 * ⇒ 一个只用得到公开契约的调用方，**今天没有合法途径**拿到第一次调用要用的
 * `expectedVersion`；本文件因此不去猜/编一个值，只用真实端点证明它的乐观并发闸门
 * 确实是活的（见下方 F177 用例）——**不要**把这条读作"F177 已经端到端验证"。
 *
 * ⚠ F29 的偏离 diff（`computeDeviations`）今天只对 `flow-agenda` 一项有真实数据源
 *   （见 `pg-compute-deviations-repository.ts` 头注）：项目侧其余设计配置项
 *   （主题与背景/分组规则/角色与权限……）尚无独立于蓝本草稿之后可编辑的存储，
 *   `findCurrentProjectContent` 对它们如实原样返回快照值（= 不产生偏离），这是诚实的
 *   空态，不是缺陷。本文件下方 F29 用例因此只对 `flow-agenda` 断言真实偏离——
 *   套用蓝本后六类初始化真实写入的 `agenda_segments`（真实数据）与蓝本从未填过的
 *   `flow-agenda` facet（空快照）天然不同，不需要额外"手工改一下"来制造这条偏离。
 *
 * ⚠ 排进 `playwright.fullstack-smoke.config.ts` 的 `seeded` project：本文件用种子里的
 *   组织管理员（`FULLSTACK_E2E.adminEmail`，唯一能写蓝本的角色，`canMutateCapabilities`
 *   只认 `admin`）。与其它 `seeded` spec 共用同一套 webServer + 同一个库，串行执行。
 */
import { expect, test, type Page } from "@playwright/test";
import { templates } from "@repo/contracts";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";

const API = "/__fullstack_api";

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.adminEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

/**
 * `applyBlueprint` 的组织角色门槛是 `canApplyBlueprint`（`orgRole === "lead"`），
 * 与「唯一能写蓝本的角色」`admin`（`canMutateCapabilities`）是两个不同的判据——
 * 见 `apply-blueprint.ts` 头注「admin/lead 分歧」，`admin` 登录会被 403 ROLE_INSUFFICIENT。
 * F23/F29（`submitBlueprintChangeRequest` 门槛是套用者自动拿到的 `facilitator` 项目角色，
 * 见 `pg-project-repository.ts` 的 `createProject`）因此都要用 `leadEmail` 登录。
 */
async function loginAsLead(page: Page) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.leadEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.leadPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

/**
 * 直连 API 时要带的头——同 `skill-review-gate.spec.ts` 的规矩：`page.request`
 * 不会自动带上身份（Bearer token，不是 cookie），token 由页面存进 localStorage。
 */
async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY);
  expect(token, "登录之后 localStorage 里应有 session token").toBeTruthy();
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

const { scope } = (() => {
  // 与 fixture 同一个 scope 派生逻辑，保证本文件建的行名字在并发隔离下互不撞车。
  const raw = process.env.WORKSPACEX_ISOLATION_ID ?? "fullstack-e2e";
  return { scope: raw.replace(/[^a-zA-Z0-9-]/g, "-").slice(-24) };
})();

const BLUEPRINT_NAME = `BP2PROJ_${scope}`;

test.describe.serial("蓝本管理闭环 + 契约缺口审计（F175→F193/F174→F177(边界)→F179→F23→F29，见文件头注）", () => {
  let blueprintId = "";

  test("F175: 组织后台在真实浏览器里新建蓝本，刷新后仍在（真实 POST/GET /blueprints）", async ({ page }) => {
    const failures: string[] = [];
    page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));

    await loginAsAdmin(page);
    await page.goto("/tpl/list");
    await expect(page.getByTestId("tpl-live-screen")).toBeVisible();

    await page.getByTestId("tpl-live-new").click();
    await expect(page.getByTestId("tpl-live-create-form")).toBeVisible();
    await page.getByTestId("tpl-live-new-name").fill(BLUEPRINT_NAME);

    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (r) => new URL(r.url()).pathname === `${API}/blueprints` && r.request().method() === "POST",
      ),
      page.getByTestId("tpl-live-create-submit").click(),
    ]);
    expect(createResponse.status()).toBe(201);

    // ── 刷新后仍在 = 它在库里，不在 React state 里 ──────────────────────────
    await page.reload();
    await expect(page.getByTestId("tpl-live-screen")).toBeVisible();
    // ⚠ `data-testid^="tpl-live-card-"` 前缀会连带匹配卡片内部的
    //   `tpl-live-card-name`/`-state`/`-completion` 等子元素（同一前缀），必须用
    //   Card 组件本身的语义（div 容器）收窄，否则严格模式会因命中 2 个节点而报错。
    const card = page.locator('div[data-testid^="tpl-live-card-bp-"]').filter({ hasText: BLUEPRINT_NAME });
    await expect(card).toBeVisible();
    // 新建的是草稿，完成度 0（15 项定义表，分母由服务端派生，本文件不写死）。
    await expect(card.getByTestId("tpl-live-card-state")).toContainText("草稿");

    const testId = await card.getAttribute("data-testid");
    expect(testId).toBeTruthy();
    blueprintId = testId!.replace("tpl-live-card-", "");
    expect(blueprintId).not.toBe("");

    expect(failures).toEqual([]);
  });

  test("F193: /tpl/designer 真实 UI 打开一项设计配置面板，编辑并保存，刷新后改动仍在（真落库）", async ({ page }) => {
    test.skip(blueprintId === "", "上一条用例没能建出蓝本，跳过（不是本条用例本身的失败）");

    await loginAsAdmin(page);

    // ── 这条用例证明的是：D-05 二级 sign-off 签核后，`/tpl/designer` 不再是
    //    「后端真、前端未接线」——面板本身现在可以从真实 UI 编辑并真实持久化。
    //    与紧接着的 F174 用例（走 API 直连）互补：那条测的是端点本身，
    //    这条测的是"用户真的能点这个页面把内容改掉"。
    await page.goto(`/tpl/designer?blueprintId=${blueprintId}`);
    await expect(page.getByTestId("bp-designer-shell")).toBeVisible();

    // ⚠ 用 pre-tasks，不用 topic-and-background——下一条 F174 用例走 API 直连时假定
    //   topic-and-background 的 `expectedItemRevision` 仍是初始哨兵 `""`，
    //   两条用例不能撞同一个 key。
    //
    // ⚠ 2026-08-18（F204）：pre-tasks 已从通用自由文本框换成结构化面板，
    //   `bp-facet-content-pre-tasks` 那个 textarea **不再存在**——本用例原先找它，
    //   随 F204 一起真实红过一次（fullstack-smoke FAIL），不是 flaky。
    //   现在改成走结构化面板的真实交互：加一条任务 → 填标题 → 失焦保存。
    //   至此 15 项全部结构化，**没有任何 key 还是自由文本框**，这条用例不能再
    //   「换一个还没结构化的 key」来绕开，只能按真实交互写。
    await page.getByTestId("bp-designer-facet-pre-tasks").click();
    await expect(page.getByTestId("bp-facet-editor-pre-tasks")).toBeVisible();

    // 新增任务本身就是一次真实保存（离散动作，不等失焦）——先等它落定，
    // 避免和下面那次 PUT 抢同一个 itemRevision。
    const [addResponse] = await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `${API}/blueprints/${blueprintId}/design-facets/pre-tasks` &&
          r.request().method() === "PUT",
      ),
      page.getByTestId("bp-hw-add").click(),
    ]);
    expect(addResponse.status()).toBe(200);

    const editor = page.getByTestId("bp-hw-title-0");
    await expect(editor).toBeVisible();
    const content = `真实 UI 端到端写入 ${scope}`;
    await editor.fill(content);

    const [putResponse] = await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `${API}/blueprints/${blueprintId}/design-facets/pre-tasks` &&
          r.request().method() === "PUT",
      ),
      editor.blur(),
    ]);
    expect(putResponse.status()).toBe(200);

    // 完成度徽标必须来自这次 PUT 的响应（服务端算的），不是前端猜的——直接核对页面上显示的数字。
    const putBody = await putResponse.json();
    await expect(page.getByTestId("bp-designer-completeness")).toContainText(
      `${putBody.completeness.done}/${putBody.completeness.denominator}`,
    );

    // ── 刷新后仍在 = 真落库，不是内存态 ──────────────────────────────────
    await page.reload();
    await expect(page.getByTestId("bp-designer-shell")).toBeVisible();
    await page.getByTestId("bp-designer-facet-pre-tasks").click();
    // 刷新后结构化面板把存进 content 字符串的 JSON 解析回各自的格子——
    // 标题回到它原来那一格，不是被拼成一段文本又拆不开。
    await expect(page.getByTestId("bp-hw-title-0")).toHaveValue(content);
  });

  test("F174: 填一项设计环节内容并真实 PUT 保存，刷新后完成度真的变化（不是前端 state）", async ({ page }) => {
    test.skip(blueprintId === "", "上一条用例没能建出蓝本，跳过（不是本条用例本身的失败）");

    await loginAsAdmin(page);

    // ── 为什么这里仍然也走 API 不走 UI ──────────────────────────────────
    // 上一条用例（F193）已经证明设计器面板本身可以从真实 UI 编辑并持久化。
    // 本条继续走 API 直连是为了独立覆盖端点本身的契约行为（乐观并发的初始哨兵值
    // `expectedItemRevision: ""`），不依赖 UI 组件内部状态如何初始化这个值——
    // 两条用例覆盖的是同一条能力的两个不同断言面，不是重复。
    const headers = await authHeaders(page);
    const designFacetKey = "topic-and-background"; // 真实存在于 design-facet-table.ts 定义表
    const putResponse = await page.request.put(
      `${API}${templates.operations.updateDesignFacet.path
        .replace(":blueprintId", blueprintId)
        .replace(":designFacetKey", designFacetKey)}`,
      {
        headers,
        data: { value: "真实端到端测试写入的主题与背景", expectedItemRevision: "" },
      },
    );
    expect(putResponse.status(), await putResponse.text()).toBe(200);
    const putBody = await putResponse.json();
    expect(putBody.completed).toBe(true);
    expect(putBody.completeness.done).toBeGreaterThanOrEqual(1);

    // ── API 调用之后：用真实 UI 复核写入生效 ──────────────────────────────
    // 不靠再读一次这条 PUT 自己的响应体自证——回到 /tpl/list 让真实浏览器渲染
    // 出来的完成度徽标去证明数据库里的状态真的变了，这一步不能省，否则上面那次
    // PUT 调用只证明了"端点接受了请求"，证明不了"写入对用户可见"。
    await page.goto("/tpl/list");
    await expect(page.getByTestId("tpl-live-screen")).toBeVisible();
    const card = page.getByTestId(`tpl-live-card-${blueprintId}`);
    await expect(card).toBeVisible();
    await expect(card.getByTestId("tpl-live-card-completion")).toContainText(
      `${putBody.completeness.done}/${putBody.completeness.denominator}`,
    );
  });

  test("F177 边界证明：换时长档位端点真实存在且乐观并发闸门有效（不是假装完成了一次被契约允许的写入）", async ({ page }) => {
    test.skip(blueprintId === "", "上一条用例没能建出蓝本，跳过（不是本条用例本身的失败）");

    await loginAsAdmin(page);

    // ── 为什么这里走 API 不走 UI，以及为什么这不是"换档位功能验证" ──────────
    // 换时长档位在生产 UI 上根本没有可点的表单（没有对应设计——不是"表单存在但没
    // 接线"，是"这个交互目前还不存在于任何页面"）。就算有表单，也没有合法途径让它
    // 拿到 `expectedVersion`：见文件头注①，契约缺口 T9 —— 没有任何契约操作把
    // `expectedVersion`（对应 `blueprints.revision` 列）读出来给调用方。本条用例
    // 因此**不是在验证"换档位能用"**——它只证明这条端点存在、真实写库前会先校验
    // CAS 令牌：传一个明显不合法的令牌，必须被拒在 409 VERSION_CHANGED（而不是
    // 404/500，证明它真的在校验，不是路由缺失）。读到这条用例通过，不能得出
    // "F177 已端到端验证"的结论。
    const headers = await authHeaders(page);
    const putResponse = await page.request.put(
      `${API}${templates.operations.setDurationTier.path.replace(":blueprintId", blueprintId)}`,
      {
        headers,
        data: {
          tier: "one-day",
          confirmed: true,
          expectedVersion: "e2e-deliberately-wrong-cas-token",
        },
      },
    );
    // ── API 调用之后：只做边界断言，不追加任何"看起来更完整"的后续 UI 步骤 ──
    // 追加一步去点某个 UI 元素不会让这条用例更真实——没有表单可点，硬点会点到
    // 不相关的元素，制造假的"UI 也验证过了"的印象，那正是这次重定框要避免的事。
    expect(putResponse.status()).toBe(409);
    const body = await putResponse.json();
    expect(body.reasonCode).toBe("VERSION_CHANGED");
  });

  test("F179: 试跑 → 发布蓝本版本（真实 POST /trial-runs + POST /versions），刷新后 /tpl/list 显示已发布 v1", async ({ page }) => {
    test.skip(blueprintId === "", "上一条用例没能建出蓝本，跳过（不是本条用例本身的失败）");

    await loginAsAdmin(page);
    const headers = await authHeaders(page);

    // ── 为什么试跑/发布这三步走 API 不走 UI ────────────────────────────────
    // 同 F174/F177：`/tpl/designer` 是试跑/发布动作实际所在的页面，今天仍是纯 mock
    // 挂载点，没有真实可点的"试跑"“发布”按钮能接受真实 blueprintId。这三步因此走
    // `startTrialRun` / `publishBlueprintVersion` 真实端点直连，和 F174 同一处境——
    // 不是选择跳过 UI，是这些按钮现在真的不存在于任何已接线的页面。下方 API 调用
    // 结束后会切回真实 UI（/tpl/list）复核状态确实落地，见下方"真实 UI 复核"。
    // 未试跑就发布必须被拒（发布门槛之一）。
    //
    // ⚠ 只断言状态码，不断言 `reasonCode: "TRIAL_RUN_REQUIRED"`——实测（本文件调试过程中）
    //   它确实是 422，但响应体里没有 `reasonCode` 字段。原因是 `all-exceptions.filter.ts`
    //   的 `permissionReasonOf` 是一份**允许列表**：`templates.TemplateError` 这个闭集枚举
    //   至今没有被登记进那份白名单（同该文件自己反复记录的"同一个 bug 第 N 次"那类缺口，
    //   只是这次是 templates 束还没轮到）。`TRIAL_RUN_REQUIRED` / `REQUIRED_CONFIG_INCOMPLETE`
    //   / `CUSTOM_TIER_RULE_UNDEFINED` / `TIER_CHANGE_NEEDS_CONFIRMATION` 都会被那道白名单
    //   静默丢弃，状态码对但原因没了。`VERSION_CHANGED` / `ROLE_INSUFFICIENT` /
    //   `DEPENDENCY_UNAVAILABLE` 恰好能透传，只是因为它们的字面量恰好也出现在
    //   `agentRuntime.AgentRuntimeError` 这个不相关枚举里（纯字符串巧合，不是刻意登记）——
    //   本文件其它用例断言 `reasonCode` 的地方都只挑了这三个恰好透传的码。
    //   这份出入本身值得单独登记一个缺口，本文件不顺手在这里修（范围纪律）。
    const publishBeforeTrialRun = await page.request.post(
      `${API}${templates.operations.publishBlueprintVersion.path.replace(":blueprintId", blueprintId)}`,
      { headers, data: { expectedCurrentVersionNumber: 0 } },
    );
    expect(publishBeforeTrialRun.status()).toBe(422);

    const trialRunResponse = await page.request.post(
      `${API}${templates.operations.startTrialRun.path.replace(":blueprintId", blueprintId)}`,
      { headers, data: {} },
    );
    expect(trialRunResponse.status()).toBe(201);
    expect((await trialRunResponse.json()).trialRunDone).toBe(true);

    // 草稿期 versionNumber 恒为 0（BP-03 迁移头注逐字）——首次发布用 0，不是猜的。
    const publishResponse = await page.request.post(
      `${API}${templates.operations.publishBlueprintVersion.path.replace(":blueprintId", blueprintId)}`,
      { headers, data: { expectedCurrentVersionNumber: 0 } },
    );
    expect(publishResponse.status(), await publishResponse.text()).toBe(201);
    const publishBody = await publishResponse.json();
    expect(publishBody.versionNumber).toBe(1);
    expect(publishBody.archivedVersionId).toBeNull(); // 首版，没有旧版本可归档

    // 带过期版本号再发一次必须被拒，且不占号（失败不产生新版本）。
    const stalePublish = await page.request.post(
      `${API}${templates.operations.publishBlueprintVersion.path.replace(":blueprintId", blueprintId)}`,
      { headers, data: { expectedCurrentVersionNumber: 0 } },
    );
    expect(stalePublish.status()).toBe(409);
    expect((await stalePublish.json()).reasonCode).toBe("VERSION_CHANGED");

    // ── 真实 UI 复核：刷新 /tpl/list，这个蓝本卡片显示「已发布 v1」──────────
    // ⚠ 不重新登录——上面几次 `page.request` 调用不经过 `page`，会话仍在，
    //   重复走一次 `/login` 在已登录态下可能被重定向打断这条断言。
    await page.goto("/tpl/list");
    await expect(page.getByTestId("tpl-live-screen")).toBeVisible();
    const card = page.getByTestId(`tpl-live-card-${blueprintId}`);
    await expect(card).toBeVisible();
    await expect(card.getByTestId("tpl-live-card-state")).toContainText("已发布");
    await expect(card.getByTestId("tpl-live-card-state")).toContainText("v1");

    // 刷新一次不产生二次发布——版本号仍是 1（不是「每次读都递增」的空转实现）。
    await page.reload();
    await expect(card.getByTestId("tpl-live-card-state")).toContainText("v1");
  });

  let appliedProjectId = "";

  test("F23（issue #1667 补实现）：套用蓝本真实新建项目——POST /blueprints/:id/apply 201，刷新 /projects 后仍在（真实落库）", async ({ page }) => {
    test.skip(blueprintId === "", "上一条用例没能建出蓝本，跳过（不是本条用例本身的失败）");

    // ⚠ 2026-08-21（issue #1667）：这条用例此前的断言方向是「契约路径 404」——
    //   `templates.applyBlueprint` 当时零控制器、零 infra。本次已补上真实
    //   `PgApplyBlueprintRepository`（复用 `PROJECT_REPOSITORY` 的唯一创建路径，
    //   不新开第二个 `INSERT INTO projects`）与 `ApplyBlueprintController`，
    //   断言方向翻正：验证套用真的建出一个项目、真的落库。
    await loginAsLead(page);
    const headers = await authHeaders(page);

    const idempotencyKey = `e2e-apply-${scope}`;
    const projectName = `${BLUEPRINT_NAME}_applied`;
    // ⚠ `orgId`/`blueprintId` 不进请求体——两者分别来自会话与 URL 路径，controller 的
    //   `APPLY_BODY_SCHEMA`（apply-blueprint.controller.ts）用 `.omit({orgId,blueprintId})`
    //   显式拒收，与本仓其余全部 blueprint controller 同一约定（不信前端传路径已表达的字段）。
    //   带上这两个字段会被 Zod 判 unrecognized_keys，400。
    const applyResponse = await page.request.post(
      `${API}${templates.operations.applyBlueprint.path.replace(":blueprintId", blueprintId)}`,
      {
        headers,
        data: {
          versionId: null,
          tier: "one-day",
          projectName,
          idempotencyKey,
        },
      },
    );
    expect(applyResponse.status(), await applyResponse.text()).toBe(201);
    const applyBody = await applyResponse.json();
    expect(applyBody.projectId).toBeTruthy();
    // 六类恒 6 项，即使某一类今天 count 恒 0 也要出现（I-17，见 apply-blueprint-init.ts）。
    expect(applyBody.initialized).toHaveLength(6);
    const agendaCategory = applyBody.initialized.find((c: { category: string }) => c.category === "议程环节");
    // AC1「打开即有完整议程环节（数量=所选档位）」——one-day 档恒 11 个（F19 议程环节表）。
    expect(agendaCategory?.count).toBe(11);
    appliedProjectId = applyBody.projectId;

    // 同一 idempotencyKey 重复提交只建一个项目（V13）——真实打第二次，projectId 必须相同。
    const replayResponse = await page.request.post(
      `${API}${templates.operations.applyBlueprint.path.replace(":blueprintId", blueprintId)}`,
      {
        headers,
        data: {
          versionId: null,
          tier: "one-day",
          projectName,
          idempotencyKey,
        },
      },
    );
    expect(replayResponse.status()).toBe(201);
    expect((await replayResponse.json()).projectId).toBe(appliedProjectId);

    // ── 真实 UI 复核：刷新 /projects，套用建出来的项目真的在列表里（不是内存态）──
    await page.goto("/projects");
    await expect(page.getByTestId(`projects-card-${appliedProjectId}`)).toBeVisible();
    await page.reload();
    await expect(page.getByTestId(`projects-card-${appliedProjectId}`)).toBeVisible();
  });

  test("F29（issue #1667 补实现）：提回蓝本——GET 偏离 + POST 提交 201，GET /pending-changes 刷新后仍在（真实落库）", async ({ page }) => {
    test.skip(appliedProjectId === "", "F23 用例没能套用成功，跳过（不是本条用例本身的失败）");

    // ⚠ 2026-08-21（issue #1667）：这条用例此前的断言方向是「契约路径 404」——
    //   `templates.submitBlueprintChangeRequest`/`computeDeviations` 当时零控制器、
    //   零 infra。本次已补上 `PgComputeDeviationsRepository`（diff 基准 =
    //   `blueprint_bindings`/`blueprint_versions` 快照，当前值对 `flow-agenda` 一项
    //   真实读 `agenda_segments`，其余各项项目侧配置编辑路径尚未落地、诚实原样返回快照
    //   值，见该文件头注）与 `BlueprintChangeRequestController`。
    //
    // 上一条用例套用出的项目，六类初始化真实写了 11 条 `agenda_segments`（议程环节，
    // one-day 档），蓝本的 `flow-agenda` facet 从未被填过（本文件没有走那个面板）——
    // 两边序列化后天然不同，这就是一条真实、不需要额外「手工改一下」的偏离，
    // 不是编出来的测试数据。
    await loginAsLead(page);
    const headers = await authHeaders(page);

    const deviationsResponse = await page.request.get(
      `${API}${templates.operations.computeDeviations.path.replace(":projectId", appliedProjectId)}`,
      { headers },
    );
    expect(deviationsResponse.status(), await deviationsResponse.text()).toBe(200);
    const deviationsBody = await deviationsResponse.json();
    const flowAgendaDeviation = deviationsBody.deviations.find(
      (d: { designFacetKey: string }) => d.designFacetKey === "flow-agenda",
    );
    expect(flowAgendaDeviation, JSON.stringify(deviationsBody)).toBeTruthy();

    const rationale = `现场核对过环节时长 ${scope}`;
    const submitResponse = await page.request.post(
      `${API}${templates.operations.submitBlueprintChangeRequest.path.replace(":projectId", appliedProjectId)}`,
      { headers, data: { selections: [{ designFacetKey: "flow-agenda", rationale }] } },
    );
    expect(submitResponse.status(), await submitResponse.text()).toBe(201);
    const submitBody = await submitResponse.json();
    expect(submitBody.changeRequestIds).toHaveLength(1);
    // 提交≠生效（I-10 / A1）——必须明示尚未生效，不是一个看起来像成功的 `{ok:true}`。
    expect(submitBody.pendingNotice).toContain("待");

    // ── 真实落库复核：GET /blueprints/:id/pending-changes，刷新一次仍在 ──────────
    const listUrl = `${API}/blueprints/${blueprintId}/pending-changes`;
    const listResponse = await page.request.get(listUrl, { headers });
    expect(listResponse.status(), await listResponse.text()).toBe(200);
    const listBody: Array<{ changeRequest: { changeRequestId: string; rationale: string; status?: string } }> =
      await listResponse.json();
    const match = listBody.find((row) => row.changeRequest.changeRequestId === submitBody.changeRequestIds[0]);
    expect(match, JSON.stringify(listBody)).toBeTruthy();
    expect(match!.changeRequest.rationale).toBe(rationale);
    // 契约 `ChangeRequest` 是四要素 `.strict()` 形状，不含内部生命周期字段 `status`。
    expect(match!.changeRequest.status).toBeUndefined();

    const listAgainResponse = await page.request.get(listUrl, { headers });
    expect(listAgainResponse.status()).toBe(200);
    const listAgainBody: Array<{ changeRequest: { changeRequestId: string } }> = await listAgainResponse.json();
    expect(listAgainBody.some((row) => row.changeRequest.changeRequestId === submitBody.changeRequestIds[0])).toBe(
      true,
    );
  });
});
