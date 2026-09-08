import { expect, test } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import {
  expectSendNotBlockedOnRun,
  openFreshDeepAgentThread,
  storedMessages,
  storedRun,
} from "./support/chat-path-coverage";

/**
 * 路径矩阵 **F7 · 上游超时 / 断流**（判据见 `.harness/instructions/chat-path-coverage-matrix.md`）。
 *
 * ## 与"上游规规矩矩地报失败"不是同一条代码路径
 *
 * `copilotkit-v2-error-banner.spec.ts` 用 `deepAgentFailureTrigger`：上游把 run 的状态
 * 答成 `error`，走 `pollToTerminal` 那条分支。本条走的是另一段真实代码——
 * `deep-agent-model-provider.ts` 的 `tryStreamRun` catch（注释原话「流中途断：run 还在
 * 服务端跑，调用方落回轮询」）：SSE 已经发过正文，socket 被直接销毁，既没有 EOF 也没有
 * 错误终态，provider 必须自己落回轮询去问权威状态。
 *
 * 这条路径要挡的失效只有一种，但它是最伤人的一种：**界面假装还在跑**。上游已经死了，
 * 转圈还在转，用户等到自己关掉页面为止——比直接报错糟得多，因为它连"重试"这个动作都
 * 不给。
 *
 * ## 判据：诚实收场 + 界面仍可用
 *
 * ① 出现人类可读的失败提示（不是静默停住）；
 * ② 发送态不再是 running（不假装还在跑）；
 * ③ 权威读里这次 run 真的是 `failed`——UI 说失败而库里还挂着 running，是另一种说谎；
 * ④ 失败之后这一页还能继续用（下一轮消息发得出去）。
 */
test.setTimeout(240_000);

test("@path:F7 上游流式半路断开：UI 诚实收场，不假装还在跑，之后仍可继续对话", async ({ page }) => {
  const threadId = await openFreshDeepAgentThread(page);

  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentStreamAbortTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(page.getByTestId("copilotkit-v2-messages"))
    .toContainText(CHAT_READ_E2E.deepAgentStreamAbortTrigger, { timeout: 60_000 });

  // ── ① 人类可读的失败提示 ──
  const banner = page.getByTestId("copilotkit-v2-error");
  await expect(
    banner,
    "上游半路断流之后必须出现失败提示——静默停住是这条路径上最伤人的失效形态",
  ).toHaveCount(1, { timeout: 120_000 });
  const bannerText = (await banner.innerText()).trim();
  expect(bannerText.length, `失败横幅渲染出来了但是空的："${bannerText}"`).toBeGreaterThan(0);

  // ── ② 不再假装还在跑 ──
  await expectSendNotBlockedOnRun(page, 60_000);

  // ── ③ 权威读：库里这次 run 真的是失败态（UI 与库不许各说各话）──
  const messages = await storedMessages(page, threadId);
  const humanTurn = messages.find(
    (message) => message.authorKind === "human" && message.text === CHAT_READ_E2E.deepAgentStreamAbortTrigger,
  );
  expect(humanTurn, "用户那条消息必须已落库").toBeDefined();
  expect(humanTurn!.agentRunId, "落库的用户消息必须挂着这次 run").toEqual(expect.any(String));
  const run = await storedRun(page, humanTurn!.agentRunId!);
  expect(
    run.status,
    "上游断流且随后的权威状态是 error 时，这次 run 必须落成 failed——"
    + "库里还挂着 running 说明轮询兜底那条路没走通",
  ).toBe("failed");

  // ── ④ 失败之后界面仍可用 ──
  const secondTurn = `断流之后的第二轮 ${Date.now()}`;
  await expect(page.getByTestId("copilotkit-v2-input")).toBeEditable();
  await page.getByTestId("copilotkit-v2-input").fill(secondTurn);
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(secondTurn, { timeout: 60_000 });
});
