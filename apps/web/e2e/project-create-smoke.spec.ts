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
 * ③ **权限是服务端说了算**。同一个界面动作换成非 `lead`（种子里的 consultant），
 *    必须在界面上看到 `ORG_ROLE_INSUFFICIENT`。
 *
 * ## ⚠ 反证：为什么第 ③ 条不是装饰
 *
 * 少了它，第 ①② 条在一个**根本不校验组织角色**的后端上照样全绿 —— 那时这个文件验的是
 * 「能建项目」，不是「只有 lead 能建项目」。而 U-4 那条裁决（admin 也不能建）正是
 * 「管理员不是超级用户」在本束的落点，抹掉了不会有任何红色告诉你。
 * 同理，第 ① 条先断言这个名字在列表里**不存在**：没有那一步，「列表里有它」就分不清
 * 是我建出来的，还是种子本来就有的（`capability-mutate-smoke.spec.ts` 在 #619 踩过这个）。
 *
 * ## 反证
 *
 * 第三条用例把创建请求在浏览器里拦掉、回一个契约形状的假 201 —— 界面一度显示成功，
 * 但那个项目从来没进过库，刷新之后列表里没有它。与
 * `canvas-template-create-smoke.spec.ts` / `skill-create-smoke.spec.ts` 同一套做法，
 * 且**常驻**（不靠环境变量，因此不会在生产代码里留一条「假装建成」的路径）。
 *
 * 另外实测过一次一次性反证（2026-08-12，记在 issue #976）：把 `handleCreate` 里的
 * `createProject(...)` 换成直接跳转，前两条用例双双变红（一条红在收不到 201，
 * 一条红在界面上没有 `ORG_ROLE_INSUFFICIENT`）—— 那份改动没有留在代码里。
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
  await expect(page).toHaveURL(/\/projects$/);
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

  // 蓝本后端零实现 → 九宫格如实禁用，本版走契约的空白新建路径（blueprintVersionId=null）。
  await expect(page.getByTestId("project-new-blueprint-unavailable")).toBeVisible();

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
  // ⚠ 它出现在 **managed** 段而不是 member 段，这是对的：「创建不自动授予项目角色」
  //   是已裁不变量（Q-4②），lead 看得见它是因为他**管着**它，不是因为他在里面。
  await page.goto("/projects");
  await expect(page.getByTestId(`projects-card-${createdId}-name`))
    .toHaveText(FULLSTACK_E2E.createdProjectName);

  // ── 第 ② 件：那个 id 指向的确实是这个项目 ──────────────────────────────
  await page.goto(`/projects/${createdId}?org=${FULLSTACK_E2E.orgId}`);
  await expect(page.getByTestId("project-title")).toHaveText(FULLSTACK_E2E.createdProjectName);

  /**
   * ── 第 ③ 件：「创建不自动授予项目角色」在真实后端上是活的 ─────────────────
   *
   * 这一条是实测撞出来的，不是设计出来的：工作台打开时 `GET /projects/:id/overview`
   * 被服务端判 **403**。它**不是缺陷** —— 恰恰是 Q-4② 那条已裁不变量在真栈上生效：
   * 建项目的人不会因为建了它就获得项目角色，而 overview 读的是项目内容，要项目角色。
   * 所以他能在列表的 **managed** 段看见它（他管着它），却读不到里面的内容。
   *
   * 断言写成「403 只出现在 overview 这一条路径上」，而不是把 403 一律放过：
   * 后者会让**任何**新出现的越权拒绝从此静默，包括真的坏掉的那种。
   *
   * ⚠ 2026-08-13：这里去重后再比较（`Set` 而不是数组 `toEqual`）——
   *   CI 的 fullstack-smoke job 上先后两次（PR #1135、#1139，均与本文件无关的改动）
   *   实测到同一条 overview 请求被记录**两次**（数组里两项内容完全相同），
   *   重跑同一 job 即过，说明是真实的偶发重复请求，不是断言要守的性质本身出了问题——
   *   要守的性质是「越权确实被拒绝了，且没有其它路径被意外拒绝」，不是「请求恰好发生一次」，
   *   后者是实现细节，不该绑进这条断言。`Set` 比较同时保住两头：出现 0 次（没被拒绝，
   *   真缺陷）或出现在别的路径上（意外越权拒绝，真缺陷）都仍然会红。
   *
   *   排查过根因但没有直接改代码：`ProjectWorkbench` 里 `getProjectOverview` 那个
   *   effect（`project-workbench.tsx`）只用 `cancelled` 标志挡 `setState`，没有用
   *   `AbortController` 真正取消已发出的请求，重跑时能留下一次悬空的重复请求——
   *   这是相符的一个诱因。但实测把它接上 `AbortController` 后本地反而更容易复现失败
   *   （5 次里 2 次 `forbidden` 变成空集：第二次挂载的请求被 abort 打断的时机比断言
   *   检查的时机更慢，403 还没落地断言已经跑到这里），说明真正的重复挂载/重复请求
   *   在生产构建（`next build && next start`，本文件用的正是这个而非 `next dev`，
   *   所以不能简单归因于 React StrictMode 的开发态双跑）下另有诱因，没有确证，
   *   贸然改会把「重复 403」的偶发红变成「零 403」的偶发红，反而更差。
   *   保留现状，只放宽断言。
   */
  expect(new Set(forbidden)).toEqual(new Set([`/projects/${createdId}/overview`]));
  expect(failures).toEqual([]);
});

test("a non-lead walking the same wizard is refused by the server, and the refusal is shown", async ({ page }) => {
  // 种子里的这一位是 `consultant`，不是 `lead`——见 fixture 里为什么不复用/不升权。
  await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);

  await page.goto("/project/new");
  await page.getByTestId("project-new-name").fill(`${FULLSTACK_E2E.createdProjectName}_DENIED`);
  await page.getByTestId("project-new-create").click();

  // 界面上如实显示服务端的拒绝原因码，而不是静默失败或假装建成了。
  await expect(page.getByTestId("project-new-error")).toContainText("ORG_ROLE_INSUFFICIENT");
  // 没有跳转：项目并没有建成。
  await expect(page).toHaveURL(/\/project\/new$/);
  // 按钮恢复可点——被拒绝的人不该被界面永久锁死。
  await expect(page.getByTestId("project-new-create")).toBeEnabled();

  // 而且库里真的没有这一行：拒绝是服务端拒绝，不只是界面上的一句话。
  await page.goto("/projects");
  await expect(page.getByText(`${FULLSTACK_E2E.createdProjectName}_DENIED`)).toHaveCount(0);
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
