import { expect, test } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import {
  expectSendNotBlockedOnRun,
  openFreshDeepAgentThread,
  storedMessages,
} from "./support/chat-path-coverage";

/**
 * 路径矩阵 **F2 · 断线重连**（判据见 `.harness/instructions/chat-path-coverage-matrix.md`）。
 *
 * ## 刷新恢复 ≠ 断线重连，这是两条不同的代码路径
 *
 * 既有覆盖（`copilotkit-v2-hitl.spec.ts` 的刷新恢复、`copilotkit-v2-run-restore-after-
 * switch.spec.ts` 的切走再切回）走的都是**页面重新挂载**：组件从零开始，用权威读把
 * 状态拉回来。断线重连不是——页面一直活着，事件流在半路断掉，浏览器侧的 run 状态机
 * 停在"我以为它还在跑"的那一刻。这条路上的失效形态是特有的：
 *   · 网络回来后没人重连 ⇒ 转圈永远不停（run 早就在服务端成功了）；
 *   · 重连了但从 seq 0 重放 ⇒ 消息重复；
 *   · 干脆把这次 run 当失败处理 ⇒ 用户白等一场，产物还在库里。
 *
 * 本条用 `context.setOffline()` 制造**真实**的网络中断（不是 mock 一个断开事件）：
 * 浏览器这一侧的所有请求真的失败，服务端的 run 完全不受影响继续跑——这正是真实断网
 * 与"刷新"的关键区别，也是 journal 续接这件事唯一有意义的前提。
 *
 * ## 判据：不靠刷新，界面自己追上
 *
 * 断言里**刻意不 reload**：一次 `page.reload()` 会让这条用例退化成既有的刷新恢复用例，
 * 那条已经绿了，再证一遍没有价值。要证的是"网络回来之后，这一页自己把状态追上了"。
 *
 * ⚠ 诚实边界：这条断言目前**未在 CI 上跑绿过**（落地时本机无 docker daemon，整套真栈
 *   起不动），因此它落在非阻塞的 `chat-path-coverage` 车道。若首跑为红，红的含义是
 *   「这条路径确实没有自动重连」——那是本条要找的答案，不是用例写错；处置见矩阵文档
 *   「首跑与搬家」一节。
 */
test.setTimeout(300_000);

test("@path:F2 断线重连：网络中断后 run 继续，网络恢复后界面自己续上，不重复不空转", async ({ page, context }) => {
  const threadId = await openFreshDeepAgentThread(page);

  // 用多步剧本让这次 run 真的跑一段时间（`MULTISTEP_MIN_STATUS_POLLS`），
  // 好让"断网"落在 run 的中途而不是它早已结束之后——同
  // `copilotkit-v2-run-restore-after-switch.spec.ts` 让 run 跑久一点的既有手法。
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentMultiStepTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(page.getByTestId("copilotkit-v2-messages"))
    .toContainText(CHAT_READ_E2E.deepAgentMultiStepTrigger, { timeout: 60_000 });

  // ── 真实断网：浏览器这一侧的请求全部失败，服务端的 run 不受影响 ──
  await context.setOffline(true);
  await page.waitForTimeout(5_000);
  // 断网期间界面不许自己宣布成功：这一刻它**不可能**知道 run 的终态。
  const messagesDuringOutage = await page.getByTestId("copilotkit-v2-messages").innerText();

  await context.setOffline(false);

  // ── 判据①：不刷新，界面自己追上这次 run 的最终回答 ──
  await expect(
    page.getByTestId("copilotkit-v2-messages"),
    "网络恢复后，这一页必须自己把 run 的最终结果续上——需要用户手动刷新才看得到，"
    + "等于把断线重连这条路径的成本转嫁给了用户",
  ).toContainText("多步依赖链已完整执行", { timeout: 180_000 });
  await expectSendNotBlockedOnRun(page, 60_000);

  // ── 判据②：续上的是 journal 的续播，不是从头重放——落库消息不重复 ──
  const messages = await storedMessages(page, threadId);
  const humanTurns = messages.filter(
    (message) => message.authorKind === "human" && message.text === CHAT_READ_E2E.deepAgentMultiStepTrigger,
  );
  expect(humanTurns, "这一轮用户消息只应落库一条——断线重连不得把请求重发一遍").toHaveLength(1);
  const agentTurns = messages.filter(
    (message) => message.authorKind === "agent" && message.text.includes("多步依赖链已完整执行"),
  );
  expect(agentTurns, "最终回答只应落库一条——从 seq 0 重放会写出第二条").toHaveLength(1);
  expect(
    agentTurns[0]!.agentRunId,
    "续上的必须是**同一次** run，不是断网后新起的一次",
  ).toBe(humanTurns[0]!.agentRunId);

  // 断网那一刻界面确实还没拿到最终回答（否则上面的等待是恒真的，本条没测到东西）。
  expect(
    messagesDuringOutage.includes("多步依赖链已完整执行"),
    "断网期间就已经拿到最终回答的话，这条用例根本没有测到重连——请把多步剧本调得更慢",
  ).toBe(false);
});
