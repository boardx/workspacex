/**
 * issue #3261 —— `resolveLiveRunFailureBanner` 的边界：它是失败**当场**那条路径
 * 补权威读的地方，任何一个分支答错都会让横幅比修改前更糟（多打请求、或编出成因、
 * 或把读失败叠成第二个错误）。
 *
 * ⚠ 这些是**单元**断言。「成因真的上了产品面」由
 * `tests/ui/copilotkit-v2-live-failure-cause-banner.test.tsx`（挂真实面板 + 真实
 * CopilotKit 错误总线）与 e2e `chat-path-f1-failure-cause-distinguishable.spec.ts`
 * 判——本文件绿不构成那件事的证据（这个 issue 本身就是「单元层绿、活路径错」）。
 */
import { describe, expect, it, vi } from "vitest";
import { describeAgentRunError, describeAgentRunFailure } from "@/lib/agent-run";
import { describeFailedRunBanner, resolveLiveRunFailureBanner } from "@/lib/copilotkit-v2-failure-banner";

const failedView = {
  runId: "run-1", threadId: "thr-1", status: "failed" as const,
  error: "MODEL_CALL_FAILED", failureReason: "executor_defect" as const, resultMessageId: null,
};

describe("describeFailedRunBanner —— 两条路径共用的那一个算法", () => {
  it("视图带成因 ⇒ 说出成因", () => {
    expect(describeFailedRunBanner(failedView))
      .toBe(describeAgentRunFailure("MODEL_CALL_FAILED", "executor_defect"));
  });
  it("视图没有成因 ⇒ 逐字回落到只按码说话的旧文案", () => {
    expect(describeFailedRunBanner({ ...failedView, failureReason: null }))
      .toBe(describeAgentRunError("MODEL_CALL_FAILED"));
  });
  it("老快照连 error 都没有 ⇒ 用 wire 上那个码兜底", () => {
    expect(describeFailedRunBanner({ error: null, failureReason: null }, "MODEL_CALL_FAILED"))
      .toBe(describeAgentRunError("MODEL_CALL_FAILED"));
  });
});

describe("resolveLiveRunFailureBanner —— 活路径补读", () => {
  it("终态码 + 有 runId ⇒ 读一次权威事实，横幅说出成因", async () => {
    const fetchRun = vi.fn(async () => failedView);
    await expect(resolveLiveRunFailureBanner({
      runId: "run-1", code: "MODEL_CALL_FAILED", bearer: "b", fetchRun: fetchRun as never,
    })).resolves.toBe(describeAgentRunFailure("MODEL_CALL_FAILED", "executor_defect"));
    expect(fetchRun).toHaveBeenCalledWith("run-1", "b");
  });

  it("传输层码不是 run 的终态码 ⇒ 一次请求都不打", async () => {
    const fetchRun = vi.fn(async () => failedView);
    await expect(resolveLiveRunFailureBanner({
      runId: "run-1", code: "THREAD_NOT_VISIBLE", fetchRun: fetchRun as never,
    })).resolves.toBe("这个对话你当前没有查看权限");
    expect(fetchRun).not.toHaveBeenCalled();
  });

  it("拿不到 runId ⇒ 不打请求，退回旧文案", async () => {
    const fetchRun = vi.fn(async () => failedView);
    await expect(resolveLiveRunFailureBanner({
      runId: null, code: "MODEL_CALL_FAILED", fetchRun: fetchRun as never,
    })).resolves.toBe(describeAgentRunError("MODEL_CALL_FAILED"));
    expect(fetchRun).not.toHaveBeenCalled();
  });

  it("权威读自己失败（401/网络）⇒ 退回旧文案，不把读失败叠成第二个错误", async () => {
    const fetchRun = vi.fn(async () => { throw new Error("boom"); });
    await expect(resolveLiveRunFailureBanner({
      runId: "run-1", code: "MODEL_CALL_FAILED", fetchRun: fetchRun as never,
    })).resolves.toBe(describeAgentRunError("MODEL_CALL_FAILED"));
  });

  it("读回来这条 run 其实不是 failed ⇒ 不冒充成因", async () => {
    const fetchRun = vi.fn(async () => ({ ...failedView, status: "running" as const }));
    await expect(resolveLiveRunFailureBanner({
      runId: "run-1", code: "MODEL_CALL_FAILED", fetchRun: fetchRun as never,
    })).resolves.toBe(describeAgentRunError("MODEL_CALL_FAILED"));
  });
});
