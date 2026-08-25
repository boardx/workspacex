import { test, expect } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * DA-19g 评分循环第 4 轮 —— chat-ux-acceptance-criteria.md 第 7 项"错误处理透明度"的
 * 独立复核（issue #2012）。
 *
 * 前三轮记录（`.harness/state/copilotkit-v2-ux-acceptance-score.md`）反复提到两件事，
 * 但从未真正做完：
 *   ① "清空 token 后必须失败"这条既有用例（`copilotkit-v2-runtime-adapter.spec.ts`）
 *      并行跑时偶发报失败，每次都判定为 Playwright 基础设施噪音，第 3 轮曾单独隔离
 *      重跑坐实过一次——本文件不重复排查这一条，只补上第②点。
 *   ② 从未有一条测试直接断言"真实失败场景下 UI 上出现一个人类可读的失败横幅"——
 *      第 2 轮报告明确写"这不是本任务范围内修的东西"，一直没人补。
 *
 * `deepAgentFailureTrigger`（`chat-read-fixture.ts`）在 `/chat`（`chat-main-shots.spec.ts`）
 * 那条路径上已有使用先例：`loopback-deep-agent-provider.ts` 收到这句触发词时，
 * 轮询到的 run 终态是 `"error"`（不是 `"success"`），经 `execute-run.ts` 落到 `failed` +
 * `MODEL_CALL_FAILED`。`/chat` 走的是同一条 `execute-run.ts`/
 * `deep-agent-model-provider.ts` 执行管线，只是传输层换成 `runAguiBridgeTurn` 轮询后
 * 由 `copilotkit-agui.controller.ts` 折成 AG-UI `RUN_ERROR` 事件（
 * `write({ type: EventType.RUN_ERROR, message: outcome.error, code: outcome.error })`，
 * `outcome.error` 即 `"MODEL_CALL_FAILED"`）——同一个触发词、同一条真实失败链路，
 * 之前只是没人在这条面板上写过断言。
 */

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
}

test.setTimeout(120_000);

test("DA-19g 错误处理透明度——真实失败场景下 UI 出现人类可读的失败横幅，且横幅之后界面仍可用", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);

  await warmUpCopilotRuntimeRoute(page);
  await page.goto("/chat");

  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentFailureTrigger);
  await page.getByTestId("copilotkit-v2-send").click();

  // ── 反证① 错误横幅真的渲染出来了，不是静默卡住 ──────────────────────────────
  const errorBanner = page.getByTestId("copilotkit-v2-error");
  await expect(errorBanner).toHaveCount(1, { timeout: 45_000 });

  const bannerText = (await errorBanner.textContent()) ?? "";

  // ── 反证② 横幅文案是人类可读的，不是裸的契约枚举值 ─────────────────────────
  // `execute-run.ts`/`wave2-runtime.ts` 的 `RunFailureCode` 枚举（`MODEL_CALL_FAILED`
  // 等）与 `copilotkit-agui.controller.ts` 自己额外折出来的传输层码
  // （`AGENT_RUN_TIMEOUT`/`THREAD_NOT_VISIBLE`/... ）都是给排障用的稳定标识符，
  // 不是给用户看的句子——真正人读的文案里不应该原样出现这些全大写下划线枚举字面量。
  const rawEnumCodes = [
    "MODEL_CALL_FAILED",
    "AGENT_RUN_TIMEOUT",
    "THREAD_NOT_VISIBLE",
    "NO_WRITE_ROLE",
    "THREAD_ARCHIVED_READONLY",
    "AGENT_NOT_FOUND",
    "IDEMPOTENCY_CONFLICT",
    "TITLE_INVALID",
    "RESULT_UNREADABLE",
    "AUTHZ_UNAVAILABLE",
    "NO_PENDING_APPROVAL",
    "AGENT_RUN_NOT_AWAITING_APPROVAL",
    "INTERNAL_ERROR",
    "COPILOTKIT_RUNTIME_RUN_FAILED",
  ];
  for (const code of rawEnumCodes) {
    expect(
      bannerText,
      `error banner shows a raw developer-facing enum code ("${code}") instead of human-readable copy: "${bannerText}"`,
    ).not.toContain(code);
  }
  expect(bannerText.trim().length, `error banner rendered but is empty: "${bannerText}"`).toBeGreaterThan(0);

  // ── 反证③ 横幅出现之后，用户仍然能继续正常使用界面——不是伴随一次新的死锁 ─────
  // 这里验证的是"非 HITL 相关的普通失败"这条路径本身是否干净：HITL 终态死锁已经在
  // PR #2000 修过（`copilotkit-v2-hitl-dialog-dismiss.spec.ts` 覆盖），本测试触发的
  // 是一次完全不涉及 HITL 的普通模型调用失败。
  await expect(page.getByTestId("copilotkit-v2-send")).toBeEnabled({ timeout: 10_000 });
  await expect(page.getByTestId("copilotkit-v2-input")).toBeEditable();

  const secondTurnText = "DA-19g 错误横幅之后的第二轮——界面应当仍可正常发送新消息";
  await page.getByTestId("copilotkit-v2-input").fill(secondTurnText);
  await page.getByTestId("copilotkit-v2-send").click();

  const messages = page.getByTestId("copilotkit-v2-messages");
  await expect(messages).toContainText(secondTurnText, { timeout: 20_000 });
  await expect
    .poll(async () => await page.getByTestId("copilotkit-v2-send").isDisabled(), { timeout: 30_000 })
    .toBe(false);
});
