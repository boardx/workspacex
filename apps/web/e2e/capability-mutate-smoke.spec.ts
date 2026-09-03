/**
 * #458 —— Agent 目录写路径的**真实浏览器**门控。
 *
 * 链路一节不许省：Chromium → Next 同源代理 → NestJS 控制器 → application 用例
 * → repository → PostgreSQL。中途没有任何一处塞假数据。
 *
 * ## 三件事在这里被证明，别处证不了
 *
 * ① **「刷新后仍在」**。组件测试里的「刷新」只是再调一次 fetch mock；
 *    只有真的重新加载页面，才能区分「写进了库」和「写进了 React state」。
 *    所以这里 `page.reload()` 之后再断言那一行还在。
 * ② **停用真的改变了持久化状态**。停用后重新加载，那一行必须显示「已停用」。
 * ③ **权限是服务端说了算**。同一个 `POST /capabilities/mutate`，
 *    换成非管理员的会话在浏览器里直接发出去 —— 必须拿到 403。
 *    「按钮没显示」不构成权限，这条断言绕过界面直接打接口正是为此。
 *
 * ⚠ 单独成文件而不是并进 `fullstack-smoke.spec.ts`：那个文件的每一条 `page.goto`
 *   都被 `.harness/scripts/fullstack-smoke.test.ts` 按**出现次数**钉死（#387 的反空转手段）。
 *   往里加登录会让那些计数失效，而唯一「让它变绿」的改法是去放宽 #387 的门控——
 *   那是本仓明令禁止的方向。两个 spec 共用同一套 webServer 与同一个库，串行执行。
 */
import { expect, test } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

const API = "/__fullstack_api";

