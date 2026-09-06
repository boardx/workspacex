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
test.setTimeout(480_000);

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

/** 发一条消息并等到它出现在消息区（用户气泡先到，早于 assistant 回复）。 */
async function send(page: Page, text: string): Promise<void> {
  await page.getByTestId("copilotkit-v2-input").fill(text);
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(text, { timeout: 60_000 });
}

test("提交任务→切走→切回：run 事件流不可用时，恢复靠权威读在一两秒内收尾，回复出现且不谎称『没能确认』", async ({ page }) => {
  await login(page);
  await warmUpCopilotRuntimeRoute(page);

  // 防空转的取证通道（见下面第 ① 条）：恢复路径唯一会打的那条权威读
  // `GET /agent-runs/:runId`。用网络证据而不是那句阶段文案——重设计之后它可能只闪
  // 几十毫秒（这正是修好的样子），用 DOM 去抓它反而会抓不到，第一版就栽在这里。
  const runReads: number[] = [];
  page.on("request", (req) => {
    if (req.method() === "GET" && /\/agent-runs\/[^/]+(?:$|\?)/.test(req.url())) {
      runReads.push(Date.now());
    }
  });

  await page.goto("/chat");

  /*
   * 先，把两条线程都建好、都在侧栏里可点。
   *
   * ⚠ 这段"贵"的准备必须发生在计时窗口**之前**。第一版把「新建对话」放在切走那一步，
   *   那是一次真实 POST + 路由导航，好几秒——等切回来时那一轮 run 早就跑完写回了，
   *   `findPendingRunId` 为 null，恢复路径根本没被走到，整条用例变成一条什么都没验证
   *   的绿（本机实测确实这样红过一次，正是下面第 ① 条抓出来的）。切走/切回必须是两次
   *   纯导航点击，快到 run 还在途。
   */
  await send(page, `#2825-预备线程A-${Date.now()}`);
  await page.waitForURL(/\/chat\/[^/]+$/);
  const threadAUrl = page.url();
  const threadAId = threadAUrl.split("/").pop()!;

  await page.getByTestId("chat-thread-create").click();
  await page.waitForURL(/\/chat\/[^/]+$/);
  await expect(page).not.toHaveURL(threadAUrl);
  await send(page, `#2825-预备线程B-${Date.now()}`);
  const threadBId = page.url().split("/").pop()!;
  await expect(page.getByTestId(`chat-thread-${threadAId}`)).toBeVisible();
  await expect(page.getByTestId(`chat-thread-${threadBId}`)).toBeVisible();

  // 把 run 事件订阅打死——截图里那一帧的成因（见文件头注）。握手一建立就断开。
  await page.routeWebSocket(/\/agent-runs\/[^/]+\/events/, (ws) => ws.close());

  // 回到 A，提交真正要恢复的那一轮任务。多步剧本让它真的跑一段时间。
  await page.getByTestId(`chat-thread-${threadAId}`).click();
  await page.waitForURL(threadAUrl);
  // ⚠ 触发词必须**逐字**发出去：替身对多步剧本的判定是 `userText === MULTISTEP_TRIGGER`
  //   （`loopback-deep-agent-provider.ts` 的 `requiredPolls`），加一个时间戳后缀就落回
  //   默认剧本——那条 run 一秒就跑完，切回来时早已终态，这条用例也就测不到"事件流死着、
  //   run 还在途"这个唯一有区别的窗口（本机实测栽过：加了后缀之后带修复与不带修复
  //   都是 1 秒，性能门形同虚设）。
  await send(page, CHAT_READ_E2E.deepAgentMultiStepTrigger);

  // 切走 → 立刻切回：两次纯导航，run 此刻仍在途，正是恢复路径要覆盖的窗口。
  await page.getByTestId(`chat-thread-${threadBId}`).click();
  await page.waitForURL(new RegExp(`/chat/${threadBId}$`));
  await page.getByTestId(`chat-thread-${threadAId}`).click();
  await page.waitForURL(threadAUrl);
  const tBack = Date.now();

  // ① 防空转：恢复路径确实被走到了——切回来之后真的发出过那条权威读。
  //    这条断言不通过 ⇒ 下面几条"没出错、有回复"就是无意义的绿（挂载 hydration 直接
  //    读到已写回的回复时根本不会有这条请求）。
  await expect
    .poll(() => runReads.filter((t) => t >= tBack).length, { timeout: 30_000, intervals: [100, 200, 500] })
    .toBeGreaterThan(0);

  // ② 恢复最终收尾：助手回复真的出现在消息区。断言的是多步剧本终稿里那句独有的话
  //    （`loopback-deep-agent-provider.ts` 的 multistep `reply`），不是用户自己那句
  //    ——后者在用户气泡里本来就有，拿它当断言等于什么都没验证。
  await expect(page.getByTestId("copilotkit-v2-messages"))
    .toContainText("多步依赖链已完整执行", { timeout: 120_000 });
  const restoreMs = Date.now() - tBack;
  console.log(`[TIMING] 切回→助手回复可见: ${restoreMs}ms`);

  // ③ 性能门（issue #2825 重设计）—— 事件流死着的时候，恢复必须靠"断线即读"在一两秒
  //    内收尾，而不是干等整个重连预算（5 次退避 ≈ 9.4 秒）跑完再补一次读。第一版正是
  //    后者：同一条链路本机实测 12.0 秒。8 秒这条线画在两者中间且低于重连预算——
  //    只有"断线即读"真的在，它才可能过。
  expect(restoreMs).toBeLessThan(8_000);

  // ④ 不再谎称"没能确认"——那句提示出现即为本 issue 的回归。
  await expect(page.getByTestId("copilotkit-v2-error")).toHaveCount(0);
  // ⑤ 恢复阶段的文案已经收掉，不是永远转着。
  await expect(page.getByText("正在恢复上次未完成的任务…")).toHaveCount(0);
});
