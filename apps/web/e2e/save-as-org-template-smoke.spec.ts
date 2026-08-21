/**
 * #1666 收尾 —— 「另存为组织模板」两处按钮的**真实浏览器**门控。
 *
 * ## 这个 issue 原始报告的两处「假成功」缺陷
 *
 * ① `tab-prep.tsx:135` 的 `project-prep-save-template` 按钮**没有 `onClick`**，
 *    纯装饰，点了没有任何反应。
 * ② `workflow-screen.tsx:58` 的 `tpl-wf-saveorg` 按钮只 `onToast("已另存为组织级
 *    工作流模板…")`，**不发任何网络请求**——用户看到成功提示，库里什么也没写。
 *
 * `#1680` 给契约 `saveAsOrgTemplate` 补上了 controller/infra（真实 PG 落库），
 * `#1681` 让 `workflow-screen.tsx` 接上了真实 `projectId`/`getWorkflowOrchestration`；
 * 本 issue 收尾把两处按钮真正接上 `saveAsOrgTemplate`（`apps/web/components/tpl/
 * save-as-org-template-action.tsx`，两处共用同一份状态机与请求逻辑）。
 *
 * ## 为什么种子里要新增一份 `project_workflow_orchestration`
 *
 * `saveAsOrgTemplate` 用例（`apps/api/src/application/templates/save-as-org-template.ts`）
 * 在 `OrchestrationRepository.load(projectId)` 回 `null` 时恒抛 `DEPENDENCY_UNAVAILABLE`
 * ——项目要先有一份真实编排才有「另存为组织模板」可另存的内容。种子脚本
 * （`apps/api/scripts/seed-fullstack-smoke.ts`）为 `FULLSTACK_E2E.projectId` 新增了
 * 这份编排（复用已种好的 `agendaSegmentId`）。
 *
 * ## 「刷新后仍在」在这个功能上怎么证明——这里没有列表 UI 可以刷新后看
 *
 * `saveAsOrgTemplate` 的产物（`workflow_template_catalog` 一行）**契约上没有任何读路径**
 * （`getWorkflowOrchestration` 只回「当前套用的模板」，不回模板库列表；`workflow-screen.tsx`
 * 的 7c 区块因此如实降级为空态说明，见该文件头注）——没有地方可以「刷新页面，看它还在
 * 列表里」。本文件改用一条同样真实、同样只认 Postgres 的独立路径证明持久化：
 *
 * 1. 用 `workflow-screen.tsx` 真实保存出来的 `workflowTemplateId`；
 * 2. 全新登录一个此前从未涉及本次保存的账号（`leadEmail`），真实创建一个全新项目
 *    （这个项目在保存动作发生时**根本不存在**，排除「读到的是同一次请求内的内存态」）；
 * 3. 对这个全新项目调用 `switchWorkflowTemplate`（已有 controller/infra，只是前端按钮
 *    未接线——契约缺口，不在本 issue 范围）传入那个 `workflowTemplateId`：
 *    `catalog.load(templateId)` 找不到就会抛 `DEPENDENCY_UNAVAILABLE`，找到了才会
 *    `applied: true`；
 * 4. 再 `getWorkflowOrchestration` 读回这个全新项目，断言里面的环节标题与我们保存时
 *    的种子内容一致。
 *
 * 四步缺一都不能证明「行真的进了 PostgreSQL 而不是某种进程内缓存」——这正是
 * `agenda-segment-create-smoke.spec.ts`「刷新后仍在」纪律在没有列表 UI 时的等价形式，
 * 只是验证手段从「reload 同一个页面」换成了「全新会话 + 全新项目 + 独立读路径」。
 *
 * ⚠ 不复用 `FULLSTACK_E2E` 共享项目做这一步：`switchWorkflowTemplate` 是整份覆盖式写
 *   （`replace`），会把共享项目编排的矩阵格 id 全部换掉，可能连带弄坏其它并行 spec
 *   对这份种子数据的假设。全新建一个项目，写坏了也没有任何别的用例会看见。
 *
 * ⚠ 单独成文件而不是并进 `fullstack-smoke.spec.ts`：同 `agenda-segment-create-smoke.spec.ts`
 *   文件头注一致的理由——那个文件的 `page.goto` 按出现次数被钉死，不能往里插登录。
 */
import { expect, test, type Page } from "@playwright/test";
import { templates, project as projectContract } from "@repo/contracts";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";

const API = "/__fullstack_api";

async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

/** 同 `blueprint-contract-gap-audit.spec.ts` 的规矩：`page.request` 不带 cookie 身份。 */
async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY);
  expect(token, "登录之后 localStorage 里应有 session token").toBeTruthy();
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