async function loginAs(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

test("admin creates and disables an Agent through the browser, and PostgreSQL keeps it across reloads", async ({ page }) => {
  const failures: string[] = [];
  const mutations: number[] = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname.replace(/^\/__fullstack_api/, "");
    if (path === "/capabilities/mutate" && response.request().method() === "POST") {
      mutations.push(response.status());
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console error: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page error: ${error.message}`));

  await loginAs(page, FULLSTACK_E2E.adminEmail, FULLSTACK_E2E.adminPassword);

  await page.goto("/platform-admin/agent");
  await expect(page.getByTestId("admin-agent-catalog")).toBeVisible();
  /**
   * ⚠ #619 起这里**不能**再断言「整个目录是空的」。
   *
   * 原断言是 `admin-agent-empty` 可见，注释写着「种子刻意没有预置 capability 行」。
   * 那个前提在 #619 之后不再成立：roster 的合法性判据已从 `org_agents` 收敛到
   * `capability_listings`，所以 `seed-fullstack-smoke.ts` **必须**给那个可运行的种子
   * agent（`FULLSTACK_RUNNABLE_AGENT_*`）也插一行 listing，否则 `core-loop.spec.ts`
   * 在编制选择器里根本选不到它。目录里有一行是**对的**，不是污染。
   *
   * 但这条断言**承担的职责必须保留**：它是反证——证明下面看到的那一行来自浏览器里的
   * 「新增」动作，而不是种子本来就有的。所以把「全局空」换成「**待新建的这一个**不存在」，
   * 反证强度不变（种子那行叫 `FULLSTACK_RUNNABLE_AGENT_*`，与这里要建的
   * `FULLSTACK_AGENT_*` 是两个不同的名字，不会互相冒充）。
   * ⛔ 不要改回 `admin-agent-empty`，也不要删掉这条——删了这个用例就变成
   *    「目录里有一行」而不是「我建出了一行」。
   */
  await expect(page.getByTestId("admin-agent-list").getByText(FULLSTACK_E2E.agentName))
    .toHaveCount(0);

  // ── 新增 ───────────────────────────────────────────────────────────────
  // ⚠ #619 起 `kind='agent'` 的目录条目**必须**带非空 abbr/duty（前端字段级校验 +
  //   服务端 400 + 数据库 `capability_listings_agent_needs_abbr_duty` CHECK，三层同一条规则）。
  //   只填 name 会被前端挡在提交之前 ⇒ 压根不发请求 ⇒ 下面 `mutations` 是空数组、列表里
  //   也不会出现这一行。`e54fb9a1` 当时只补了单测（`capability-catalog-mutate.test.tsx`）
  //   的这两个输入，**漏了本文件这条真实浏览器路径**，于是 CI 上以 line 78 的形式暴露出来。
  await page.getByTestId("admin-agent-create").click();
  await page.getByTestId("admin-agent-create-name").fill(FULLSTACK_E2E.agentName);
  await page.getByTestId("admin-agent-create-abbr").fill("FA");
  await page.getByTestId("admin-agent-create-duty").fill("fullstack smoke 建出来的 agent");
  await page.getByTestId("admin-agent-create-submit").click();

  const row = page.getByTestId("admin-agent-list").getByText(FULLSTACK_E2E.agentName);
  await expect(row).toBeVisible();
  expect(mutations).toEqual([200]);

  // ── 刷新后仍在 = 它在库里，不在 React state 里 ──────────────────────────
  await page.reload();
  await expect(page.getByTestId("admin-agent-list").getByText(FULLSTACK_E2E.agentName)).toBeVisible();
  await expect(page.getByTestId("admin-agent-empty")).toHaveCount(0);

  // ── 停用 ───────────────────────────────────────────────────────────────
  const card = page.locator('[data-testid^="admin-agent-row-"]').filter({
    hasText: FULLSTACK_E2E.agentName,
  });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("已启用");
  await card.getByRole("button", { name: "停用" }).click();
  await page.getByTestId("admin-agent-disable-confirm").click();
  await expect(card).toContainText("已停用");
  expect(mutations).toEqual([200, 200]);

  // 停用同样要熬过一次真实刷新，否则「状态变更」只是本地的。
  await page.reload();
  const afterReload = page.locator('[data-testid^="admin-agent-row-"]').filter({
    hasText: FULLSTACK_E2E.agentName,
  });
  await expect(afterReload).toContainText("已停用");
  // 已停用的行不再提供停用入口——重复停用只会写出一条什么都没改变的 provenance。
  await expect(afterReload.getByRole("button", { name: "停用" })).toHaveCount(0);

  expect(failures).toEqual([]);
  console.log(`[capability-mutate-smoke] agent=${FULLSTACK_E2E.agentName} mutations=${mutations.join(",")}`);
});

test("a non-admin session is refused by the SERVER, not by a hidden button", async ({ page }) => {
  // #458 自己的 consultant，不借用 #387 那位——理由见 fixture。
  await loginAs(page, FULLSTACK_E2E.memberEmail, FULLSTACK_E2E.memberPassword);

  await page.goto("/platform-admin/agent");
  await expect(page.getByTestId("admin-agent-catalog")).toBeVisible();
  // 界面这一侧：非管理员看不到写入口。这只是降噪，**下面那半才是权限**。
  await expect(page.getByTestId("admin-agent-create")).toHaveCount(0);

  // 界面这一侧的缺席什么也证明不了——所以带着这个真实会话，从浏览器里直接打接口。
  const refused = await page.evaluate(async ({ api, orgId, name }) => {
    const res = await fetch(`${api}/capabilities/mutate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${window.localStorage.getItem("wsx.sessionToken")}`,
      },
      body: JSON.stringify({
        orgId, kind: "agent", op: "add",
        payload: { name, scope: "org-wide" },
      }),
    });
    return { status: res.status, body: await res.text() };
  }, { api: API, orgId: FULLSTACK_E2E.orgId, name: `${FULLSTACK_E2E.agentName}_ESCALATION` });

  expect(refused.status).toBe(403);
  expect(refused.body).toContain("PROJECT_ROLE_INSUFFICIENT");

  // 而且它真的没写进去：刷新目录，越权那一条不存在。
  await page.reload();
  await expect(page.getByTestId("admin-agent-catalog")).toBeVisible();
  await expect(page.getByText(`${FULLSTACK_E2E.agentName}_ESCALATION`)).toHaveCount(0);
});
