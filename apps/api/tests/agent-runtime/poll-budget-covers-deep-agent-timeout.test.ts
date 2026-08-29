/**
 * 2026-08-29 -- 真实 devapp 回归证据（第一次）：一次挂了平台级 skill 的"通用助手"
 * 对话，`list_org_skills` 工具调用之后，前端报"这次执行超时了，还没有等到结果"，
 * 而 run 本身在服务端并没有失败，只是没等到。
 *
 * 根因见 `poll-budget.ts` 文件头 "## 2026-08-29 real devapp evidence" 那一节：
 * `agui-bridge.ts` 的中继轮询预算（`DEFAULT_RUN_POLL_INTERVAL_MS` ×
 * `DEFAULT_RUN_MAX_POLLS`）曾经短于 deep-agent 后端自己的真实等待预算
 * （`readDeepAgentProviderConfig()` 的 `KERNEL_DEEP_AGENT_TIMEOUT_MS`，
 * 默认 300_000ms）——中继层先放弃轮询，用户看到的"超时"测的从来不是 run 有没有
 * 真的挂，是"我们愿不愿意继续等它"。
 *
 * ## 第二次真实证据：只覆盖模型调用还不够，漏了模型调用之后的沙箱重试循环
 *
 * 第一次修复只把预算提到刚好盖过 `KERNEL_DEEP_AGENT_TIMEOUT_MS`。但一次真实的
 * "生成 PDF" run 不是"模型调用完就结束"——`execute-run.ts` 在模型调用之后还会
 * 调 `maybeRunSkillScript`，真的在沙箱里跑脚本，失败最多回喂重试
 * `MAX_SCRIPT_ATTEMPTS` 次，每次沙箱执行自己的预算是 `CHAT_SCRIPT_TIMEOUT_MS`。
 * 这段时间完全在 `KERNEL_DEEP_AGENT_TIMEOUT_MS` 之外，人类实测：真的又一次撞见
 * 了"超时"——见 `poll-budget.ts` 文件头 "## 2026-08-29 第二次真实证据" 那一节。
 *
 * 这条测试不重复抄任何数字，而是各自读它们的真实来源（`poll-budget.ts` 的导出
 * 常量 + `readDeepAgentProviderConfig()` 的默认返回值 + `run-skill-script.ts`/
 * `run-script-with-retries.ts` 的真实沙箱重试常量），断言前者的总预算必须严格
 * 覆盖"一次模型调用 + 完整一轮沙箱重试循环"，防止未来任何一边的改动让这个类别
 * 的 bug 第三次复发而不被机械门控挡住。
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RUN_MAX_POLLS, DEFAULT_RUN_POLL_INTERVAL_MS } from "../../src/application/agent-run/poll-budget";
import { readDeepAgentProviderConfig } from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import { CHAT_SCRIPT_TIMEOUT_MS } from "../../src/application/agent-run/run-skill-script";
import { MAX_SCRIPT_ATTEMPTS } from "../../src/application/skill/run-script-with-retries";

/** 一次模型调用 + 完整一轮沙箱重试循环的真实最短预算——刻意不计入失败回喂时
 *  `regenerate` 调用本身的耗时（见 `poll-budget.ts` 同一节，那属于要求这一层
 *  等待接近半小时的病理场景，不是这里要覆盖的常规路径）。 */
function worstCaseBackendDurationMs(): number {
  const { timeoutMs: modelCallTimeoutMs } = readDeepAgentProviderConfig({});
  return modelCallTimeoutMs + MAX_SCRIPT_ATTEMPTS * CHAT_SCRIPT_TIMEOUT_MS;
}

describe("poll budget vs deep-agent backend timeout + sandbox retry loop", () => {
  it("the shared relay poll budget outlasts one model call plus a full sandbox retry loop", () => {
    const relayBudgetMs = DEFAULT_RUN_POLL_INTERVAL_MS * DEFAULT_RUN_MAX_POLLS;

    expect(relayBudgetMs).toBeGreaterThan(worstCaseBackendDurationMs());
  });

  it("still outlasts it by at least a fixed safety margin", () => {
    // Guards against the relay budget being "just barely" ahead of whatever these backend
    // constants happen to be today -- any one of them moving a little shouldn't immediately
    // reopen this exact bug.
    const relayBudgetMs = DEFAULT_RUN_POLL_INTERVAL_MS * DEFAULT_RUN_MAX_POLLS;
    const safetyMarginMs = 60_000;

    expect(relayBudgetMs).toBeGreaterThanOrEqual(worstCaseBackendDurationMs() + safetyMarginMs);
  });
});
