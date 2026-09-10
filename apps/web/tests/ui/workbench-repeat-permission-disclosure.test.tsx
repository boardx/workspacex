/**
 * issue #3212 —— 「我已经批复了 webresearch，后来还弹出来」。
 *
 * ## 取证结论（先写预测再取证，两条预测都实测过）
 *
 * P1（预测：绿）——「本 run 内都允许」/「以后都允许」之后，同一 run 内同类调用**确实**
 * 不再询问：`decidePermissionRequest` 写入的键与 `tool-permission-gate.ts` 查询的键
 * 都是 `pending_tool_name`（`call_skill`），逐字一致。**「授权存储或查询坏了」被证伪。**
 *
 * 所以用户当时点的只可能是**「仅本次允许」**——那一档按 I-4 本来就不落任何授权记录，
 * 下一次同类调用**再问一遍在语义上是正确的**。按 #3212 的交付要求，这种情况
 * **不改行为，改的是界面**：让用户看得出这是一次**新的**请求、以及**为什么又问**。
 *
 * 而此前界面做不到这一点：`call_skill` 的 intent 恒为「调用一个需要授权的技能」，
 * **不带技能名**——第二次弹窗与第一次逐像素相同，用户无从分辨这是新请求还是上次
 * 那次「没反应」（这正是 #3186 报的「点了没反应」与真实机理无法区分的原因）。
 *
 * 本测试钉住两件事，都不放宽任何授权门：
 * ① 卡片必须说清楚**要授权的是哪个技能**；
 * ② 用户在同一 run 内已做过一次裁决后又被问第二次时，界面必须显式说明这是第几次、
 *    以及上次选的「仅本次允许」只对那一次生效。
 *
 * ## issue #3302 —— ② 这一条此前是**绿着的空转**
 *
 * 下面那条用例一直是绿的，因为它在**同一次挂载**里点了那一下，而计数当时就存在组件的
 * `useState` 里。真实链路上不是这样：两次中断之间整段是 `running`，审批组件的挂载门
 * （`status === "awaiting_tool_permission"`）会把它整个卸载，计数当场清零 ⇒ ② 在同一条
 * run 的第二次授权上从未出现过。**替身产不出缺陷的形状**：这里的 `getAgentRun` 替身
 * 从来不下发裁决历史，所以「计数是不是服务端给的」在这个剧本里不可被证伪。
 *
 * 修法把事实源收敛到服务端（`AgentRunView.permissionDecisions`），因此下面的替身也必须
 * 说真话：`awaiting()` 现在带上这条 run 的裁决历史，与真实权威读同形。
 * 「计数活过卸载」那一条判据不在本文件——它在 `workbench-approval-repeat-notice.test.tsx`
 * （全新挂载、本页面没有发生过任何点击）与 `apps/api/tests/agent-run/permission-decision-history.test.ts`
 * （真库跨越 running 窗口）。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RestoredRunApproval } from "@/components/chat/workbench/restored-run-approval";
const calls = vi.hoisted(() => ({ read: vi.fn(), request: vi.fn() }));
vi.mock("@/lib/agent-run", () => ({ getAgentRun: calls.read }));
vi.mock("@/lib/api-client", () => ({ apiRequest: calls.request }));
beforeEach(() => { calls.read.mockReset(); calls.request.mockReset(); });

function awaiting(
  permissionRequestId: string, skill: string,
  /** #3302：这条 run 上已被服务端接受的裁决历史，与真实权威读同形。 */
  permissionDecisions: { count: number; last: "once" | "run" | "forever" | "deny" | null } = { count: 0, last: null },
) {
  return {
    status: "awaiting_tool_permission",
    permissionDecisions,
    pendingApproval: {
      permissionRequestId, toolName: "call_skill", interrupt: null,
      argsSummary: JSON.stringify({ skill_stable_name: skill, task: "查一下最新的行业数据" }),
    },
  };
}

describe("issue #3212 —— 再次询问必须可分辨、可理解（不放宽授权门）", () => {
  it("卡片指名要授权的技能，不是一句谁都一样的「一个需要授权的技能」", async () => {
    calls.read.mockResolvedValue(awaiting("req-1", "web-research"));
    render(<RestoredRunApproval runId="run" bearer="t" />);
    const intent = await screen.findByTestId("perm-intent");
    expect(intent).toHaveTextContent("web-research");
  });

  it("同一 run 内「仅本次允许」之后又被问 ⇒ 界面说明这是新的一次请求、以及为什么又问", async () => {
    calls.read
      .mockResolvedValueOnce(awaiting("req-1", "web-research"))   // 首轮渲染
      // 裁决后的确认读：服务端已把这次裁决记进账（#3302），此刻没有待决请求。
      .mockResolvedValueOnce({ status: "running", pendingApproval: null, permissionDecisions: { count: 1, last: "once" } })
      // 引擎立刻再次中断：新的请求身份，历史接着数。
      .mockResolvedValue(awaiting("req-2", "web-research", { count: 1, last: "once" }));
    calls.request.mockResolvedValue({});
    render(<RestoredRunApproval runId="run" bearer="t" />);

    fireEvent.click(await screen.findByRole("button", { name: "仅本次允许" }));
    await waitFor(() => expect(calls.request).toHaveBeenCalledTimes(1));

    // 第二次询问必须出现，且必须可见可点——重复询问本身是正确行为，不该被藏起来。
    await waitFor(() => expect(screen.getByTestId("perm-command"))
      .toHaveTextContent("web-research"), { timeout: 5000 });
    const again = await screen.findByTestId("perm-repeat-notice");
    expect(again).toBeVisible();
    expect(again).toHaveTextContent("第 2 次");
    expect(again).toHaveTextContent("仅本次允许");
    expect(screen.getByRole("button", { name: "本 run 内都允许" })).toBeEnabled();
  });

  it("首次询问时不显示「又问了一次」的说明——没发生的事不许写在界面上", async () => {
    calls.read.mockResolvedValue(awaiting("req-1", "web-research"));
    render(<RestoredRunApproval runId="run" bearer="t" />);
    await screen.findByTestId("tool-permission-card");
    expect(screen.queryByTestId("perm-repeat-notice")).toBeNull();
  });
});
