/**
 * 门② / 门③ 面板 + 审计栏 —— 真渲染，断言用户看到的字。
 *
 * 最重要的一条是「Agent 曾 N 次试图跳过人工确认」：那条信息的价值全在**被看见**。
 * 埋进日志等于只有工程师能看见，而它恰恰是行研人员和他上级最该看见的事。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { researchWorkflow as C } from "@repo/contracts";

const passResearchGate = vi.fn();
const getResearchAudit = vi.fn();

vi.mock("@/lib/live-research-workflow", async () => {
  const actual = await vi.importActual<typeof import("@/lib/live-research-workflow")>(
    "@/lib/live-research-workflow",
  );
  return {
    ...actual,
    passResearchGate: (...a: unknown[]) => passResearchGate(...a),
    getResearchAudit: (...a: unknown[]) => getResearchAudit(...a),
  };
});

const { ResearchGatePanel, ResearchAuditTrail } = await import("@/components/agent/research-gate-panel");

const THREAD = "11111111-1111-4111-8111-111111111111";

function session(phase: C.ResearchPhaseName, over: Partial<{ batch: string | null; published: number }> = {}) {
  return {
    threadId: THREAD,
    phase,
    lineage: {
      materialBatchId: over.batch === undefined ? "b1" : over.batch,
      fieldSchemeVersion: 1,
      logicVersion: 1,
      publishedGraphVersion: over.published ?? 0,
    },
    materials: [],
    verifyDueAt: null,
    updatedAt: "2026-09-16T00:00:00.000Z",
  };
}

beforeEach(() => { passResearchGate.mockReset(); getResearchAudit.mockReset().mockResolvedValue([]); });
afterEach(cleanup);

describe("出现时机", () => {
  it.each(C.RESEARCH_PHASES.filter((p) => !["graph_review", "plan_review"].includes(p)))(
    "阶段 %s 不渲染门②/门③面板",
    (phase) => {
      render(<ResearchGatePanel session={session(phase)} onChange={() => {}} />);
      expect(screen.queryByTestId("research-gate-panel-reasoning")).toBeNull();
      expect(screen.queryByTestId("research-gate-panel-plan")).toBeNull();
    },
  );

  it("graph_review 渲染门②，plan_review 渲染门③", () => {
    render(<ResearchGatePanel session={session("graph_review")} onChange={() => {}} />);
    expect(screen.getByTestId("research-gate-panel-reasoning")).toBeInTheDocument();
    cleanup();
    render(<ResearchGatePanel session={session("plan_review")} onChange={() => {}} />);
    expect(screen.getByTestId("research-gate-panel-plan")).toBeInTheDocument();
  });
});

describe("门②审的是差异不是全图", () => {
  it("已有发布版时，明说本次审的是与第 N 版的差异", () => {
    render(<ResearchGatePanel session={session("graph_review", { published: 2 })} onChange={() => {}} />);
    const scope = screen.getByTestId("research-gate-scope");
    expect(scope).toHaveTextContent("与第 2 版的差异");
    expect(scope).toHaveTextContent("第 3 版");
  });

  /**
   * 2026-09-15 看真机截图发现：原文写的是 markdown 的 `**粗体**`，而 JSX 不渲染
   * markdown——屏幕上直接出现两个星号。同 `<br>` 那个缺陷的同一形状：
   * 没有任何一层会对一段它不认识的文本报错，它只是忠实地画出来。
   */
  it("强调用真元素，不是 markdown 星号（JSX 不渲染 markdown）", () => {
    render(<ResearchGatePanel session={session("graph_review", { published: 2 })} onChange={() => {}} />);
    expect(screen.getByTestId("research-gate-scope").textContent).not.toContain("**");
  });

  it("第一版时说的是「核实每个节点的判断状态是否都有材料依据」，不谈差异", () => {
    render(<ResearchGatePanel session={session("graph_review", { published: 0 })} onChange={() => {}} />);
    const scope = screen.getByTestId("research-gate-scope");
    expect(scope).toHaveTextContent("第一版");
    expect(scope).not.toHaveTextContent("差异");
  });
});

