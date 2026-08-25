import { test, expect } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { COPILOTKIT_V2_SELECTED_AGENT_HEADER } from "../lib/copilotkit-v2-agent-header";

/**
 * issue #2023（差距清单第 4 项，Agent 选择/切换）—— 证明 `/chat/copilotkit-v2` 的
 * `AgentPicker` 不是一个只改 UI 状态的假选择器：选中一个**非默认**的真实已发布 agent
 * 之后，浏览器打给 `/api/copilotkit/*` 的请求真的带着那个 agent 的标识（wire 上的
 * header，不是 UI 显示"已选中"），并且回复内容真的来自该 agent 对应的下游 provider
 * ——不是 UI 显示换了、后端其实还在打旧的那个。
 *
 * ## 为什么选 `CHAT_READ_E2E.agentId`（"Read Agent"，loopback-echo）
 *
 * `playwright.chat-read.config.ts` 的 webServer 把 `COPILOTKIT_V2_AGENT_ID` 固定设成
 * `CHAT_READ_E2E.deepAgentId`（"Deep Research Agent"，`deep-agent` provider）——这是
 * "没有做任何选择时"的服务端默认值。选 `agentId`（走完全不同的 `chat-read-loopback`
 * provider，回复固定带 `agentReplyPrefix "[loopback]"` 前缀）是本 spec 唯一需要的
 * "非默认切换"：如果适配器真的按浏览器的选择路由，回复必须带着 `[loopback]` 前缀；
 * 如果适配器忽略了选择、悄悄还在打环境变量里那个 deep-agent，回复不会有这个前缀
 * （deep-agent loopback 替身的确定性回复没有这个字符串，见
 * `loopback-deep-agent-provider.ts`）——两者的回复文本结构性不同，不是同一段文案的
 * 不同措辞，断言不会产生假阳性。
 *
 * ## 两层证据，缺一不可
 *
 * ① wire 上浏览器发给 `/api/copilotkit/*` 的请求真的带着
 *    `x-workspacex-copilotkit-v2-agent-id: agent-chat-read-e2e`（不是 `-deep`）——
 *    `route.ts` 的 `AgentsFactory`/`resolveAgentId` 读的正是这个 header。
 * ② 回复文本真的换成了 loopback provider 的确定性签名（`[loopback] <原话>`），
 *    证明这个 header 不只是"发出去了"，而是真的改变了后端最终路由到的 agent——
 *    这是「不是断言 UI 显示选中，而是断言 wire 上请求真的路由到了选中的 agent」
 *    这条判据要求的因果闭环，不只是"header 存在"这一半。
 */
// 预算实测记录（2026-08-25 本地，三轮）：120s 总超时在 dev 首编译 + 高负载下不够
// （run2 两用例均在 `page.goto` 处被打断）；页面预热 90s 也不够（run3 用例 1 在预热
// poll 超时，`/chat/copilotkit-v2` 首编译实测要 2-3 分钟）——run3 用例 2（编译已热）
// 一路跑到最终断言，证明超出预算的只有首编译，不是链路本身。300s + 180s 预热按
// 实测上界给足，与 `copilotkit-v2-runtime-adapter.spec.ts` 的 180s 同一条"给足首次
// 编译窗口"纪律，只是本 spec 是套件里第一个跑的文件、独自付全部编译成本。
test.setTimeout(300_000);

async function warmUpCopilotRuntimeRoute(page: import("@playwright/test").Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/copilotkit/info");
        return res.status();
      },
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(200);
  // 页面路由本身的首次编译也要预热掉（同上一条实测记录）：`page.request.get` 只触发
  // 服务端编译，不占页面帧，编译完成后真正的 `page.goto` 走的就是热路径。
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/chat/copilotkit-v2");
        return res.status();
      },
      { timeout: 180_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(200);
}