const scope = (process.env.WORKSPACEX_ISOLATION_ID ?? "fullstack-e2e")
  .replace(/[^a-zA-Z0-9-]/g, "-")
  .slice(-24);

test.describe.serial("#1666：另存为组织模板——两处按钮真实接线 + 持久化反证", () => {
  /** 由 workflow-screen 那条用例真实保存出来，供最后的持久化反证用例消费。 */
  let savedWorkflowTemplateId = "";

  test("tab-prep.tsx「另存为组织模板」：真实 POST，成功文案含服务端真实 id（不是编好的固定文案）", async ({ page }) => {
    const failures: string[] = [];
    page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));

    await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
    await page.goto(`/projects/${FULLSTACK_E2E.projectId}?org=${FULLSTACK_E2E.orgId}&tab=prep`);
    await expect(page.getByTestId("project-prep")).toBeVisible();

    // ⚠ 点击前它只是折叠态的触发按钮，没有表单——onClick 之前它就是这个样子
    // （反证前提：先证明表单现在不在，下面「点了之后出现」才有意义）。
    await expect(page.getByTestId("project-prep-save-template-form")).toHaveCount(0);

    await page.getByTestId("project-prep-save-template").click();
    await expect(page.getByTestId("project-prep-save-template-form")).toBeVisible();

    const name = `TABPREP_ORGTPL_${scope}`;
    await page.getByTestId("project-prep-save-template-name").fill(name);

    const [saveResponse] = await Promise.all([
      page.waitForResponse((r) => (
        r.request().method() === "POST"
        && new URL(r.url()).pathname === `${API}/projects/${FULLSTACK_E2E.projectId}/save-as-org-template`
      )),
      page.getByTestId("project-prep-save-template-submit").click(),
    ]);
    expect(saveResponse.status(), await saveResponse.text()).toBe(201);
    const body = await saveResponse.json();
    expect(body.workflowTemplateId).toBeTruthy();

    // 成功文案里含服务端真实回的 id——不是 issue 里那句编好的固定文案
    // 「已另存为组织级工作流模板」，界面显示的内容随服务端响应变化。
    await expect(page.getByTestId("project-prep-save-template-success")).toContainText(name);
    await expect(page.getByTestId("project-prep-save-template-success")).toContainText(body.workflowTemplateId);
    await expect(page.getByTestId("project-prep-save-template-form")).toHaveCount(0);

    // ── 刷新后界面干净复位：不是卡在一个只存在于 React state 的「已保存」幽灵态 ──
    await page.reload();
    await expect(page.getByTestId("project-prep")).toBeVisible();
    await expect(page.getByTestId("project-prep-save-template")).toBeVisible();
    await expect(page.getByTestId("project-prep-save-template-success")).toHaveCount(0);

    expect(failures, `未预期的页面错误：\n${failures.join("\n")}`).toEqual([]);
  });

  test("workflow-screen.tsx「另存为组织模板」：真实 POST，toast 文案含服务端真实 id", async ({ page }) => {
    const failures: string[] = [];
    page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));

    await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
    await page.goto(`/tpl?screen=workflow&projectId=${FULLSTACK_E2E.projectId}&org=${FULLSTACK_E2E.orgId}`);
    await expect(page.getByTestId("tpl-workflow")).toBeVisible();
    // 种子已给这个项目一份真实编排（见文件头注）——7a 模板层区块应该渲染出真实数据，
    // 不是 depFailure/空态分支。
    await expect(page.getByTestId("tpl-wf-template")).toBeVisible();

    await expect(page.getByTestId("tpl-wf-saveorg-form")).toHaveCount(0);
    await page.getByTestId("tpl-wf-saveorg").click();
    await expect(page.getByTestId("tpl-wf-saveorg-form")).toBeVisible();

    const name = `WFSCREEN_ORGTPL_${scope}`;
    await page.getByTestId("tpl-wf-saveorg-name").fill(name);

    const [saveResponse] = await Promise.all([
      page.waitForResponse((r) => (
        r.request().method() === "POST"
        && new URL(r.url()).pathname === `${API}/projects/${FULLSTACK_E2E.projectId}/save-as-org-template`
      )),
      page.getByTestId("tpl-wf-saveorg-submit").click(),
    ]);
    expect(saveResponse.status(), await saveResponse.text()).toBe(201);
    const body = await saveResponse.json();
    expect(body.workflowTemplateId).toBeTruthy();
    savedWorkflowTemplateId = body.workflowTemplateId;

    // 反馈走这个屏既有的 toast 通道（`onSaved` → `onToast`），文案里含服务端真实 id。
    await expect(page.getByTestId("tpl-toast")).toContainText(name);
    await expect(page.getByTestId("tpl-toast")).toContainText(body.workflowTemplateId);

    expect(failures, `未预期的页面错误：\n${failures.join("\n")}`).toEqual([]);
  });

  test("反证：服务端真实失败时，界面如实显示失败，不再是「点了就说成功」的本地 toast", async ({ page }) => {
    await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
    await page.goto(`/tpl?screen=workflow&projectId=${FULLSTACK_E2E.projectId}&org=${FULLSTACK_E2E.orgId}`);
    await expect(page.getByTestId("tpl-wf-template")).toBeVisible();

    let intercepted = 0;
    await page.route(`**${API}/projects/${FULLSTACK_E2E.projectId}/save-as-org-template`, async (route) => {
      intercepted += 1;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "dependency unavailable", reasonCode: "DEPENDENCY_UNAVAILABLE", traceId: "cp-1666" }),
      });
    });

    await page.getByTestId("tpl-wf-saveorg").click();
    await page.getByTestId("tpl-wf-saveorg-name").fill(`CP_${scope}`);
    await page.getByTestId("tpl-wf-saveorg-submit").click();

    await expect.poll(() => intercepted).toBe(1);
    // 界面上出现的是服务端真实 reasonCode 的翻译，不是 issue 原本那句恒定成功文案。
    await expect(page.getByTestId("tpl-wf-saveorg-error")).toBeVisible();
    await expect(page.getByTestId("tpl-wf-saveorg-error")).toContainText("编排数据");
    // 且没有一条 toast 谎称已经存成功了。
    await expect(page.getByTestId("tpl-toast")).toHaveCount(0);
  });

  test("持久化反证：workflow-screen 存下来的组织模板真的在 PostgreSQL 里，全新项目 + 全新会话读得回来", async ({ page }) => {
    test.skip(savedWorkflowTemplateId === "", "上一条用例没能保存成功，跳过（不是本条用例本身的失败）");

    // 全新账号登录——此前两条用例的会话/进程状态与这里彻底无关。
    await loginAs(page, FULLSTACK_E2E.leadEmail, FULLSTACK_E2E.leadPassword);
    const headers = await authHeaders(page);

    // 全新项目——在上面「保存」发生的那一刻根本不存在，排除「读到的是同一次请求里
    // 恰好还活着的内存态」这种可能。
    const freshProjectName = `SAVEORG_VERIFY_${scope}`;
    const createResponse = await page.request.post(
      `${API}${projectContract.operations.createProject.path}`,
      {
        headers,
        data: { orgId: FULLSTACK_E2E.orgId, name: freshProjectName, kind: "workshop", blueprintVersionId: null },
      },
    );
    expect(createResponse.status(), await createResponse.text()).toBe(201);
    const freshProjectId: string = (await createResponse.json()).id;
    expect(freshProjectId).toBeTruthy();

    // 创建者自动是这个新项目的 facilitator（F199），对刚建出来、从未套过编排的项目
    // 换模板恒非破坏性（`switch-workflow-template.ts` 头注：`current === null` 视同
    // 非破坏性），`confirmed` 传什么都会真的写入——这正是我们要的：把
    // `workflow_template_catalog` 里那一行的内容真实搬回一个可读的项目编排。
    const switchResponse = await page.request.post(
      `${API}${templates.operations.switchWorkflowTemplate.path.replace(":projectId", freshProjectId)}`,
      { headers, data: { templateId: savedWorkflowTemplateId, confirmed: true } },
    );
    expect(switchResponse.status(), await switchResponse.text()).toBe(201);
    const switchBody = await switchResponse.json();
    // `DEPENDENCY_UNAVAILABLE`（`catalog.load` 找不到这个 id）不会走到这里——
    // 状态码本身已经是「id 真实存在」的证据，`applied: true` 进一步证明真的写回了。
    expect(switchBody.applied).toBe(true);

    // ── 独立读路径复核：GET 这个全新项目的编排，内容与保存时的种子一致 ──────────
    const readResponse = await page.request.get(
      `${API}${templates.operations.getWorkflowOrchestration.path.replace(":projectId", freshProjectId)}`,
      { headers },
    );
    expect(readResponse.status(), await readResponse.text()).toBe(200);
    const readBody = await readResponse.json();
    expect(readBody.template.templateId).toBe(savedWorkflowTemplateId);
    expect(
      readBody.segmentChain.some((s: { title: string }) => s.title === FULLSTACK_E2E.agendaSegmentTitle),
    ).toBe(true);
  });
});
