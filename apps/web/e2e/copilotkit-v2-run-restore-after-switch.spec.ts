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
  await page.routeWebSocket(/\/agent-runs\/[^/]+\/events/, (ws) => ws.close());

  await page.goto("/chat");

  // 多步剧本让这一轮 run 真的跑一段时间——切走再切回时它必须**还在途**，否则挂载
  // hydration 直接读到已经写回的回复（`findPendingRunId` 为 null），这条恢复路径
  // 根本不会被触发，整条用例会变成一条什么都没验证的"绿"。下面第 ① 条断言正是
  // 为了机械地挡住这种空转。
  const marker = `${CHAT_READ_E2E.deepAgentMultiStepTrigger} #2825-${Date.now()}`;
  await page.getByTestId("copilotkit-v2-input").fill(marker);
  await page.getByTestId("copilotkit-v2-send").click();
  // 用户气泡出现 = 这一轮已经真的发出去了（`agent_runs` 行已建、人类消息已带 runId）。
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(marker, { timeout: 60_000 });
  await page.waitForURL(/\/chat\/[^/]+$/);
  const firstThreadUrl = page.url();
  const firstThreadId = firstThreadUrl.split("/").pop()!;

  // 切到另一条会话：真实路由导航，面板整体卸载——内存里的在途 run 状态到此全丢。
  await page.getByTestId("chat-thread-create").click();
  await page.waitForURL(/\/chat\/[^/]+$/);
  await expect(page).not.toHaveURL(firstThreadUrl);

  // 立刻切回来：这一轮 run 此刻仍在途，正是恢复路径要覆盖的窗口。
  await page.getByTestId(`chat-thread-${firstThreadId}`).click();
  await page.waitForURL(firstThreadUrl);

  // ① 防空转：恢复路径确实被走到了（"正在恢复上次未完成的任务…"真的出现过）。
  //    这条断言不通过 ⇒ 下面两条"没出错、有回复"就是无意义的绿。
  await expect(page.getByText("正在恢复上次未完成的任务…")).toBeVisible({ timeout: 30_000 });

  // ② 恢复最终收尾：助手回复出现在消息区。loopback 剧本把用户原话逐字嵌进最终回复，
  //    所以"原话出现两次"= 用户气泡 + 助手回复，而不只是那条用户气泡。
  await expect
    .poll(
      async () =>
        (await page.getByTestId("copilotkit-v2-messages").innerText()).split(marker).length - 1,
      { timeout: 120_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toBeGreaterThanOrEqual(2);

  // ③ 不再谎称"没能确认"——那句提示出现即为本 issue 的回归。
  await expect(page.getByTestId("copilotkit-v2-error")).toHaveCount(0);
  // ④ 恢复阶段的文案已经收掉，不是永远转着。
  await expect(page.getByText("正在恢复上次未完成的任务…")).toHaveCount(0);
});
