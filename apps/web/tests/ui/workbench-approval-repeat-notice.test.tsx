/**
 * issue #3302 —— 「这是本次任务里第几次请求授权」必须活过 `running` 那段窗口。
 *
 * # 缺陷形状
 *
 * 计数曾经存在本组件的 `useState` 里，而组件的挂载门（`copilotkit-v2-panel-body.tsx`）
 * 是 `status === "awaiting_tool_permission"`。同一条 run 的两次中断之间整段是
 * `running` ⇒ 组件被**正确地**卸载 ⇒ 计数清零 ⇒ `history.count > 0` 恒假 ⇒
 * #3212 ② 的提示在同一条 run 的第二次授权上永远不出现。
 *
 * # 判据为什么这么写（挡假修法）
 *
 * ① 第一条用例里**没有任何一次点击发生在这个页面上**：它是全新挂载，第一次读到的就是
 *    「服务端说你已经裁决过 1 次」。这挡住「把本地状态搬到 module 级缓存 / ref / 让组件
 *    别卸载」那一类修法——它们在本页面里根本没有那次裁决可数。真实场景同形：刷新、
 *    换标签页、冷启动进这条线程。
 * ② 断言判的是**用户看见的那句话**（「第 2 次」「仅本次允许」），不是内部计数变量，
 *    也不是「组件还挂着」。
 * ③ 第三条用例把服务端的 `count` 拿掉（老快照/字段缺席），提示必须消失——绝不编一个
 *    次数出来。这挡住「找不到就默认显示第 2 次」的兜底式假修法。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RestoredRunApproval } from "@/components/chat/workbench/restored-run-approval";

const calls = vi.hoisted(() => ({ read: vi.fn(), request: vi.fn() }));
vi.mock("@/lib/agent-run", () => ({ getAgentRun: calls.read }));
vi.mock("@/lib/api-client", () => ({ apiRequest: calls.request }));
beforeEach(() => { calls.read.mockReset(); calls.request.mockReset(); });

const pending = (permissionRequestId: string) => ({
  permissionRequestId, toolName: "call_skill", argsSummary: "{\"skill_stable_name\":\"webresearch\"}",
});

describe("#3302 授权重复提示的事实源是服务端，不是组件的生命周期", () => {
  it("组件从未见过那次裁决（全新挂载）也必须说出「第 2 次」与上次那一档", async () => {
    calls.read.mockResolvedValue({
      status: "awaiting_tool_permission",
      pendingApproval: pending("second-request"),
      permissionDecisions: { count: 1, last: "once" },
    });
    render(<RestoredRunApproval runId="run" bearer="token" />);
    const notice = await screen.findByTestId("perm-repeat-notice");
    expect(
      notice,
      "同一条 run 的第二次授权：用户必须能把「这是一次新请求」与「上次点击没生效」分开。"
      + "计数若存在会被卸载门销毁的本地状态里，这里恒为不可见（#3302 的缺陷形状）",
    ).toHaveTextContent("第 2 次请求授权");
    expect(
      notice,
      "上一档是「仅本次允许」——那一档按 I-4 本来就不落授权记录，所以这次要重新确认。"
      + "说不出这一句 = 只数了次数、丢了「上次选了哪档」，用户仍然不知道为什么又问",
    ).toHaveTextContent("仅本次允许");
  });

  it("第三次授权说「第 3 次」：数字来自服务端，不是本地 +1", async () => {
    calls.read.mockResolvedValue({
      status: "awaiting_tool_permission",
      pendingApproval: pending("third-request"),
      permissionDecisions: { count: 2, last: "deny" },
    });
    render(<RestoredRunApproval runId="run" />);
    const notice = await screen.findByTestId("perm-repeat-notice");
    expect(notice).toHaveTextContent("第 3 次请求授权");
    expect(notice, "上一次选的是拒绝，文案必须说的是拒绝那一支").toHaveTextContent("拒绝");
  });

  it("第一次授权（服务端说裁决数为 0）不得出现提示", async () => {
    calls.read.mockResolvedValue({
      status: "awaiting_tool_permission",
      pendingApproval: pending("first-request"),
      permissionDecisions: { count: 0, last: null },
    });
    render(<RestoredRunApproval runId="run" />);
    await screen.findByTestId("chat-task-workbench-approval-card");
    expect(screen.queryByTestId("perm-repeat-notice"), "第一次弹窗出现「第几次」说明计数本身是错的").toBeNull();
  });

  it("老快照缺 permissionDecisions 时不编次数", async () => {
    calls.read.mockResolvedValue({ status: "awaiting_tool_permission", pendingApproval: pending("legacy-request") });
    render(<RestoredRunApproval runId="run" />);
    await screen.findByTestId("chat-task-workbench-approval-card");
    expect(screen.queryByTestId("perm-repeat-notice")).toBeNull();
  });

  it("裁决之后的提示仍由权威读决定：服务端说 2 次就是「第 3 次」，不是本组件加一", async () => {
    calls.read
      .mockResolvedValueOnce({ status: "awaiting_tool_permission", pendingApproval: pending("req-a"), permissionDecisions: { count: 1, last: "once" } })
      // 裁决后的那次权威读：服务端已记到 2，且下一个请求身份已经到来。
      .mockResolvedValue({ status: "awaiting_tool_permission", pendingApproval: pending("req-b"), permissionDecisions: { count: 2, last: "run" } });
    calls.request.mockResolvedValue({});
    render(<RestoredRunApproval runId="run" />);
    fireEvent.click(await screen.findByRole("button", { name: "仅本次允许" }));
    await waitFor(() => expect(calls.request).toHaveBeenCalled());
    await waitFor(async () => expect(await screen.findByTestId("perm-repeat-notice")).toHaveTextContent("第 3 次请求授权"));
  });
});
