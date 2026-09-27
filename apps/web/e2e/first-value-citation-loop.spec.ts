import { test, expect } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import {
  openFreshDeepAgentThread,
  sendInV2AndAwaitStoredReply,
  sessionHeaders,
} from "./support/chat-path-coverage";

/**
 * issue #4260 —— **第一个价值时刻的引用闭环**，不需要任何模型凭据的全栈 e2e。
 *
 * 链路（每一跳都是真代码、真 HTTP、真 PostgreSQL；只有「模型决定调什么工具」由确定性
 * deep-agent 替身扮演，见 `apps/api/scripts/loopback-deep-agent-provider.ts` 的 `CITE_TRIGGER`）：
 *
 *   自有材料（非示例项目，已建组织索引）
 *     → 用户在聊天里问触发句
 *     → 替身经 run 回调**真的**调 `wx_knowledge_search`（organization-index）拿到 sourceId/versionId
 *     → 再**真的**调 `wx_cite`：API 重读来源、校验版本，通过才记进 `agent_runs.cited_sources`
 *     → 终稿写 `[n]`（n = API 回的 index）；写回时编号落 `chat_citations`、记
 *       `cited_answer_own_material`
 *     → 界面：正文 `[1]` 可点 + 引用列表；点开 ⇒ `GET /chat/citations/:id` ⇒ 记 `citation_opened`
 *     → org admin 读 `GET /org/first-value-funnel`，两步都已到达。
 *
 * ## 「上传」这一步为什么在种子里
 *
 * 目前没有 HTTP 路由能把文件传进**项目**（契约 `uploadArtifact` 的
 * `/projects/:projectId/artifacts/upload` 无控制器；文件页的上传弹窗是 mock）。聊天附件虽然能
 * 真传，但它产出的引用没有 `sourceArtifactId`，按 `persist-assistant-citations.ts` 的判据
 * **永远不会**记 `cited_answer_own_material`。所以材料由 `seed-chat-read-e2e.ts` 经
 * `uploadArtifact`（示例项目同一个用例）传进一个非示例项目，并经
 * `POST /artifact-versions/:id/index` 背后的同一个服务建索引。
 *
 * ## 判据只认会随状况改变的信号
 *
 * · `[1]` 标记只在 `chat_citations` 真有第 1 条时才会渲成可点按钮（`remarkCitationMarkers`
 *   只替换「有对应引用」的 `[n]`）；引用被拒时替身终稿不带 `[n]`，这里如实红。
 * · 点开判的是 `GET /chat/citations/:id` 的真实 200，不是展开动画。
 * · 漏斗判的是服务端事实表，不是前端状态。
 */

test.setTimeout(300_000);

const MARKER = "chat-citation-marker";

test("第一个价值时刻：检索自有材料 → wx_cite → 可点 [1] → 漏斗记下 own_material 与 citation_opened", async ({ page, browser }) => {
  const threadId = await openFreshDeepAgentThread(page);

  /* ① 发触发句，等落库回复里真的带 `[1]`（权威读，不看渲染帧）。 */
  await sendInV2AndAwaitStoredReply(page, threadId, CHAT_READ_E2E.firstValueCiteTrigger, "[1]");

  /* ② 正文里的 `[1]` 是可点标记，下方有引用列表。
   *    引用来自 `getThread`（`ThreadCitationsProvider`）；若这一帧的线程详情是在写回之前读的，
   *    重载一次拿写回之后的那份——判据仍是「标记真的渲出来」，不放宽。 */
  const marker = page.getByTestId(MARKER).filter({ hasText: "[1]" }).first();
  await expect(async () => {
    if (!(await marker.isVisible())) await page.reload();
    await expect(marker).toBeVisible({ timeout: 20_000 });
  }).toPass({ timeout: 150_000 });
  await expect(marker).toHaveAttribute("data-citation-index", "1");
  const list = page.getByTestId("chat-citations").first();
  await expect(list).toBeVisible();
  await expect(list.getByTestId("chat-citation-row").first()).toContainText("第 1 页");

  /* ③ 点开：真的打到定位端点并拿到 200，展开锚点。 */
  const located = page.waitForResponse((response) => (
    response.request().method() === "GET"
    && /\/chat\/citations\/[^/]+$/.test(new URL(response.url()).pathname)
  ));
  await marker.click();
  expect((await located).status(), "点开引用应定位成功（200），否则不会记 citation_opened").toBe(200);
  await expect(page.getByTestId("chat-citation-anchor").first()).toBeVisible();

  /* ④ org admin 读本组织漏斗：两步都已到达（事实表 fire-and-forget，轮询等它落库）。 */
  const apiPort = process.env.WORKSPACEX_API_PORT;
  expect(apiPort, "WORKSPACEX_API_PORT 应由隔离外壳下发（playwright.chat-read.config.ts 也读它）").toBeTruthy();
  const adminContext = await browser.newContext();
  try {
    const admin = await adminContext.newPage();
    await admin.goto("/login");
    await admin.getByTestId("login-email").fill(CHAT_READ_E2E.seedAdminEmail);
    await admin.getByTestId("login-password").fill(CHAT_READ_E2E.password);
    await admin.getByTestId("login-submit").click();
    await admin.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
    const headers = await sessionHeaders(admin);
    const reached = async (): Promise<Record<string, boolean>> => {
      const response = await admin.request.get(`http://127.0.0.1:${apiPort}/org/first-value-funnel`, { headers });
      expect(response.status(), "漏斗端点只对 org admin 开放；种子 admin 应拿到 200").toBe(200);
      const body = await response.json() as { steps: { step: string; occurredAt: string | null }[] };
      return Object.fromEntries(body.steps.map((s) => [s.step, s.occurredAt !== null]));
    };
    await expect
      .poll(reached, { timeout: 30_000, intervals: [500, 1_000, 2_000] })
      .toMatchObject({ cited_answer_own_material: true, citation_opened: true });
  } finally {
    await adminContext.close();
  }
});
