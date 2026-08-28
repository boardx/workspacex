/**
 * 2026-08-29 -- 真实 devapp 回归证据：一次挂了平台级 skill 的"通用助手"对话，
 * `list_org_skills` 工具调用之后，前端报"这次执行超时了，还没有等到结果"，而
 * run 本身在服务端并没有失败，只是没等到。
 *
 * 根因见 `poll-budget.ts` 文件头 "## 2026-08-29 real devapp evidence" 那一节：
 * `agui-bridge.ts` 的中继轮询预算（`DEFAULT_RUN_POLL_INTERVAL_MS` ×
 * `DEFAULT_RUN_MAX_POLLS`）曾经短于 deep-agent 后端自己的真实等待预算
 * （`readDeepAgentProviderConfig()` 的 `KERNEL_DEEP_AGENT_TIMEOUT_MS`，
 * 默认 300_000ms）——中继层先放弃轮询，用户看到的"超时"测的从来不是 run 有没有
 * 真的挂，是"我们愿不愿意继续等它"。
 *
 * 这条测试不重复抄这两个数字，而是各自读它们的真实来源（`poll-budget.ts` 的导出
 * 常量 + `readDeepAgentProviderConfig()` 的默认返回值），断言前者的总预算必须
 * 严格覆盖后者，防止未来任何一边的改动让这个类别的 bug 第三次复发而不被机械
 * 门控挡住。
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RUN_MAX_POLLS, DEFAULT_RUN_POLL_INTERVAL_MS } from "../../src/application/agent-run/poll-budget";
import { readDeepAgentProviderConfig } from "../../src/infrastructure/agent-run/deep-agent-model-provider";

describe("poll budget vs deep-agent backend timeout", () => {
  it("the shared relay poll budget outlasts the deep-agent backend's own default timeout", () => {
    const relayBudgetMs = DEFAULT_RUN_POLL_INTERVAL_MS * DEFAULT_RUN_MAX_POLLS;
    const { timeoutMs: backendTimeoutMs } = readDeepAgentProviderConfig({});

    expect(relayBudgetMs).toBeGreaterThan(backendTimeoutMs);
  });

  it("still outlasts an operator-raised backend timeout by at least a fixed safety margin", () => {
    // Guards against the relay budget being "just barely" ahead of whatever the backend
    // default happens to be today -- an operator raising KERNEL_DEEP_AGENT_TIMEOUT_MS a
    // little (e.g. for a slower model) shouldn't immediately reopen this exact bug.
    const relayBudgetMs = DEFAULT_RUN_POLL_INTERVAL_MS * DEFAULT_RUN_MAX_POLLS;
    const { timeoutMs: backendTimeoutMs } = readDeepAgentProviderConfig({});
    const safetyMarginMs = 10_000;

    expect(relayBudgetMs).toBeGreaterThanOrEqual(backendTimeoutMs + safetyMarginMs);
  });
});
