/**
 * issue #3261 —— `resolveLiveRunErrorOutcome` 的边界：它是失败**当场**那条路径
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
import {
  RUN_RECOVERED_NOTICE, describeFailedRunBanner, isRunSucceededWithOutput, resolveLiveRunErrorOutcome,
} from "@/lib/copilotkit-v2-failure-banner";

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

describe("resolveLiveRunErrorOutcome —— 活路径补读", () => {
  it("终态码 + 有 runId ⇒ 读一次权威事实，横幅说出成因", async () => {
    const fetchRun = vi.fn(async () => failedView);
    await expect(resolveLiveRunErrorOutcome({
      runId: "run-1", code: "MODEL_CALL_FAILED", bearer: "b", fetchRun: fetchRun as never,
    })).resolves.toEqual({ kind: "banner", text: describeAgentRunFailure("MODEL_CALL_FAILED", "executor_defect") });
    expect(fetchRun).toHaveBeenCalledWith("run-1", "b");
  });

  /*
   * issue #3387 ① —— 这条断言此前是「传输层码 ⇒ 一次请求都不打」。它省下的那次请求
   * 正是 bug 的落点：不读 `agent_runs`，就只能拿 wire 上那个码当「这次执行成没成」的
   * 答案，而那个码回答不了这个问题。现在**只要有 runId 就读**；文案在 run 未落成功
   * 终态时逐字不变。
   */
  it("传输层码同样要读一次权威事实；run 没成功 ⇒ 文案逐字不变", async () => {
    const fetchRun = vi.fn(async () => ({ ...failedView, status: "running" as const, error: null }));
    await expect(resolveLiveRunErrorOutcome({
      runId: "run-1", code: "THREAD_NOT_VISIBLE", bearer: "b", fetchRun: fetchRun as never,
    })).resolves.toEqual({ kind: "banner", text: "这个对话你当前没有查看权限" });
    expect(fetchRun).toHaveBeenCalledWith("run-1", "b");
  });

  it("拿不到 runId ⇒ 不打请求，退回旧文案", async () => {
    const fetchRun = vi.fn(async () => failedView);
    await expect(resolveLiveRunErrorOutcome({
      runId: null, code: "MODEL_CALL_FAILED", fetchRun: fetchRun as never,
    })).resolves.toEqual({ kind: "banner", text: describeAgentRunError("MODEL_CALL_FAILED") });
    expect(fetchRun).not.toHaveBeenCalled();
  });

  it("权威读自己失败（401/网络）⇒ 退回旧文案，不把读失败叠成第二个错误", async () => {
    const fetchRun = vi.fn(async () => { throw new Error("boom"); });
    await expect(resolveLiveRunErrorOutcome({
      runId: "run-1", code: "MODEL_CALL_FAILED", fetchRun: fetchRun as never,
    })).resolves.toEqual({ kind: "banner", text: describeAgentRunError("MODEL_CALL_FAILED") });
  });

  it("读回来这条 run 其实不是 failed ⇒ 不冒充成因", async () => {
    const fetchRun = vi.fn(async () => ({ ...failedView, status: "running" as const }));
    await expect(resolveLiveRunErrorOutcome({
      runId: "run-1", code: "MODEL_CALL_FAILED", fetchRun: fetchRun as never,
    })).resolves.toEqual({ kind: "banner", text: describeAgentRunError("MODEL_CALL_FAILED") });
  });
});

/**
 * issue #3367 第 ③ 类 —— 「run 停在 `awaiting_tool_permission`」被误译成「出错了」。
 *
 * `AGENT_RUN_NOT_AWAITING_TOOL_PERMISSION` 由 `decideToolPermission` 在
 * `stale_permission_request` / `form_decision_required` 两支抛出，而那两支的前置条件
 * 逐字是「run **仍是** `awaiting_tool_permission`」（见 `decide-tool-permission.ts`
 * L67-79）——那条待批请求依然有效。
 */
describe("issue #3367 —— 第 ③ 类：仍在等人批的 run 不能被译成「出错了」", () => {
  const awaitingView = {
    runId: "run-1", threadId: "t", status: "awaiting_tool_permission" as const,
    error: null, failureReason: null, resultMessageId: null,
    pendingApproval: {
      permissionRequestId: "11111111-2222-4333-8444-555555555555",
      interrupt: null, toolName: "call_skill", argsSummary: null,
    },
  };

  for (const code of ["AGENT_RUN_NOT_AWAITING_TOOL_PERMISSION", "NO_PENDING_APPROVAL"]) {
    it(`${code} + 权威读确认仍有待批请求 ⇒ 重挂审批卡，不出横幅`, async () => {
      const fetchRun = vi.fn(async () => awaitingView);
      await expect(resolveLiveRunErrorOutcome({
        runId: "run-1", code, bearer: "b", fetchRun: fetchRun as never,
      })).resolves.toEqual({ kind: "reattach_approval", runId: "run-1" });
      expect(fetchRun).toHaveBeenCalledWith("run-1", "b");
    });
  }

  it("权威读说这条 run 已经不在待批态 ⇒ fail closed，退回横幅，不凭错误码造卡片", async () => {
    const fetchRun = vi.fn(async () => ({ ...awaitingView, status: "running" as const, pendingApproval: null }));
    await expect(resolveLiveRunErrorOutcome({
      runId: "run-1", code: "AGENT_RUN_NOT_AWAITING_TOOL_PERMISSION", fetchRun: fetchRun as never,
    })).resolves.toEqual({ kind: "banner", text: "这次执行当前不处于等待审批状态" });
  });

  it("待批态但 pendingApproval 为空 ⇒ 同样 fail closed（没有可点的东西就别弹卡）", async () => {
    const fetchRun = vi.fn(async () => ({ ...awaitingView, pendingApproval: null }));
    await expect(resolveLiveRunErrorOutcome({
      runId: "run-1", code: "AGENT_RUN_NOT_AWAITING_TOOL_PERMISSION", fetchRun: fetchRun as never,
    })).resolves.toEqual({ kind: "banner", text: "这次执行当前不处于等待审批状态" });
  });
});

