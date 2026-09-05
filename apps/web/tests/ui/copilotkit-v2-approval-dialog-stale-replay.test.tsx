/**
 * issue #2779 —— 真实复现（见该 issue 的评论与 `copilotkit-v2-approval-dialog.tsx`
 * 的 `liveSeenApprovalToolCallIds` 头注）：`SendEmailApprovalDialog` 只读分支此前
 * 只看 `awaitingDecision`/`statusLabel`，不管这个 `toolCallId` 是不是这个浏览器标签页
 * 第一次见到——翻线程历史（页面刷新、切换线程）时，任何一条早就裁决完的
 * `call_skill` 审批都会被当成"刚发生"重新弹一个盖住 composer 的模态框，用户必须先
 * 点"关闭"才能继续用这条线程。`copilotkit-v2-hitl.spec.ts` 三条用例连续跑时意外
 * 实测抓到（截图见 issue 评论）。
 *
 * 本文件在组件级钉死修复后的行为：
 *  ① 一个 `toolCallId` 从未在本模块的 `Set` 里出现过（=模拟"翻旧账"，组件第一次
 *     渲染就是 `"complete"`）——不应该渲染任何 Dialog。
 *  ② 一个 `toolCallId` 先以 `"executing"` 渲染过（=真的在这次会话里等待裁决），
 *     再以 `"complete"` 渲染（respond 已经调用完）——**应该**渲染只读终止态 Dialog，
 *     这是原有的、故意保留的连续性 UX（DA-19g fix，issue #1996 头注），不能被这次
 *     修复误伤。
 *
 * ⚠ 反空转：这两个 toolCallId 必须不同——否则①能通过只是因为它复用了②已经在同一个
 * 测试文件里"预热"过的 Set 条目，而不是真的验证了"从未见过"这条路径。
 */
import * as React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SendEmailApprovalDialog } from "@/components/chat/copilotkit-v2-approval-dialog";

afterEach(cleanup);

const ARGS = { skill_stable_name: "quarterly-report", task: "生成季度报告" };

describe("issue #2779 -- SendEmailApprovalDialog 不对翻旧账的历史裁决弹模态框", () => {
  it("① 从未在本标签页观察到未决态的 toolCallId 直接以 complete 渲染 ⇒ 不挂载任何 Dialog（翻旧账）", () => {
    const { container } = render(
      <SendEmailApprovalDialog
        toolCallId="stale-replay-never-seen-live"
        statusLabel="complete"
        awaitingDecision={false}
        args={ARGS}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("copilotkit-v2-hitl-dialog")).not.toBeInTheDocument();
  });

  it("② 先以 executing 观察到未决态、再以 complete 渲染同一个 toolCallId ⇒ 正常弹只读终止态 Dialog（真实刚裁决完）", () => {
    const toolCallId = "genuinely-live-then-resolved";
    const { rerender } = render(
      <SendEmailApprovalDialog
        toolCallId={toolCallId}
        statusLabel="executing"
        awaitingDecision
        args={ARGS}
        respond={() => {}}
      />,
    );
    expect(screen.getByTestId("copilotkit-v2-hitl-dialog")).toBeInTheDocument();

    rerender(
      <SendEmailApprovalDialog
        toolCallId={toolCallId}
        statusLabel="complete"
        awaitingDecision={false}
        args={ARGS}
      />,
    );
    expect(screen.getByTestId("copilotkit-v2-hitl-dialog")).toBeInTheDocument();
    expect(screen.getByText("本轮已裁决，等待 run 收尾。")).toBeInTheDocument();
  });
});
