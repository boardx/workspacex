import { expect, test } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import {
  awaitStoredHumanMessage,
  expectSendNotBlockedOnRun,
  openFreshDeepAgentThread,
  storedMessages,
  storedRun,
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

  /*
   * 用**十步滚动剧本**（`deepAgentScrollAcceptanceTrigger`，替身要 20 次状态轮询才终态）
   * 而不是多步剧本：二跑实测，多步剧本在 5 秒的断网等待窗口内就已经跑完，本条于是红在
   * 自己的自检上（"断网期间就已经拿到最终回答"）——那说明这条用例当时根本没测到重连。
   * 同一条教训的另一半：断网动作**紧跟发送**，不再先等 5 秒。
   */
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentScrollAcceptanceTrigger);
  await page.getByTestId("copilotkit-v2-send").click();

  /*
   * ⚠ 断网**必须**紧跟发送，中间只能插「这次 run 真的起来了」这一件事。
   *
   * 六跑前的版本在这里先等 `copilotkit-v2-messages` 渲出用户原文（超时 60s），才去断网。
   * 那一等把断网推后了不确定的一段时间——2026-09-08 阻塞车道首跑（run 34197980964）
   * 整条用例只花 16.5s，剧本在断网之前就已经跑完，本条于是红在自己的自检上。
   * 头注里"断网动作紧跟发送"那句当时已经写着，代码却和它相反。
   *
   * 现在等的是**权威读**：人类消息落库并挂上 runId。它证明请求已经到达服务端（断网不会
   * 把这一发打掉），且通常在毫秒级完成，不会像 DOM 渲染那样把窗口拖长。
   */
  const beforeOutage = await awaitStoredHumanMessage(page, threadId, CHAT_READ_E2E.deepAgentScrollAcceptanceTrigger);
  const humanTurn = beforeOutage.find(
    (message) => message.authorKind === "human" && message.text === CHAT_READ_E2E.deepAgentScrollAcceptanceTrigger,
  );
  expect(humanTurn, "用户那条消息必须已落库").toBeDefined();
  expect(humanTurn!.agentRunId, "落库的用户消息必须挂着这次 run").toEqual(expect.any(String));

  // ── 真实断网：浏览器这一侧的请求全部失败，服务端的 run 不受影响 ──
  await context.setOffline(true);

  /*
   * 断网这一刻 run 若已终态，本条这一跑就**测不到重连**——不是断言写错，是这套确定性
   * 上游在这台机器上跑得比断网窗口还快。把它作为一条独立判据写在这里（而不是只靠末尾
   * 那条自检事后发现），是为了让失败信息直接指向"instrument 太快"，而不是让人以为
   * 重连坏了。彻底消除这个竞态要让替身**扣住最后一段**直到客户端重连，那是下一步；
   * 在那之前本条留在非阻塞车道。
   */
  const statusAtOutage = (await storedRun(page, humanTurn!.agentRunId!)).status;
  expect(
    ["succeeded", "failed", "cancelled"].includes(statusAtOutage),
    `断网时这次 run 已是终态（${statusAtOutage}）——十步滚动剧本在这台机器上比断网窗口还快，`
    + "本跑测不到重连。要修的是让替身扣住最后一段直到重连，不是放宽下面的判据",
  ).toBe(false);

  await page.waitForTimeout(3_000);
  // 断网期间界面不许自己宣布成功：这一刻它**不可能**知道 run 的终态。
  const messagesDuringOutage = await page.getByTestId("copilotkit-v2-messages").innerText();

  await context.setOffline(false);

  // ── 判据①：不刷新，界面自己追上这次 run 的最终回答 ──
  await expect(
    page.getByTestId("copilotkit-v2-messages"),
    "网络恢复后，这一页必须自己把 run 的最终结果续上——需要用户手动刷新才看得到，"
    + "等于把断线重连这条路径的成本转嫁给了用户",
  ).toContainText("十步滚动验收执行完成", { timeout: 180_000 });
  await expectSendNotBlockedOnRun(page, 60_000);

  // ── 判据②：续上的是 journal 的续播，不是从头重放——落库消息不重复 ──
  const messages = await storedMessages(page, threadId);
  const humanTurns = messages.filter(
    (message) => message.authorKind === "human" && message.text === CHAT_READ_E2E.deepAgentScrollAcceptanceTrigger,
  );
  expect(humanTurns, "这一轮用户消息只应落库一条——断线重连不得把请求重发一遍").toHaveLength(1);
  const agentTurns = messages.filter(
    (message) => message.authorKind === "agent" && message.text.includes("十步滚动验收执行完成"),
  );
  expect(agentTurns, "最终回答只应落库一条——从 seq 0 重放会写出第二条").toHaveLength(1);
  expect(
    agentTurns[0]!.agentRunId,
    "续上的必须是**同一次** run，不是断网后新起的一次",
  ).toBe(humanTurns[0]!.agentRunId);

  // 断网那一刻界面确实还没拿到最终回答（否则上面的等待是恒真的，本条没测到东西）。
  expect(
    messagesDuringOutage.includes("十步滚动验收执行完成"),
    "断网期间就已经拿到最终回答的话，这条用例根本没有测到重连——请把多步剧本调得更慢",
  ).toBe(false);
});
