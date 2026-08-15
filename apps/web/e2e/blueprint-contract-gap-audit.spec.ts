/**
 * 蓝本管理闭环 + 契约缺口审计——本文件名与标题在 2026-08-15 重定框
 * （issue #1323，响应对 #1312 / PR #1313 的外部复核；复核评分：作为"主流程"证明力
 * 3/10，作为"缺口审计"价值 7/10）。旧名 `blueprint-to-project-journey.spec.ts` 和旧标题
 * 「蓝本到项目主流程」会让读者以为测试真的走到了"套用蓝本新建项目"这一步——它没有，
 * 见下方②。这次改动**只重定框，不改变任何断言的判定逻辑**：所有 expect 与旧版逐字相同。
 *
 * 本文件覆盖两类完全不同性质的东西，读结果时不要混为一谈：
 *
 * 【A. 蓝本管理闭环——真实端到端，phase-01 已 passing】
 * F175（新建蓝本）→ F174（设计环节逐项写入）→ F179（试跑/发布版本）。链路一节不许省：
 * Chromium → 真登录 → Next 同源代理 → NestJS `BlueprintController` →
 * `PgBlueprintRepository` → PostgreSQL。这部分是本文件里唯一能称为"闭环验证"的内容。
 *
 * 【B. 契约缺口审计——F177 边界证明 + F23/F29 缺口门控，不是功能验证】
 * 覆盖范围为什么比人类原始需求窄——如实记录，不是漏做。
 *
 * 人类原始需求还要求覆盖 F177（换时长档位）与 F23（套用蓝本新建项目，六类初始化 +
 * 版本快照绑定）。逐项勘探（本次改动前）发现两者在**当前 main（SHA cf162a2d）**上
 * 均不具备任何"真实用户能走到"的路径，原因不是 UI 没接线这么简单：
 *
 * ① F177 换时长档位——`setDurationTier` 契约要求调用方传 `expectedVersion`
 *    （CAS 令牌，对应 `blueprints.revision` 列，`gen_random_uuid()::text`），但**没有任何
 *    契约操作把这个值读出来给调用方**：`listBlueprints.out`（`BlueprintRow`）不含它，
 *    也没有 `getBlueprint` 单条读接口。这是登记在案的契约缺口 T9
 *    （`packages/contracts/src/templates.ts` `KNOWN_CONTRACT_GAPS.T9`，
 *    迁移文件头注 `apps/api/migrations/20260814010000_f177_blueprint_revision.sql` 逐字同文）。
 *    ⇒ 一个只用得到公开契约的调用方，**今天没有合法途径**拿到第一次调用要用的
 *    `expectedVersion`；唯一能算出这个值的办法是直接读 Postgres 内部列，
 *    那不是"真实用户会走的路径"，是绕过契约的后门。本文件因此不去猜/编一个值，
 *    只用真实端点证明它的乐观并发闸门确实是活的（见下方 test 2）。
 *
 * ② F23 套用蓝本新建项目——契约 `templates.applyBlueprint`
 *    （`POST /blueprints/:blueprintId/apply`）与用例 `applyBlueprintUseCase`
 *    （`apps/api/src/application/templates/apply-blueprint.ts`）都是真实、可测的代码，
 *    但**全仓 `apps/api/src/interface` 下没有任何控制器调用它**——实测
 *    `grep -rn "applyBlueprintUseCase" apps/api/src` 只命中定义处与端口类型，
 *    零控制器命中。同一份事实也写在 `apply-blueprint.ts` 第 83 行注释与
 *    `blueprint-audit-ports.ts` 第 16 行注释里。⇒ 这条路径**没有被路由到任何 HTTP 方法**，
 *    不存在"真实浏览器 + 真实网络请求"能触达它的方式；F23 标 passing 靠的是
 *    application 层直调的 vitest，不是任何用户可达的入口。同类缺口也存在于
 *    F29 提回蓝本（`templates.submitBlueprintChangeRequest`，
 *    `POST /projects/:projectId/blueprint-change-requests`）——
 *    `grep -rn "submitChangeRequest" apps/api/src/interface` 零命中。
 *
 * 本文件因此：
 *   · 【A 闭环】正例走完 F175 → F174 → F179 的完整真实闭环（含真实 UI 新建蓝本 +
 *     刷新持久化）；
 *   · 【B 审计】对 F177 用真实端点做一条**诚实的边界证明**（CAS 闸门活着，而不是假装
 *     完成了一次被契约允许的写入）——这条不证明"换档位功能可用"，只证明"这条端点存在
 *     且校验逻辑是活的"；
 *   · 【B 审计】对 F23 / F29 各留一条**契约缺口门控**——不是随便编的 URL，是契约里
 *     `operations.applyBlueprint.path` / `operations.submitBlueprintChangeRequest.path`
 *     字面量本身，断言"这条能力承诺的入口，在生产路由表里不存在"（404）。这两条用例的
 *     目的不是证明主流程走通了，是**在缺口被悄悄补上之前一直提醒它还没补上**——一旦
 *     哪天有人挂了控制器却没更新这条断言，CI 会在这里红，逼着回来把这条用例升级成
 *     真实功能验证。
 *   · 【B 审计】`/project/new`（生产入口）里蓝本套用整体禁用是源码自己标注的当前状态
 *     （`new-project-flow.tsx` 文件头注），本文件对它做一条真实断言，防止它在未来
 *     被悄悄"看起来能用了"却没有真正接上 `applyBlueprint`。
 *
 * 这份记录不是"这条测试写不完"的借口——是"现在到底能验证到哪"的诚实边界，
 * 供人类决定接下来先补哪个缺口（读路径 T9，还是 `applyBlueprint` 挂控制器）。
 * 【B 审计】部分**不要**被当作"F177/F23/F29 已经过端到端验证"的证据引用——它们验证的是
 * "缺口确实还在"，方向和【A 闭环】相反。
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

test.describe.serial("蓝本管理闭环 + 契约缺口审计（非「蓝本到项目」主流程——套用蓝本建项目今天不可达，见文件头注②）", () => {
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

  test("F174: 填一项设计环节内容并真实 PUT 保存，刷新后完成度真的变化（不是前端 state）", async ({ page }) => {
    test.skip(blueprintId === "", "上一条用例没能建出蓝本，跳过（不是本条用例本身的失败）");

    await loginAsAdmin(page);

    // ── 为什么这里走 API 不走 UI ──────────────────────────────────────────
    // 不是图省事抄近道：设计器（/tpl/designer）今天仍是纯 mock 挂载点，接受不了
    // 真实 blueprintId（见该页面文件头注：「templates 束的 listDesignFacetDefinitions /
    // updateDesignFacet 路由今天还不存在」——那句话现在已经不准了，路由是真的，只是
    // 没有真实设计器 UI 消费它）。也就是说，**现在真的没有一个可点的表单字段能让这条
    // 用例走 UI**，不是我们选择跳过它。本条用例因此走 `updateDesignFacet` 真实端点
    // 直连（同 skill-review-gate.spec.ts 处理「后端真、前端未接线」的既有做法）。
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

  test("F23 边界证明：套用蓝本新建项目——生产入口整体禁用 + 契约路径 404（不是猜的 URL，是 operations.applyBlueprint.path 字面量）", async ({ page }) => {
    test.skip(blueprintId === "", "上一条用例没能建出蓝本，跳过（不是本条用例本身的失败）");

    // ① 真实 UI：`/project/new`（生产新建项目入口）今天把蓝本套用整体禁用，
    //    即便这个组织已经有一个刚发布出来的蓝本可看。这是源码自己标注的当前状态
    //    （`new-project-flow.tsx` 头注「选择依然禁用」），本条断言防止它未来被悄悄
    //    翻成「看起来能选了」却没有真的接上 applyBlueprint。
    await loginAsAdmin(page);
    await page.goto("/project/new");
    await expect(page.getByTestId("project-new")).toBeVisible();
    await expect(page.getByTestId("project-new-blueprint-unavailable")).toBeVisible();
    const blueprintCard = page.getByTestId(`project-new-blueprint-${blueprintId}`);
    // 目录卡片渲染的是真实数据（能看到我们上面建的这个蓝本），但按钮禁用。
    await expect(blueprintCard).toBeVisible();
    await expect(blueprintCard).toBeDisabled();

    // ② 契约承诺的入口本身：`operations.applyBlueprint.path` 是这条能力唯一的真实契约地址，
    //    不是本文件编的 URL。今天它在生产路由表里不存在——校验的是「压根没有 controller
    //    认领这条路径」，不是权限或参数错误，所以断言必须是 404，不能是 403/422。
    const headers = await authHeaders(page);
    const applyResponse = await page.request.post(
      `${API}${templates.operations.applyBlueprint.path.replace(":blueprintId", blueprintId)}`,
      {
        headers,
        data: {
          orgId: FULLSTACK_E2E.orgId,
          blueprintId,
          versionId: null,
          tier: "one-day",
          projectName: `${BLUEPRINT_NAME}_applied`,
          idempotencyKey: `e2e-apply-${scope}`,
        },
      },
    );
    expect(applyResponse.status()).toBe(404);
  });

  test("F29 边界证明：提回蓝本——契约路径 404（submitBlueprintChangeRequest 未挂任何控制器）", async ({ page }) => {
    await loginAsAdmin(page);
    const headers = await authHeaders(page);

    // 走真实的 sentinel 项目（fixture 种好的那个），不是编一个不存在的 projectId——
    // 这样 404 断言的是「这条路径没有路由」，不会被「项目不存在」这个更浅的 404 混淆归因。
    const proposeBackResponse = await page.request.post(
      `${API}${templates.operations.submitBlueprintChangeRequest.path.replace(
        ":projectId",
        FULLSTACK_E2E.projectId,
      )}`,
      { headers, data: { selections: [] } },
    );
    expect(proposeBackResponse.status()).toBe(404);
  });
});
