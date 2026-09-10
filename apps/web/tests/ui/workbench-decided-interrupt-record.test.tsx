/**
 * issue #3310 ① / ② / ③ —— 「已确认的卡片没消失 / 改了舟山→中山仍显示舟山 / 生成画布时整张卡片消失」。
 *
 * 三条是**同一个机理**的三种表现：那张 confirm_task_intent 卡片「现在该画成什么样」此前
 * 由两个**活的、会在正确时刻丢失的**信号决定——
 *   · `InterruptRenderContext.pendingRunId`（宿主 `copilotkit-v2-panel-body.tsx:1638`，
 *     只在 run 停在 `awaiting_tool_permission` 时等于 runId）；
 *   · `restored-run-approval.tsx` 里的 `fallbackWasPending`（一个 `useState`）。
 *
 * ① 裁决之前 `pendingRunId === runId` ⇒ 内联 `InterruptView` 一直 `return null` ⇒ 带
 *    fallbackInterrupt 的 `RestoredRunApproval` **从未挂载过** ⇒ `fallbackWasPending` 永远
 *    是 false。裁决之后 pendingRunId 清空、它才第一次挂载，权威读此时 `pendingApproval=null`，
 *    于是落到「等待服务端确认此请求，确认后即可继续。」——服务端根本没在等任何确认。
 *    （#3281 收窄的正是那条分支，但它的判据 `fallbackWasPending` 在这条路径上不可能置位。）
 * ③ 同一条 run 上**下一次**授权请求（生成画布）到来 ⇒ pendingRunId 又等于 runId ⇒ 内联
 *    `return null` ⇒ 已裁决的那张记录整张消失。与 #3302 同族。
 * ② 记录画的是 `fallbackInterrupt`（模型最初的提案），而用户的编辑落在服务端的
 *    `pending_edited_args` 上，此前没有任何一处把它合回展示 ⇒ 永远画「舟山」。
 *
 * 修法：这张卡片是「已裁决 / 待裁决 / 尚未持久化」哪一种，收敛到服务端一处事实——
 * `AgentRunView.resolvedApprovals`（append-only 的权威裁决留痕，已把 editedArgs 合进 args）。
 *
 * ⚠ 判据挡假修法：
 *   · ① 不能靠「把那句话删了」过关——「尚未持久化」用例断言那句话**必须**还在；
 *   · ③ 不能靠「让组件别卸载」过关——用例每次都是**全新 render**（真的重挂载），
 *     本地 state 一律为初值。
 */
import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ read: vi.fn(), request: vi.fn() }));
vi.mock("@/lib/agent-run", () => ({ getAgentRun: calls.read }));
vi.mock("@/lib/api-client", () => ({ apiRequest: calls.request }));
const registered = vi.hoisted(() => ({} as Record<string, { render: (input: unknown) => unknown }>));
vi.mock("@copilotkit/react-core/v2", () => ({
  useHumanInTheLoop: (tool: { name: string; render: (input: unknown) => unknown }) => { registered[tool.name] = tool; },
}));

import { CopilotKitV2AgentInterrupts } from "@/components/chat/copilotkit-v2-agent-interrupts";
import { MessageRunContext } from "@/lib/chat-workbench/trace-context";
import { InterruptRenderContext } from "@/components/chat/workbench/interrupt-render-context";

/** 人类实测那一条：原始提案说「舟山」。 */
const PROPOSED = {
  requestId: "req-1",
  understanding: "为舟山马鞍岛的一位房产中介生成用户画像",
  assumptions: ["画像面向 C 端购房客户", "服务区域是舟山马鞍岛"],
};
/** 用户点「改假设」后真正被服务端接受的那一份：舟山 → 中山。 */
const DECIDED_ARGS = {
  requestId: "req-1",
  understanding: "为中山马鞍岛的一位房产中介生成用户画像",
  assumptions: ["画像面向 C 端购房客户", "服务区域是中山马鞍岛"],
};
const RESOLVED = {
  permissionRequestId: "11111111-1111-4111-8111-111111111111",
  toolName: "confirm_task_intent",
  decision: "edit" as const,
  interrupt: { toolName: "confirm_task_intent", args: DECIDED_ARGS },
};

function Inline({ pendingRunId }: { pendingRunId: string | null }): JSX.Element {
  return <MessageRunContext.Provider value="run-1">
    <InterruptRenderContext.Provider value={{ canWrite: true, pendingRunId }}>
      {registered.confirm_task_intent!.render({ status: "executing", args: PROPOSED }) as React.ReactNode}
    </InterruptRenderContext.Provider>
  </MessageRunContext.Provider>;
}

beforeEach(() => {
  calls.read.mockReset(); calls.request.mockReset();
  render(<CopilotKitV2AgentInterrupts />);
});