describe("没有材料批次时提前说清，而不是让用户点了才知道", () => {
  it("按钮禁用 + 说明 + 提示先完成材料确认", () => {
    render(<ResearchGatePanel session={session("graph_review", { batch: null })} onChange={() => {}} />);
    expect(screen.getByTestId("research-pass-gate-reasoning")).toBeDisabled();
    expect(screen.getByTestId("research-gate-disabled-reason")).toHaveTextContent("材料尚未通过确认");
    expect(screen.getByTestId("research-gate-no-batch")).toHaveTextContent("结论必须挂在有人审过的材料上");
  });

  it("有材料批次时按钮可点", () => {
    render(<ResearchGatePanel session={session("graph_review", { batch: "b1" })} onChange={() => {}} />);
    expect(screen.getByTestId("research-pass-gate-reasoning")).toBeEnabled();
    expect(screen.queryByTestId("research-gate-no-batch")).toBeNull();
  });

  /**
   * 2026-09-15 看真机截图发现：Button 的默认 variant 是 secondary（灰底），
   * 而禁用态也是灰的——"可以点"与"点不了"在屏幕上长得一模一样。
   * 一个看不出可点的主按钮，可用性上约等于没有。
   */
  it("主确认按钮是 primary，不是与禁用态同色的默认灰", () => {
    render(<ResearchGatePanel session={session("graph_review", { batch: "b1" })} onChange={() => {}} />);
    const btn = screen.getByTestId("research-pass-gate-reasoning");
    // primary 与 secondary 的类名不同；断言"不是 secondary 那一套"而不是写死色值
    expect(btn.className).not.toMatch(/bg-secondary/);
  });
});

describe("过门", () => {
  it("点确认真的调用服务端并把新状态交出去", async () => {
    const next = session("graph_published", { published: 1 });
    passResearchGate.mockResolvedValue(next);
    const onChange = vi.fn();
    render(<ResearchGatePanel session={session("graph_review")} onChange={onChange} />);

    fireEvent.click(screen.getByTestId("research-pass-gate-reasoning"));
    await waitFor(() => expect(passResearchGate).toHaveBeenCalledWith(THREAD, "reasoning"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(next));
  });

  it("被拒时显示 what + next 两句", async () => {
    const { ApiError } = await import("@/lib/api-client");
    const err = new ApiError(409, "GATE_NOT_PASSED", {});
    passResearchGate.mockRejectedValue(err);
    render(<ResearchGatePanel session={session("graph_review")} onChange={() => {}} />);

    fireEvent.click(screen.getByTestId("research-pass-gate-reasoning"));
    await waitFor(() => {
      const box = screen.getByTestId("research-gate-failure");
      expect(box).toHaveTextContent("前一道人工确认门还没通过");
      expect(box).toHaveTextContent("回到上一步");
    });
  });
});

describe("审计栏", () => {
  const row = (over: Partial<ResearchAuditRow> = {}): ResearchAuditRow => ({
    actorKind: "agent", action: "advance:graph_published", fromPhase: "generating",
    outcome: "refused", refusal: "GATE_NOT_PASSED", createdAt: "2026-09-16T01:00:00.000Z", ...over,
  });
  type ResearchAuditRow = {
    actorKind: "human" | "agent"; action: string; fromPhase: C.ResearchPhaseName;
    outcome: "allowed" | "refused"; refusal: C.ResearchRefusalName | null; createdAt: string;
  };

  it("**把 Agent 跳门尝试显式说出来**（埋进日志等于只有工程师看得见）", async () => {
    getResearchAudit.mockResolvedValue([row(), row()]);
    render(<ResearchAuditTrail threadId={THREAD} />);
    await waitFor(() =>
      expect(screen.getByTestId("research-skip-attempts")).toHaveTextContent("Agent 曾 2 次试图跳过人工确认"),
    );
  });

  it("没有跳门尝试时不显示那行警告（不制造不存在的焦虑）", async () => {
    getResearchAudit.mockResolvedValue([
      row({ actorKind: "human", action: "gate:materials", outcome: "allowed", refusal: null }),
    ]);
    render(<ResearchAuditTrail threadId={THREAD} />);
    await waitFor(() => expect(screen.getByTestId("research-audit-trail")).toBeInTheDocument());
    expect(screen.queryByTestId("research-skip-attempts")).toBeNull();
  });

  it("过门记录显示为「人工 + 门名 + 通过」", async () => {
    getResearchAudit.mockResolvedValue([
      row({ actorKind: "human", action: "gate:reasoning", outcome: "allowed", refusal: null }),
    ]);
    render(<ResearchAuditTrail threadId={THREAD} />);
    await waitFor(() => {
      const r = screen.getByTestId("research-audit-row");
      expect(r).toHaveTextContent("人工");
      expect(r).toHaveTextContent(C.GATE_LABELS.reasoning);
      expect(r).toHaveTextContent("通过");
    });
  });

  it("一条值得看的记录都没有时整栏不渲染（不留一个空标题）", async () => {
    getResearchAudit.mockResolvedValue([
      row({ actorKind: "agent", action: "advance:collecting", outcome: "allowed", refusal: null }),
    ]);
    render(<ResearchAuditTrail threadId={THREAD} />);
    await waitFor(() => expect(screen.queryByTestId("research-audit-trail")).toBeNull());
  });

  it("读审计失败不炸组件（次要信息的故障不该影响主流程）", async () => {
    getResearchAudit.mockRejectedValue(new Error("boom"));
    render(<ResearchAuditTrail threadId={THREAD} />);
    await waitFor(() => expect(screen.queryByTestId("research-audit-trail")).toBeNull());
  });
});
