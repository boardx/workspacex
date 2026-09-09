import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import {
  awaitStoredHumanMessage,
  openFreshDeepAgentThread,
  openFreshDeepAgentThreadOnAuthedPage,
  storedRun,
  type StoredRun,
} from "./support/chat-path-coverage";
/*
 * 文案**不在本文件里再写一遍**。`describeAgentRunFailure` 就是产品渲染横幅时调用的
 * 那一个函数（`copilotkit-v2-error-copy.ts` → `describeCopilotkitV2RunError` 转调它），
 * 期望串由它算出来，于是"契约改了措辞、断言没跟上"这种漂移不可能发生。
 *
 * ⚠ 走**相对路径**而不是 `@/lib/...`：本仓 e2e 里 `@/` 只出现过 `import type`
 * （类型会被擦除，运行时不需要解析别名），没有任何一条 spec 做过 `@/` 的**值**导入。
 * `lib/agent-run.ts` 的传递依赖只有 `@repo/contracts` / `zod` / `./api-client`
 * （后者零 import、无 "use client"），在 node 里直接 require 是安全的。
 */
import { describeAgentRunError, describeAgentRunFailure, type AgentRunFailureReason } from "../lib/agent-run";

/**
 * 路径矩阵 **F1 · 错误横幅**（判据见 `.harness/instructions/chat-path-coverage-matrix.md`）。
 *
 * ## 这条为什么要在既有 spec 之外再加一条
 *
 * `copilotkit-v2-error-banner.spec.ts` 已经覆盖了 F1 判据的**后半句**（"横幅之后界面
 * 仍可用"）和前半句的一部分（"出现人类可读的横幅"）。它断言的是横幅**在不在**、
 * 文案**是不是裸枚举**、以及**非空**——但它一个字都没断言横幅**说了什么**。
 *
 * 2026-09-09 人类人肉验收报的第一条缺陷正好落在这个缝里：一整轮执行 8 分钟、6 次工具
 * 调用、零产出，界面上只有一句「模型这次没能返回可用结果」。那句话**没有说错**，
 * 但它不可诊断——issue #3211 ① 取证后确认，至少四件可行动性完全不同的事在产品面同形：
 *
 *   ① 模型返回空；② 远端 deep-agent run 自己报错；③ 远端超时；
 *   ④ **我们自己的执行器抛异常**（`execute-run.ts` 的 "agent run executor defect"
 *      分支，同样 `failRun(..., "MODEL_CALL_FAILED")`）。
 *
 * 第 ④ 条是最糟的：我们自己的 bug 被显示成"模型没给结果"。PR #3229 为此新增了有界枚举
 * `AgentRunFailureReason`（8 值）+ `agent_runs.failure_reason` 列 + 前端
 * `describeAgentRunFailure(code, reason)`。
 *
 * **但 #3229 全部的门控都是单元测试。** 没有任何一条 e2e 断言那个成因真的走完了
 * 服务端 → wire → 浏览器这条路。本文件补的就是这一段，判据只有一条：
 *
 *   > 成因枚举必须真的落到用户看见的那句话里，且不同的成因说的不是同一句话。
 *
 * ## 两条用例是**两个不同的结论**，不是同一件事测两遍
 *
 * 分开写是为了让红有指向性（本车道反复吃过"一条红分不出三种结论"的亏）：
 *
 * - 用例一问：**这一个**失败的成因有没有上产品面。红 ⇒ 成因在某一段被丢了。
 * - 用例二问：**两个不同**的成因在界面上分不分得开。它把断言拆成两半——先断言服务端
 *   两次 run 的 `failure_reason` 真的不同（权威读；这一半证明"分类器работает"），
 *   再断言两条横幅的正文真的不同（界面；这一半证明"分辨力送到了用户眼前"）。
 *   两半分开，红在哪一半就直接说明是"服务端没分类"还是"UI 把分类吃掉了"。
 *
 * ⚠ 用例二用的两个触发词**成因刻意不同**：`deepAgentFailureTrigger` 让上游 run 走到
 * `error` 终态 ⇒ `provider_rejected`；`deepAgentEmptyReplyTrigger` 让上游 run
 * **成功**收场但一条 assistant 消息都不给 ⇒ `provider_returned_empty`。
 * 不能拿 `deepAgentStreamAbortTrigger`（F7 那条）来当第二个：它在替身里是另一段代码，
 * 但最终同样把状态答成 `error`，落到的成因与第一个**一模一样**，证不出任何分辨力。
 */