describe("#3310 ① 裁决过的确认卡片不再假装服务端还在等确认", () => {
  it("宿主先渲染待决卡、裁决后交回内联：内联必须画成「已结束的确认记录」，不是「等待服务端确认」", async () => {
    calls.read.mockResolvedValue({ status: "running", pendingApproval: null, resolvedApprovals: [RESOLVED] });
    const view = render(<Inline pendingRunId="run-1" />);
    // 裁决完成：run 离开 awaiting_tool_permission，宿主不再渲染待决卡。
    view.rerender(<Inline pendingRunId={null} />);
    expect(await screen.findByLabelText("已结束的确认记录")).toBeVisible();
    expect(screen.queryByTestId("interrupt-awaiting-persistence")).toBeNull();
    expect(screen.queryByText(/等待服务端确认此请求/)).toBeNull();
  });

  it("对照组（不能靠删这句话过关）：确实没被持久化过时，「等待服务端确认此请求」照旧出现", async () => {
    calls.read.mockResolvedValue({ status: "running", pendingApproval: null, resolvedApprovals: [] });
    render(<Inline pendingRunId={null} />);
    expect(await screen.findByTestId("interrupt-awaiting-persistence")).toHaveTextContent("等待服务端确认此请求");
  });
});

/**
 * `chat-path-ab-hitl-continuity.spec.ts:189` 的既有判据：裁决之后，「继续」按钮**不得**还在
 * DOM 里（`toHaveCount(0)`）——一个看起来能点、点了没反应的按钮正是 #3186「点了没反应」的形状。
 * 本 PR 让已裁决的那一条改为**渲染**一张记录卡，因此必须在这里把那条不变量钉死：
 * 只靠 `<fieldset disabled>` 蒙混过不了关（按钮仍在 DOM 里）。
 */
describe("#3310 已结束的记录必须说清楚它已经结束了", () => {
  it("决策入口保留但禁用（#3244 的裁定：留痕不是抹掉），那句此刻为假的「后续步骤不会开始」去掉", async () => {
    calls.read.mockResolvedValue({ status: "running", pendingApproval: null, resolvedApprovals: [RESOLVED] });
    render(<Inline pendingRunId={null} />);
    const record = await screen.findByLabelText("已结束的确认记录");
    expect(screen.getByTestId("agent-interrupt-confirm-intent-continue")).toBeDisabled();
    expect(
      screen.queryByTestId("agent-interrupt-confirm-intent-gated-notice"),
      "「后续步骤在你确认前不会开始」——用户早就确认过了，这句话此刻是假的",
    ).toBeNull();
    // 而它必须说清楚这是哪一次：用户当时点的是「改假设后确认」。
    expect(record).toHaveTextContent("你已按修改后的内容确认过这一次");
  });
});

describe("#3310 ② 已裁决记录画的是被采纳的那一份，不是模型最初的提案", () => {
  it("用户把舟山改成中山 ⇒ 记录里逐字是中山，且不再出现舟山", async () => {
    calls.read.mockResolvedValue({ status: "running", pendingApproval: null, resolvedApprovals: [RESOLVED] });
    render(<Inline pendingRunId={null} />);
    const record = await screen.findByLabelText("已结束的确认记录");
    await waitFor(() => expect(record).toHaveTextContent("中山马鞍岛"));
    expect(record.textContent ?? "").not.toContain("舟山");
  });
});

describe("#3310 ③ 同一条 run 的下一次授权请求不得抹掉已裁决的那张记录", () => {
  it("生成画布触发第二次授权（pendingRunId 又等于 runId）时，已裁决记录仍在——且这是一次全新挂载", async () => {
    calls.read.mockResolvedValue({
      status: "awaiting_tool_permission",
      pendingApproval: { permissionRequestId: "22222222-2222-4222-8222-222222222222", toolName: "wx_canvas_update", argsSummary: "canvas args", interrupt: null },
      resolvedApprovals: [RESOLVED],
    });
    render(<Inline pendingRunId="run-1" />);
    const record = await screen.findByLabelText("已结束的确认记录");
    expect(record).toHaveTextContent("中山马鞍岛");
  });

  it("对照组（去重没有被放宽）：待决的正是这一条时，内联不再画第二份", async () => {
    calls.read.mockResolvedValue({
      status: "awaiting_tool_permission",
      pendingApproval: { permissionRequestId: "33333333-3333-4333-8333-333333333333", toolName: "confirm_task_intent", argsSummary: null, interrupt: { toolName: "confirm_task_intent", args: PROPOSED } },
      resolvedApprovals: [],
    });
    const { container } = render(<Inline pendingRunId="run-1" />);
    await waitFor(() => expect(calls.read).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("run 落终态后，已裁决记录仍留在对话里（不是整张消失）", async () => {
    calls.read.mockResolvedValue({ status: "succeeded", pendingApproval: null, resolvedApprovals: [RESOLVED] });
    render(<Inline pendingRunId={null} />);
    expect(await screen.findByLabelText("已结束的确认记录")).toHaveTextContent("中山马鞍岛");
  });
});
