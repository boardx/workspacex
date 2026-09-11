/**
 * issue #3420 第二条缺陷 —— **系统告诉用户的原因，不是真实原因**（同族：#3280 / #3323 /
 * #3403 ④）。
 *
 * 人类实测：第一次权限门上选的是「本 run 内都允许」，第二次弹框时那段解释却把原因
 * 说成「你上次选的是『仅本次允许』——那一档只对那一次调用生效」。用户据此以为是自己
 * 点错了档位，而事实上他点的就是最宽的那一档。
 *
 * # 判据落在用户看见的那句话上，且要抓得住「说成了另一个档位」
 *
 * 只断言「有解释文案」是抓不住这种错的（错的那句也是文案）。所以每一条用例都：
 * ① 断言它**说出用户真正选过的那一档**；② 断言它**不会把别的档位安到用户头上**。
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { RestoredRunApproval } from "@/components/chat/workbench/restored-run-approval";

const calls = vi.hoisted(() => ({ read: vi.fn(), request: vi.fn() }));
vi.mock("@/lib/agent-run", () => ({ getAgentRun: calls.read }));
vi.mock("@/lib/api-client", () => ({ apiRequest: calls.request }));
beforeEach(() => { calls.read.mockReset(); calls.request.mockReset(); });

const mount = async (last: "once" | "run" | "forever" | "deny") => {
  calls.read.mockResolvedValue({
    status: "awaiting_tool_permission",
    pendingApproval: { permissionRequestId: "second-request", toolName: "execute", argsSummary: "{\"command\":\"python3 render-office.py\"}" },
    permissionDecisions: { count: 1, last },
  });
  render(<RestoredRunApproval runId="run" bearer="token" />);
  return screen.findByTestId("perm-repeat-notice");
};

describe("#3420 ②：重复授权提示不得把用户没选过的档位说成他的选择", () => {
  it("上次选的是「本 run 内都允许」：提示必须说出这一档，绝不能说成「仅本次允许」", async () => {
    const notice = await mount("run");
    expect(
      notice,
      "用户点的就是最宽的那一档。说不出这一档，用户唯一能得到的解释就是那句错的",
    ).toHaveTextContent("本 run 内都允许");
    expect(
      notice.textContent,
      "把「仅本次允许」安到选了 run 的用户头上 = 系统告诉用户的原因不是真实原因（#3420 实测原话）",
    ).not.toContain("你上次选的是「仅本次允许」");
  });

  it("上次选的是「以后都允许」：同样说出真正的那一档", async () => {
    const notice = await mount("forever");
    expect(notice).toHaveTextContent("以后都允许");
    expect(notice.textContent).not.toContain("你上次选的是「仅本次允许」");
  });

  it("上次真的选了「仅本次允许」时，那一句仍然要说（这条修的是错归因，不是把解释删掉）", async () => {
    const notice = await mount("once");
    expect(notice).toHaveTextContent("仅本次允许");
  });
});