/** 这一轮 run 的错误码在本条链路上恒为 `MODEL_CALL_FAILED`（`execute-run.ts` 的失败分支）。 */
const EXPECTED_ERROR_CODE = "MODEL_CALL_FAILED";

interface FailedTurn {
  readonly run: StoredRun;
  readonly bannerText: string;
}

/**
 * 发一句触发词 → 等这次 run 在**库里**真的落成 `failed` → 再读横幅正文。
 *
 * ⚠ 顺序是刻意的，取自本车道 F7 二跑的教训：直接断言横幅时，"替身没让 run 真的失败"
 * 与 "run 失败了但 UI 不说" 这两个完全不同的结论从同一条红里分不出来。先权威读，
 * 后判界面，红就自带归属。
 */
async function runFailingTurn(page: Page, threadId: string, trigger: string): Promise<FailedTurn> {
  await page.getByTestId("copilotkit-v2-input").fill(trigger);
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(trigger, { timeout: 60_000 });

  const messages = await awaitStoredHumanMessage(page, threadId, trigger);
  const humanTurn = messages.find((message) => message.authorKind === "human" && message.text === trigger);
  expect(humanTurn, `用户那条消息必须已落库（触发词：${trigger}）`).toBeDefined();
  expect(humanTurn!.agentRunId, "落库的用户消息必须挂着这次 run").toEqual(expect.any(String));

  await expect
    .poll(async () => (await storedRun(page, humanTurn!.agentRunId!)).status, {
      timeout: 150_000,
      intervals: [1_000, 2_000, 5_000],
    })
    .toBe("failed");
  const run = await storedRun(page, humanTurn!.agentRunId!);

  const banner = page.getByTestId("copilotkit-v2-error");
  await expect(banner, "run 已在库里落成 failed，界面必须给出失败提示").toHaveCount(1, { timeout: 90_000 });
  /*
   * 横幅正文可能由 `onError` 事件先写、随后被权威读覆盖成更具体的一句。这里等的是
   * **稳定**下来的正文（连续两次读到同一个非空串），而不是抢第一帧——抢第一帧会让
   * 这条用例的通过与否取决于两条异步路径谁先到，正是矩阵「搬家条件」里点名的时序运气。
   */
  let previous = "";
  await expect
    .poll(
      async () => {
        const current = (await banner.innerText()).trim();
        const stable = current !== "" && current === previous;
        previous = current;
        return stable;
      },
      { timeout: 30_000, intervals: [1_000] },
    )
    .toBe(true);

  return { run, bannerText: previous };
}

/** 权威读里这条 run 的成因必须是有界枚举里的一个真值，不能缺席。 */
function assertReasonRecorded(run: StoredRun, trigger: string): AgentRunFailureReason {
  expect(run.error, `这次 run 的终态错误码（触发词：${trigger}）`).toBe(EXPECTED_ERROR_CODE);
  expect(
    run.failureReason,
    `run 落成 failed 却没有记下成因（触发词：${trigger}）——PR #3229 加的 `
      + "`agent_runs.failure_reason` 在这条路径上没有被写，产品面必然退回那句不可诊断的老话",
  ).toBeTruthy();
  return run.failureReason as AgentRunFailureReason;
}

test.setTimeout(300_000);

