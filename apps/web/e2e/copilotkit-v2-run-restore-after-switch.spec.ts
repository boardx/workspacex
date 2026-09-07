import { test, expect, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * issue #2825 —— 「提交任务 → 切到别的会话 → 切回来」之后恢复不了状态。
 *
 * ## 复现的是哪一条真实失败，为什么这样搭
 *
 * 用户实测截图里的两帧：切回来后先是「正在恢复上次未完成的任务…」一直转，最后落到
 * 「长时间未能确认上一条任务是否已经完成…请稍后刷新页面查看」，而那条助手回复其实
 * 早就写回落库了（刷新一下就能看见）。
 *
 * 病灶（见 `lib/copilotkit-v2-run-restore.ts` issue #2825 那节头注）：恢复核实**只**
 * 在收到一条终态 `status_change` WS 事件时才结束。事件流回答的是「从现在起还会发生
 * 什么」，不是「它现在是什么状态」——事件收不到（网关不可达、进程重启过、重放缓冲区
 * 已被挤掉）时，那条事件永远不会来，于是恢复永远不结束。
 *
 * 所以这条 spec 用 `page.routeWebSocket` 把 `WS /agent-runs/:runId/events` **打死**——
 * 这不是"人为制造一个不存在的故障"，这正是截图里那一帧的成因（`gave-up` 的
 * `connection-lost` 分支只有连接层面撑不住时才走得到）。断言：即使这条事件流完全
 * 不可用，切回来之后助手回复仍然出现，且那句"长时间未能确认"的错误提示**不**出现。
 *
 * 反证方向（这条断言不是恒真）：把 `copilotkit-v2-run-restore.ts` 的权威读去掉，
 * 这条 spec 会红在"消息区始终等不到回复原文 + 错误提示出现"上——本地已实测。
 *
 * 编排复用 `playwright.chat-read.config.ts`（真登录 + 真 Postgres + deep-agent
 * loopback 替身），与本目录其它 `copilotkit-v2-*.spec.ts` 同一条既有理由：单自建
 * runner 是硬瓶颈，不为一条 spec 再起一套 webServer。
 */
test.setTimeout(300_000);

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);
}

async function warmUpCopilotRuntimeRoute(page: Page): Promise<void> {
  await expect
    .poll(async () => (await page.request.get("/api/copilotkit/info")).status(), {
      timeout: 60_000,
      intervals: [500, 1_000, 2_000],
    })
    .toBe(200);
}

test("提交任务→切走→切回：run 事件流不可用时，恢复仍靠权威读收尾，回复出现且不谎称『没能确认』", async ({ page }) => {
  await login(page);
  await warmUpCopilotRuntimeRoute(page);

  // 把 run 事件订阅打死——截图里那一帧的成因（见文件头注）。握手一建立就断开，
  // 客户端会走完重连预算后判定 `connection-lost`。
  let closedSockets = 0;
  await page.routeWebSocket(/\/agent-runs\/[^/]+\/events/, (ws) => { closedSockets += 1; ws.close(); });
  // Disable the newer journal fallback too: this case must prove the authoritative run GET.
  await page.route(/\/agent-runs\/[^/]+\/execution-events(?:\?|$)/, route => route.abort());

  await page.goto("/chat");

  // 多步剧本让这一轮 run 真的跑一段时间——切走再切回时它必须**还在途**，否则挂载
  // hydration 直接读到已经写回的回复（`findPendingRunId` 为 null），这条恢复路径
  // 根本不会被触发，整条用例会变成一条什么都没验证的"绿"。下面第 ① 条断言正是
  // 为了机械地挡住这种空转。
  const marker = CHAT_READ_E2E.deepAgentMultiStepTrigger;
  const initialRunResponse = page.waitForResponse(async response => {
    if (!response.ok() || !/\/agent-runs\/[^/?]+$/.test(new URL(response.url()).pathname)) return false;
    return (await response.json()).status === "running";
  }, { timeout: 60_000 });
  await page.getByTestId("copilotkit-v2-input").fill(marker);
  await page.getByTestId("copilotkit-v2-send").click();
  // 用户气泡出现 = 这一轮已经真的发出去了（`agent_runs` 行已建、人类消息已带 runId）。
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(marker, { timeout: 60_000 });
  await page.waitForURL(/\/chat\/[^/]+$/);
  const firstThreadUrl = page.url();
  const firstThreadId = firstThreadUrl.split("/").pop()!;
  const runResponse = await initialRunResponse;
  const run = await runResponse.json() as {runId: string; threadId: string};
  expect(run.threadId).toBe(firstThreadId);

  // 切到另一条会话：真实路由导航，面板整体卸载——内存里的在途 run 状态到此全丢。
  await page.getByTestId("chat-thread-create").click();
  await page.waitForURL(/\/chat\/[^/]+$/);
  await expect(page).not.toHaveURL(firstThreadUrl);

  // Arm the observer before remounting. Requiring a real nonterminal response after
  // remount prevents a completed hydration path from masquerading as run recovery.
  const restoringRun = page.waitForResponse(async response => {
    if (!response.ok() || response.url() !== runResponse.url()) return false;
    const value = await response.json();
    return value.status === "running" && value.resultMessageId === null;
  }, { timeout: 30_000 });
  const settledRun = page.waitForResponse(async response => {
    if (!response.ok() || response.url() !== runResponse.url()) return false;
    const value = await response.json();
    return value.status === "succeeded" && typeof value.resultMessageId === "string";
  }, { timeout: 120_000 });
  await page.getByTestId(`chat-thread-${firstThreadId}`).click();
  await page.waitForURL(firstThreadUrl);
  await restoringRun;
  const final = await (await settledRun).json() as {resultMessageId: string};
  expect(closedSockets).toBeGreaterThan(0);
  const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
  expect(token).toBeTruthy();
  const apiBase = new URL(runResponse.url()).origin;
  const stored = await page.request.get(`${apiBase}/chat/threads/${firstThreadId}/messages?limit=100`, {
    headers: {Authorization: `Bearer ${token}`},
  });
  expect(stored.ok()).toBe(true);
  const finalMessage = (await stored.json()).messages.find((message: {id: string}) => message.id === final.resultMessageId);
  expect(finalMessage?.agentRunId).toBe(run.runId);
  expect(finalMessage?.text).toContain("多步依赖链已完整执行");
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(finalMessage.text, { timeout: 30_000 });

  // The run's authoritative recovery succeeded above. Journal replay remains
  // deliberately unavailable, so its truthful, separate warning must remain visible.
  // Require exactly that warning; unrelated or false task-recovery errors still fail.
  await expect(page.getByTestId("copilotkit-v2-error")).toHaveCount(1);
  await expect(page.getByTestId("copilotkit-v2-error")).toHaveText("执行过程暂时无法恢复，请刷新重试。");
  await expect(page.getByText(/长时间未能确认上一条任务|上一条任务已超过 3 分钟没有任何进展|登录状态可能已过期/)).toHaveCount(0);
  // ④ 恢复阶段的文案已经收掉，不是永远转着。
  await expect(page.getByText("正在恢复上次未完成的任务…")).toHaveCount(0);
});
