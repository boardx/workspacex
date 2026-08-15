/**
 * #853 —— 「新建议程环节」的**真实浏览器**门控。
 *
 * `createAgendaSegment` 有 controller 挂了整整一个 feature（#627），但直到 #853 之前
 * `apps/web` 里零调用方——`grep -rn "createAgendaSegment" apps/web/` 只命中 e2e 夹具里
 * 的一句注释。用户造不出议程环节，`bindTemplateToSegment`（#493）因此永远没有可绑的
 * 目标。本文件是它在浏览器里的第一个调用方，同时也是 `listAgendaSegments`
 * （同一次签核、同样从未挂过 controller，#853 一并补上）的第一个调用方——没有它，
 * 新建出来的环节（初始 `pending`）在任何真实读路径里都不可见。
 *
 * 链路一节不许省：Chromium → Next 同源代理 → NestJS `project.controller.ts`
 * → application `createAgendaSegment`/`listAgendaSegments` → pg 仓储 → PostgreSQL。
 *
 * ## 这里证明的两件事，组件测试证不了
 *
 * ① **真的落库，不是本地乐观更新**。新建成功后界面重新打一次真实
 *    `GET /workshops/:workshopId/agenda-segments`（`onSegmentCreated` 回调），
 *    列表里的新行来自这次 GET 的响应体，不是本地 state 里 append 的一条。
 * ② **刷新后仍在**——唯一能区分「写进了 PostgreSQL」与「写进了 React state」的断言
 *    （同 `project-create-smoke.spec.ts` 的纪律）：`page.reload()` 之后重新走一次
 *    完整的组件挂载 + 真实 GET，新行必须还在。
 *
 * 种子里这个工作坊已经有一条**种子给的、`active`** 环节（`FULLSTACK_E2E.agendaSegmentId`，
 * 供 #493 步骤 8c 用）——本文件的反空转前提是「这条种子行已经在，且我新建的那条此刻
 * 还不在」，而不是「列表原本是空的」。
 *
 * ⚠ 单独成文件而不是并进 `fullstack-smoke.spec.ts`：那个文件的每一条 `page.goto`
 *   都被 `.harness/scripts/fullstack-smoke.test.ts` 按出现次数钉死（#387 的反空转手段），
 *   往里加登录会让那些计数失效——同 `project-create-smoke.spec.ts` 文件头逐字理由。
 */
import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

test("facilitator creates an agenda segment in the browser; PostgreSQL keeps it across a reload", async ({ page }) => {
  const failures: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("Failed to load resource")) {
      failures.push(`console error: ${m.text()}`);
    }
  });
  page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));

  const title = `#853 新建的环节 ${test.info().workerIndex}`;

  await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
  await page.goto(`/projects/${FULLSTACK_E2E.projectId}?org=${FULLSTACK_E2E.orgId}&tab=prep`);
  await expect(page.getByTestId("project-prep")).toBeVisible();
  await expect(page.getByTestId("project-prep-real-agenda")).toBeVisible();

  // ── 反空转前提 ──────────────────────────────────────────────────────────
  // 种子给的那条环节已经在（证明列表读的是真数据，不是一个恒空的桩）；
  // 我要新建的标题现在还不在（下面「它在列表里」才分得清是不是我建的）。
  await expect(
    page.getByTestId(`project-prep-real-agenda-${FULLSTACK_E2E.agendaSegmentId}`),
  ).toContainText(FULLSTACK_E2E.agendaSegmentTitle);
  await expect(page.getByTestId("project-prep-real-agenda-list")).not.toContainText(title);

  // ── 建：真实 POST，等它真的 201（Nest `@Post` 缺省 201，不是 200） ──────
  const createResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && /\/workshops\/[^/]+\/agenda-segments(\?|$)/.test(response.url())
  ));
  await page.getByTestId("project-prep-create-agenda-open").click();
  await page.getByTestId("project-prep-create-agenda-title").fill(title);
  await page.getByTestId("project-prep-create-agenda-duration").fill("25");
  await page.getByTestId("project-prep-create-agenda-submit").click();
  expect((await createResponse).status()).toBe(201);

  // 建完之后：确认横幅 + 表单收起 + 列表里出现新行（新行来自 onCreated 触发的
  // 真实重取，不是本地 append——下面 reload 那一步进一步排除「只是 React state」）。
  await expect(page.getByTestId("project-prep-create-agenda-form")).toHaveCount(0);
  await expect(page.getByTestId("project-prep-real-agenda-created")).toContainText(title);
  const newRow = page.getByTestId("project-prep-real-agenda-list").getByText(title);
  await expect(newRow).toBeVisible();
  await expect(page.getByTestId("project-prep-real-agenda-list")).toContainText("待开始"); // state: pending

  // ── 刷新后仍在：区分 PostgreSQL 与 React state ─────────────────────────
  await page.reload();
  await expect(page.getByTestId("project-prep-real-agenda")).toBeVisible();
  await expect(page.getByTestId("project-prep-real-agenda-list")).toContainText(title);
  // 种子给的那条也还在——新建没有把它挤掉或覆盖掉。
  await expect(
    page.getByTestId(`project-prep-real-agenda-${FULLSTACK_E2E.agendaSegmentId}`),
  ).toContainText(FULLSTACK_E2E.agendaSegmentTitle);

  expect(failures, `未预期的浏览器控制台/页面错误：\n${failures.join("\n")}`).toEqual([]);
});
