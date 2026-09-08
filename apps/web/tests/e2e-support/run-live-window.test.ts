import { describe, expect, it } from "vitest";
import { CHAT_READ_E2E } from "@/e2e/chat-read-fixture";
import { PLAN_LEDGER_POLL_INTERVAL_MS } from "@/lib/use-plan-ledger-polling";

/**
 * issue #3081 —— 「单测全绿、浏览器里锚点从不出现」的**跨层不变量**门控。
 *
 * ## 这条测试在防什么
 *
 * `chat-task-workbench-run-pause` 的唯一门是 `deriveRunControls({runStatus})`，
 * 数据来自 `usePlanLedgerPolling` 的定周期轮询。于是「这个锚点在真栈上出不出得来」
 * 由两层**各自都正确**的东西相乘决定：
 *
 *   ① 替身让这一轮 run 真正停在 `running` 的时长；
 *   ② 账本采样周期 `PLAN_LEDGER_POLL_INTERVAL_MS`。
 *
 * 组件层（七处单测）直接把 `runStatus:"running"` 当常量喂进去——它**永远**绿；
 * 替身层自己也没错。没有任何一层拥有 ①>②，于是 TW-P1-5 的断言在
 * run 34248215851 里等 60 秒超时，后两个锚点根本没被求值。
 *
 * 本地实测（直连 `loopback-deep-agent-provider.ts`，非真栈）：多步触发词
 * `/stream` EOF 在 974ms、紧接着的权威状态读就是 `success`；慢触发词 EOF 在 12554ms。
 * 采样周期 3000ms ⇒ 多步剧本命中 `running` 的期望次数是 **0**。
 *
 * ## 为什么阈值是 2 个周期而不是 1 个
 *
 * 恰好 1 个周期意味着窗口与采样相位对齐才命中——那是一个会随机红的门。
 * 要求 ≥2 个周期，保证无论相位如何都至少落进一次采样。
 */
describe("issue #3081 —— 运行级控制锚点的可观测窗口（跨层不变量）", () => {
  it("暂停/恢复用的慢触发词，其 live 窗口必须覆盖至少两个账本采样周期", () => {
    expect(
      CHAT_READ_E2E.deepAgentSlowHoldMs,
      [
        "【跨层不变量破裂】replay 替身让 run 活着的时长 < 2 × 账本轮询周期。",
        `当前：hold=${CHAT_READ_E2E.deepAgentSlowHoldMs}ms，poll=${PLAN_LEDGER_POLL_INTERVAL_MS}ms。`,
        "后果不是 flaky，是 `chat-task-workbench-run-pause` **恒不可达**——",
        "组件单测仍会全绿（它们把 runStatus:'running' 当常量喂进去），",
        "只有真栈 e2e 会红，而且红在一条看起来与实现无关的超时上。",
      ].join("\n"),
    ).toBeGreaterThanOrEqual(2 * PLAN_LEDGER_POLL_INTERVAL_MS);
  });
});