/**
 * issue #3387 ① —— 「有失败步骤」≠「这次执行没有成功」。
 *
 * 人类实测（devapp，2026-09-11）：回复正文已经给出几十行数据，执行条写
 * `执行过程 · 有失败步骤 · 历时 02:00 · 工具 17 次`（17 次工具里 4 次失败后重试成功，
 * 这句是准确的），**底部却是红色横幅「这次执行没有成功，请重试或联系管理员」**。
 *
 * 判据抓的是**组合**，不是「横幅在不在」：run 落 `succeeded` **且**产出已落库
 * （`resultMessageId !== null`，契约原话「Non-null only once #413's writeback
 * transaction has committed」）⇒ 不许出失败横幅。两个字段来自**同一次**权威读。
 */
describe("issue #3387 ① —— 有产出 + run 成功 ⇒ 不得显示失败横幅", () => {
  const succeededView = {
    runId: "run-1", threadId: "thr-1", status: "succeeded" as const,
    error: null, failureReason: null, resultMessageId: "msg-9",
  };

  it("判据自检：succeeded + 有 resultMessageId 才算数，缺一不可", () => {
    expect(isRunSucceededWithOutput(succeededView)).toBe(true);
    // succeeded 但产出没落库（`RESULT_UNREADABLE` 那一类）—— 仍然要如实报错。
    expect(isRunSucceededWithOutput({ ...succeededView, resultMessageId: null })).toBe(false);
    // 有产出但 run 不是成功终态 —— 不许被这条判据吞掉。
    expect(isRunSucceededWithOutput({ ...succeededView, status: "failed" })).toBe(false);
  });

  for (const code of [
    // 通用兜底文案那一支：既不是 `AgentRunError`、也不在 `TRANSPORT_ERROR_TEXT` 里——
    // 人类那一轮横幅逐字是兜底文案，落进的正是这一支（旧代码在这里一次读都不打）。
    "SOME_UNREGISTERED_STEP_ERROR",
    // 终态码那一支：wire 说 run 失败了，权威读说它成功了 —— 以权威读为准。
    "MODEL_CALL_FAILED",
    // 传输层码那一支（中继放弃轮询，run 其实跑完了，见 `poll-budget.ts`）。
    "AGENT_RUN_TIMEOUT",
    // approval_pending 那一支：run 已经成功就不该再弹审批卡。
    "AGENT_RUN_NOT_AWAITING_TOOL_PERMISSION",
  ]) {
    it(`${code} + 权威读说 succeeded 且有产出 ⇒ 不出失败横幅，改出完成提示`, async () => {
      const fetchRun = vi.fn(async () => succeededView);
      const outcome = await resolveLiveRunErrorOutcome({
        runId: "run-1", code, bearer: "b", fetchRun: fetchRun as never,
      });
      expect(
        outcome,
        `wire 上的码是 ${code}，但 agent_runs 的权威事实是 succeeded + resultMessageId=msg-9。`
          + `此时仍然产出 ${JSON.stringify(outcome)} 就是把「有失败步骤」说成了「这次执行没有成功」。`,
      ).toEqual({ kind: "recovered", text: RUN_RECOVERED_NOTICE });
      expect(fetchRun).toHaveBeenCalledWith("run-1", "b");
    });
  }

  it("自检：完成提示不是失败文案的换皮——它不含那句兜底失败话术", () => {
    expect(RUN_RECOVERED_NOTICE).not.toContain("没有成功");
    expect(RUN_RECOVERED_NOTICE).not.toBe("这次执行没有成功，请重试或联系管理员");
  });

  it("succeeded 但产出没落库 ⇒ 横幅照旧（不许顺手吞掉真问题）", async () => {
    const fetchRun = vi.fn(async () => ({ ...succeededView, resultMessageId: null }));
    await expect(resolveLiveRunErrorOutcome({
      runId: "run-1", code: "RESULT_UNREADABLE", fetchRun: fetchRun as never,
    })).resolves.toEqual({ kind: "banner", text: "回复已生成，但暂时读取不到内容" });
  });
});