test("AgentPicker 真实切到非默认 agent——wire 上的请求 header 与回复来源都换了", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);

  await warmUpCopilotRuntimeRoute(page);
  await page.goto("/chat/copilotkit-v2");

  // ── 候选列表真的列出了两个真实已发布 agent（不是硬编码的假下拉） ──────────────
  const trigger = page.getByTestId("chat-agent-select");
  await expect(trigger).toBeVisible({ timeout: 20_000 });
  await trigger.click();
  const listbox = page.getByTestId("chat-agent-select-listbox");
  await expect(listbox).toBeVisible();
  await expect(page.getByTestId(`chat-agent-select-option-${CHAT_READ_E2E.agentId}`)).toBeVisible();
  await expect(page.getByTestId(`chat-agent-select-option-${CHAT_READ_E2E.deepAgentId}`)).toBeVisible();

  // ── 选中非默认的 loopback agent ────────────────────────────────────────────
  await page.getByTestId(`chat-agent-select-option-${CHAT_READ_E2E.agentId}`).click();
  await expect(listbox).toBeHidden();

  // 切换 agent = 发起新对话（`key={selectedAgentId}` 强制重挂载），composer 应该是空的、
  // 可以立刻发消息。
  const userText = "issue #2023 agent 切换取证";
  let capturedAgentHeader: string | null | undefined;
  let capturedRunUrl = "";

  await page.route(
    (u) => u.pathname.includes("/api/copilotkit/") && u.pathname !== "/api/copilotkit/info",
    async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      capturedAgentHeader = await route.request().headerValue(COPILOTKIT_V2_SELECTED_AGENT_HEADER);
      capturedRunUrl = route.request().url();
      await route.continue();
    },
  );

  await page.getByTestId("copilotkit-v2-input").fill(userText);
  await page.getByTestId("copilotkit-v2-send").click();

  // ── 反证① wire 上的请求真的带着选中的（非默认）agent id ──────────────────────
  await expect.poll(() => capturedAgentHeader !== undefined, { timeout: 30_000 }).toBe(true);
  expect(capturedRunUrl).toContain("/api/copilotkit/");
  expect(capturedAgentHeader).toBe(CHAT_READ_E2E.agentId);
  expect(capturedAgentHeader).not.toBe(CHAT_READ_E2E.deepAgentId);

  // ── 反证② 回复内容真的来自 loopback provider（不是环境变量默认的 deep-agent）───
  const messages = page.getByTestId("copilotkit-v2-messages");
  await expect(messages).toContainText(CHAT_READ_E2E.agentReplyPrefix, { timeout: 30_000 });
  await expect(messages).toContainText(userText);
  // deep-agent loopback 替身的确定性签名不应该出现——如果出现了，说明选择被忽略，
  // 请求实际上还是打到了环境变量里那个默认 agent。
  await expect(messages).not.toContainText("已查询当前时间");

  await page.unroute("**/api/copilotkit/**");
});

/**
 * 反向对照（向后兼容判据）：**不做任何选择**时，行为必须与本任务之前逐字节相同——
 * 请求**不带**选择 header，服务端回退到 `COPILOTKIT_V2_AGENT_ID` 环境变量指向的
 * deep-agent（本 config 固定设成 `CHAT_READ_E2E.deepAgentId`），回复带着 deep-agent
 * loopback 替身的确定性签名。
 *
 * ## 为什么是"不带 header"而不是"自动选中第一个候选"（run5 对照实验的教训）
 *
 * 第一版面板在候选列表就绪后自动选中目录第一个 agent——run5 同栈对照实验抓到它是
 * 一个真回归：目录序第一恰好是 `catalogOnlyAgentId`（#467 种的"只进目录、从未发布"
 * agent），自动选中它 = 所有"不做选择"的既有用例（runtime-adapter 三条）的请求被
 * header 改道到一个必然 `AGENT_NOT_FOUND` 的 agent，env 默认路径被劫持，三条当场红。
 * 面板已改为不自动选择（`copilotkit-v2-panel.tsx` 的注释记录了同一段实测）；本用例
 * 断言的就是这条"不选 = 不带 header = 服务端默认"的既有路径完好无损。
 */
test("不做选择时不带选择 header——服务端 env 默认路径完好，回复来自默认 deep-agent", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);

  await warmUpCopilotRuntimeRoute(page);
  await page.goto("/chat/copilotkit-v2");

  // 选择器在场（能选），但**不点它**——这是本用例的全部前提。
  const trigger = page.getByTestId("chat-agent-select");
  await expect(trigger).toBeVisible({ timeout: 20_000 });

  let sawRunRequest = false;
  let capturedAgentHeader: string | null = null;
  await page.route(
    (u) => u.pathname.includes("/api/copilotkit/") && u.pathname !== "/api/copilotkit/info",
    async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      capturedAgentHeader = await route.request().headerValue(COPILOTKIT_V2_SELECTED_AGENT_HEADER);
      sawRunRequest = true;
      await route.continue();
    },
  );

  const userText = "不选择时走服务端默认";
  await page.getByTestId("copilotkit-v2-input").fill(userText);
  await page.getByTestId("copilotkit-v2-send").click();

  await expect.poll(() => sawRunRequest, { timeout: 30_000 }).toBe(true);
  // ── 反证① 请求上**没有**选择 header——前端没有编造一个选择去劫持服务端默认。
  expect(capturedAgentHeader).toBeNull();

  // ── 反证② 回复真的来自 env 默认的 deep-agent（loopback 替身确定性签名），
  //    而不是无回复/错误——默认路径不只是"没被改道"，还得真的能用。
  const messages = page.getByTestId("copilotkit-v2-messages");
  await expect(messages).toContainText("已查询当前时间", { timeout: 60_000 });
  await expect(page.getByTestId("copilotkit-v2-error")).toHaveCount(0);

  await page.unroute("**/api/copilotkit/**");
});
