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

  /*
   * issue #3000 —— 这一轮必须**真的**跑一段时间：切走再切回时它得**还在途**，否则挂载
   * hydration 直接读到已经写回的回复（`findPendingRunId` 为 null），恢复路径根本不会被
   * 触发，整条用例会变成一条什么都没验证的"绿"。下面第 ① 条断言正是为了机械地挡住它。
   *
   * ⚠ 此前这里借用的是**多步触发词**，理由写的是「多步剧本至少要 6 轮状态轮询才终态」。
   *   那条理由在流式路径上不成立：`KERNEL_DEEP_AGENT_STREAM_ENABLED=1` 时终态来自
   *   `/stream` 的 EOF，状态轮询那道闸根本不参与。trace 实测（run 34191848662）：该 run
   *   `createdAt` 06:58:29.494、`chat_writeback` 06:58:30.661——**1.2 秒**跑完，而
   *   「新建会话 → 等路由 → 切回来」要 2 秒以上，于是切回来时 run 早已终态，
   *   `GET /agent-runs/:runId` 读到的是 `succeeded`，下面那道 `restoringRun` 等满 30s 超时。
   *   现在用的是替身里一条**确定性的慢**触发词（`deepAgentSlowTrigger`，停留
   *   `deepAgentSlowHoldMs`=12s 才开始发正文），run 在这段时间里是真的 `running`。
   */
  const marker = CHAT_READ_E2E.deepAgentSlowTrigger;
  /*
   * issue #3000 —— 这里等的是"这一轮的权威读回来了"，判据是**非终态**，不是逐字
   * `"running"`。trace 取证（run 34201215623）：外壳对 `/agent-runs/:id` 只发**两次**
   * ——刚建起来那一次（t=989.1，`status: "queued"`，`steps` 只有 `accepted`）和收尾之后
   * 那一次（t=1013.7，`succeeded`）。它没有周期性轮询，所以"恰好读到 running"是撞运气；
   * 旧判据只认 `running`，在慢触发词下第一发读到的是 `queued`，于是等满 60s。
   * `queued`/`running` 都是"这一轮还没写回"，正是本用例要的前提。
   */
  const NONTERMINAL = new Set(["queued", "running"]);
  const initialRunResponse = page.waitForResponse(async response => {
    if (!response.ok() || !/\/agent-runs\/[^/?]+$/.test(new URL(response.url()).pathname)) return false;
    const value = await response.json();
    return NONTERMINAL.has(value.status) && value.resultMessageId === null;
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

  /*
   * issue #3000 —— **切走之前**必须先确认这一轮已经在库里留下"待恢复"的痕迹。
   *
   * 切回来之后能不能触发恢复，唯一依据是 `findPendingRunId`（`lib/agent-run.ts`）：
   * 已落库消息里最后一条带 `agentRunId` 的人类消息、且还没有任何消息 `replyToMessageId`
   * 指回它。内存态在切走时全丢，库里没有这条痕迹 ⇒ 挂载时 `pendingRunId === null` ⇒
   * 恢复路径**根本不会被触发**，一次 `GET /agent-runs/:runId` 都不会发。
   *
   * 这正是本次红的实况（trace 取证，run 34185270399）：send 在 t=980.3s，
   * `chat-thread-create` 在 t=980.8s——**0.5 秒**之后就切走了，人类消息还没落库；
   * 切回来之后网络记录里对该 run 一次 GET 都没有，于是下面那道
   * `status==="running" && resultMessageId===null` 的门等满 30s 超时。
   * 换句话说这条红不是"恢复坏了"，是这条用例从来没走到恢复。
   *
   * 这一等也不会把用例变成空转：慢触发词让这一轮在替身里停留 `deepAgentSlowHoldMs`
   * （12s）才开始发正文（`SLOW_TRIGGER`，`apps/api/scripts/loopback-deep-agent-provider.ts`），
   * 而落库一条人类消息发生在 run 刚建起来的那一刻，远早于此；"切回时它必须还在途"
   * 仍由紧随其后那道 `restoringRun` 断言机械把关，与文件头注第 ① 条纪律一致。
   */
  const sessionToken = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
  expect(sessionToken).toBeTruthy();
  const runApiBase = new URL(runResponse.url()).origin;
  await expect
    .poll(async () => {
      const stored = await page.request.get(
        `${runApiBase}/chat/threads/${firstThreadId}/messages?limit=100`,
        { headers: { Authorization: `Bearer ${sessionToken}` } },
      );
      if (!stored.ok()) return false;
      const messages = (await stored.json()).messages as ReadonlyArray<{
        id: string; authorKind: string; agentRunId: string | null; replyToMessageId: string | null;
      }>;
      const human = messages.find((m) => m.authorKind === "human" && m.agentRunId === run.runId);
      return human !== undefined && !messages.some((m) => m.replyToMessageId === human.id);
    }, { timeout: 60_000, intervals: [250, 500, 1_000] })
    .toBe(true);

  // 切到另一条会话：真实路由导航，面板整体卸载——内存里的在途 run 状态到此全丢。
  await page.getByTestId("chat-thread-create").click();
  await page.waitForURL(/\/chat\/[^/]+$/);
  await expect(page).not.toHaveURL(firstThreadUrl);

  // Arm the observer before remounting. Requiring a real nonterminal response after
  // remount prevents a completed hydration path from masquerading as run recovery.
  const restoringRun = page.waitForResponse(async response => {
    if (!response.ok() || response.url() !== runResponse.url()) return false;
    const value = await response.json();
    // 同上：非终态即"还没写回"。这道门挡的是"切回来时它其实早就跑完了、恢复路径
    // 根本没被走到"那种空转，与状态字面量是 queued 还是 running 无关。
    return NONTERMINAL.has(value.status) && value.resultMessageId === null;
  }, { timeout: 30_000 });
  const settledRun = page.waitForResponse(async response => {
    if (!response.ok() || response.url() !== runResponse.url()) return false;
    const value = await response.json();
    return value.status === "succeeded" && typeof value.resultMessageId === "string";
  }, { timeout: 120_000 });
  await page.getByTestId(`chat-thread-${firstThreadId}`).click();
  await page.waitForURL(firstThreadUrl);
  await restoringRun;
  await expect(page.getByTestId("copilotkit-v2-thinking-phase")).toHaveText("正在执行");
  await expect(page.getByText("正在恢复上次未完成的任务…")).toHaveCount(0);
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
  // 慢触发词走替身的默认回复模板（它不是多步剧本）——正文里逐字回显用户原话，
  // 这就是"写回的那条确实是这一轮的产出"的可判形态。
  expect(finalMessage?.text).toContain(`根据查询结果回答你："${marker}"`);
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
