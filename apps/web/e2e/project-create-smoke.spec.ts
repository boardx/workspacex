/**
 * PJ-01 / #976 —— 新建项目向导的**真实浏览器**门控。
 *
 * 链路一节不许省：Chromium → Next 同源代理 → NestJS `project.controller.ts`
 * → application `createProject` → pg 仓储 → PostgreSQL。中途没有任何一处塞假数据。
 *
 * ## 三件事在这里被证明，组件测试证不了
 *
 * ① **项目真的进了库**。组件测试里的「创建成功」只是 fetch mock 回了一个 id；
 *    只有真的重新加载 `/projects`（一次全新的 `GET /projects`），才能区分
 *    「写进了 PostgreSQL」和「写进了 React state」。
 * ② **跳转落到的是那个真项目**。建成后停在 `/projects/<id>`，而那个 id 是响应体
 *    回来的、库里真实存在的行——不是前端编的。
 * ③ **组织普通成员也能创建项目**。顾问通过同一向导提交，服务端返回 201，
 *    刷新列表后仍能看到项目。API 权限测试另行验证非成员被拒且不落库。
 *
 * ## 反证
 *
 * 第三条用例把创建请求在浏览器里拦掉、回一个契约形状的假 201 —— 界面一度显示成功，
 * 但那个项目从来没进过库，刷新之后列表里没有它。与
 * `canvas-template-create-smoke.spec.ts` / `skill-create-smoke.spec.ts` 同一套做法，
 * 且**常驻**（不靠环境变量，因此不会在生产代码里留一条「假装建成」的路径）。
 *
 * ⚠ 单独成文件而不是并进 `fullstack-smoke.spec.ts`：那个文件的每一条 `page.goto`
 *   都被 `.harness/scripts/fullstack-smoke.test.ts` 按**出现次数**钉死（#387 的反空转手段），
 *   往里加登录会让那些计数失效。理由与 `capability-mutate-smoke.spec.ts` 逐字相同。
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
}

test("org lead creates a project through the wizard, and PostgreSQL keeps it across a reload", async ({ page }) => {
  const failures: string[] = [];
  /** 真的发出去的创建请求及其状态码——「界面显示成功」不等于「请求发生过」。 */
  const creates: number[] = [];
  /** 建成后打开工作台时被服务端拒掉的那些请求（下面第 ③ 件要逐条核对它们是不是该被拒）。 */
  const forbidden: string[] = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname.replace(/^\/__fullstack_api/, "");
    if (path === "/projects" && response.request().method() === "POST") creates.push(response.status());
    if (response.status() === 403) forbidden.push(path);
  });
  page.on("console", (message) => {
    // 浏览器把每个 4xx 都记一条 "Failed to load resource"。那类噪音由下面的
    // `forbidden` 逐条核对，不在这里当成页面故障——否则一条**正确的** 403 会让用例红。
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) {
      failures.push(`console error: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => failures.push(`page error: ${error.message}`));

  await loginAs(page, FULLSTACK_E2E.leadEmail, FULLSTACK_E2E.leadPassword);

  // 反证前提：这个名字现在**不在**列表里。没有这一步，下面的「它在列表里」证明不了是我建的。
  await expect(page.getByText(FULLSTACK_E2E.createdProjectName)).toHaveCount(0);

  await page.goto("/project/new");
  await expect(page.getByTestId("project-new")).toBeVisible();

  // #4615：默认新建的是通用项目（一步：名称 → 创建）；工作坊流程退到次要入口。
  await expect(page.getByTestId("project-new-workshop-link")).toBeVisible();

  await page.getByTestId("project-new-name").fill(FULLSTACK_E2E.createdProjectName);
  await page.getByTestId("project-new-create").click();

  // 建成后停在刚建成的那个项目上——URL 里的 id 是响应体回来的真实主键。
  await page.waitForURL(/\/projects\/[^/?]+\?org=/);
  const createdId = new URL(page.url()).pathname.split("/")[2]!;
  expect(createdId.length).toBeGreaterThan(0);
  expect(creates).toEqual([201]);

  // ── 第 ① 件：真的落库了，不是 React state ─────────────────────────────
  // 一次全新的页面加载 + 全新的 `GET /projects`；React 里的任何东西都不会活过来。
  //
  // ⚠ 2026-08-17：Q-4② 推翻后创建者也有 `project_memberships` 行了（见下方第 ③ 件），
  //   所以这里不再断言「只出现在 managed 段、不在 member 段」——lead 现在两边都够格，
  //   这条卡片存在即可，具体落在哪个分段不是本用例要守的性质。
  await page.goto("/projects");
  await expect(page.getByTestId(`projects-card-${createdId}-name`))
    .toHaveText(FULLSTACK_E2E.createdProjectName);

  // ── 第 ② 件：那个 id 指向的确实是这个项目 ──────────────────────────────
  await page.goto(`/projects/${createdId}?org=${FULLSTACK_E2E.orgId}`);
  await expect(page.getByTestId("project-title")).toHaveText(FULLSTACK_E2E.createdProjectName);

  /**
   * ── 第 ③ 件：创建者能读自己刚建的项目 ─────────────────────────────────
   *
   * ⚠ 2026-08-17：Q-4② 被推翻（原裁「创建者不自动获角色」，人类会话中直接改判
   *   「自动获得最高权限，owner，是的」，见 F199 / requirements/00-project/
   *   OPEN-QUESTIONS.md「Q-4② 推翻重裁」一节）。本条曾经断言 `GET
   *   /projects/:id/overview` 被服务端判 403——那不是缺陷，是旧不变量在真栈上生效；
   *   F199 落地后 `PgProjectRepository.create()` 在同一事务里给创建者写一行
   *   `project_memberships`（workshop 容器：`project_role='facilitator'`，
   *   `is_host=true`），overview 现在读得到，403 不应该再出现。
   *
   *   断言写成「没有任何路径被 403」，而不是只删掉旧断言：删掉等于把这条路径的
   *   越权拒绝检查整个摘掉，任何新出现的意外拒绝都会从此静默——那正是这份文件
   *   一直以来要守住的性质（见本文件其它用例的同款反证纪律）。
   */
  await page.goto(`/projects/${createdId}?org=${FULLSTACK_E2E.orgId}`);
  await expect(page.getByTestId("project-title")).toHaveText(FULLSTACK_E2E.createdProjectName);
  expect(forbidden).toEqual([]);
  expect(failures).toEqual([]);
});

test("an organization consultant can create and reopen a project through the same wizard", async ({ page }) => {
  const name = `${FULLSTACK_E2E.createdProjectName}_CONSULTANT`;
  await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
  await page.goto("/projects");
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);

  await page.goto("/project/new");
  await page.getByTestId("project-new-name").fill(name);
  const [response] = await Promise.all([
    page.waitForResponse((result) =>
      new URL(result.url()).pathname.replace(/^\/__fullstack_api/, "") === "/projects"
      && result.request().method() === "POST"),
    page.getByTestId("project-new-create").click(),
  ]);
  expect(response.status()).toBe(201);
  const { id } = await response.json() as { id: string };
  expect(id).toBeTruthy();
  await expect(page).toHaveURL(new RegExp(`/projects/${id}(?:[/?]|$)`));

  await page.goto("/projects");
  await expect(page.getByTestId(`projects-card-${id}-name`)).toHaveText(name);
});

test("counterproof: with the create request stubbed out in the browser, the project does not survive a reload", async ({ page }) => {
  const NAME = `${FULLSTACK_E2E.createdProjectName}_CP`;
  // 固定字面量即可：这个 id 从来不会到达服务端，不存在与库里任何行撞号的可能。
  const FAKE_ID = "project-pj01-counterproof-never-persisted";

  let intercepted = 0;
  await page.route("**/projects", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    intercepted += 1;
    // 契约 `createProject.out` 的合法形状，只是从来没有到过服务端。
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: FAKE_ID,
        kind: "workshop",
        status: "active",
        provenanceEventId: "ev-counterproof",
      }),
    });
  });

  await loginAs(page, FULLSTACK_E2E.leadEmail, FULLSTACK_E2E.leadPassword);
  await page.goto("/project/new");
  await page.getByTestId("project-new-name").fill(NAME);
  await page.getByTestId("project-new-create").click();

  // 拦截真的发生了——否则下面的「刷新后不在」可能只是因为这次根本没提交。
  await expect.poll(() => intercepted).toBe(1);
  // 界面一度当作成功：它按假响应体里的 id 跳走了。
  await page.waitForURL(new RegExp(`/projects/${FAKE_ID}`));

  // ⚠ 关键：这一行从来没进过库。刷新之后它不在。
  await page.goto("/projects");
  // ⚠ 先证明这次列表**真的读成功了**，再说「那一行不在」。少了这两条，一次读取失败
  //   会让「不在」恒成立，反证就变成了它自己要防的空转：屏上什么都没有，而断言全绿。
  await expect(page.getByTestId("projects-screen")).toBeVisible();
  await expect(page.getByTestId("projects-list-error")).toHaveCount(0);
  await expect(page.getByTestId(`projects-card-${FAKE_ID}-name`)).toHaveCount(0);
  await expect(page.getByText(NAME)).toHaveCount(0);
});
