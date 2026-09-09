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
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RestoredRunApproval } from "@/components/chat/workbench/restored-run-approval";
const calls = vi.hoisted(() => ({ read: vi.fn(), request: vi.fn() }));
vi.mock("@/lib/agent-run", () => ({ getAgentRun: calls.read }));
vi.mock("@/lib/api-client", () => ({ apiRequest: calls.request }));
beforeEach(() => { calls.read.mockReset(); calls.request.mockReset(); });

function awaiting(permissionRequestId: string, skill: string) {
  return {
    status: "awaiting_tool_permission",
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
      .mockResolvedValueOnce({ status: "running", pendingApproval: null }) // 裁决后的确认读
      .mockResolvedValue(awaiting("req-2", "web-research"));      // 引擎立刻再次中断
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