test("@path:F1 失败横幅必须说出「为什么」：成因枚举真的落到用户看见的那句话里", async ({ page }) => {
  const threadId = await openFreshDeepAgentThread(page);
  const turn = await runFailingTurn(page, threadId, CHAT_READ_E2E.deepAgentFailureTrigger);

  const reason = assertReasonRecorded(turn.run, CHAT_READ_E2E.deepAgentFailureTrigger);

  /*
   * 上游 run 走到 `error` 终态 ⇒ `deep-agent-model-provider.ts` 抛的 detail 形如
   * `run ended with status ...` ⇒ `classifyModelCallFailureReason` 分类成
   * `provider_rejected`。钉死这个具体值（而不是"随便哪个非 null"）是为了挡住
   * 分类器悄悄退化成 `unknown`——那种退化下横幅照样有一句话，照样非空，
   * 照样不是裸枚举，既有的 `copilotkit-v2-error-banner.spec.ts` 一条都拦不住。
   */
  expect(
    reason,
    "上游规规矩矩地报了一个失败终态，成因应当被分类成 `provider_rejected`；"
      + "落成 `unknown` 说明服务端分类器没认出这条 detail",
  ).toBe("provider_rejected");

  const withCause = describeAgentRunFailure(EXPECTED_ERROR_CODE, reason);
  const withoutCause = describeAgentRunError(EXPECTED_ERROR_CODE);
  /* 自检：这两句必须真的不同，否则下面那条断言是空转的。 */
  expect(withCause, "契约文案自检：带成因与不带成因必须是两句不同的话").not.toBe(withoutCause);

  // ── 判据：横幅正文里真的有那句「为什么」 ──────────────────────────────────
  expect(
    turn.bannerText,
    `横幅没有说出成因。\n  权威读里的成因：${reason}\n  期望横幅包含：「${withCause}」\n`
      + `  横幅实际正文：「${turn.bannerText}」\n`
      + "这正是 issue #3211 ① 那条人肉验收缺陷的形状：横幅在、非空、不是裸枚举，"
      + "但它把四件可行动性完全不同的事说成了同一句话。",
  ).toContain(withCause);

  // ── 反面：横幅不能只停在那句不可诊断的老话上 ──────────────────────────────
  expect(
    turn.bannerText.trim(),
    "横幅只给出了不带成因的旧文案——PR #3229 的成因没有走完到浏览器这一段",
  ).not.toBe(withoutCause);
});

test("@path:F1 两种不同成因的失败，界面上说的不是同一句话", async ({ page }) => {
  // 第一条线程：上游报错误终态 ⇒ `provider_rejected`
  const threadRejected = await openFreshDeepAgentThread(page);
  const rejected = await runFailingTurn(page, threadRejected, CHAT_READ_E2E.deepAgentFailureTrigger);
  const reasonRejected = assertReasonRecorded(rejected.run, CHAT_READ_E2E.deepAgentFailureTrigger);

  /*
   * 第二条线程用 `...OnAuthedPage`：`openFreshDeepAgentThread` 内部会 `login()`，
   * 而 `login()` 在已登录的 page 上是**硬失败**（`chat-task-workbench-fixture.ts`）。
   * 本车道首跑时 D4/F2/F6/F7 四条全部死在这个形状上，各烧 4–5 分钟、零业务断言。
   */
  const threadEmpty = await openFreshDeepAgentThreadOnAuthedPage(page);
  const empty = await runFailingTurn(page, threadEmpty, CHAT_READ_E2E.deepAgentEmptyReplyTrigger);
  const reasonEmpty = assertReasonRecorded(empty.run, CHAT_READ_E2E.deepAgentEmptyReplyTrigger);

  // ── 上半场：服务端真的把两次失败分成了两类 ────────────────────────────────
  expect(reasonEmpty, "上游成功收场却没有任何 assistant 正文，成因应当是 `provider_returned_empty`")
    .toBe("provider_returned_empty");
  expect(
    reasonRejected,
    "两个触发词的成因必须不同，否则这条用例证不出任何分辨力（自检）",
  ).not.toBe(reasonEmpty);

  // ── 下半场：这份分辨力真的送到了用户眼前 ──────────────────────────────────
  /*
   * 两次失败的**错误码是同一个**（都是 `MODEL_CALL_FAILED`），差别全部在成因上。
   * 所以横幅正文一旦相同，就等价于"成因这一层在产品面被抹平了"——这句断言就是
   * 人类那条验收缺陷的机械形式。
   */
  expect(rejected.run.error, "自检：两次失败的错误码必须相同，差别才全在成因上").toBe(empty.run.error);
  expect(
    rejected.bannerText,
    "两次成因完全不同的失败，横幅说的是同一句话——用户无从分辨"
      + `「${reasonRejected}」和「${reasonEmpty}」。\n`
      + `  横幅（${reasonRejected}）：「${rejected.bannerText}」\n`
      + `  横幅（${reasonEmpty}）：「${empty.bannerText}」`,
  ).not.toBe(empty.bannerText);

  /* 并且各自说的是**自己**那一句，不是随便两句不同的话。 */
  expect(rejected.bannerText).toContain(describeAgentRunFailure(EXPECTED_ERROR_CODE, reasonRejected));
  expect(empty.bannerText).toContain(describeAgentRunFailure(EXPECTED_ERROR_CODE, reasonEmpty));
});
