/**
 * 材料逐条审核 + 门① —— **真渲染 + 真点击**，只 mock 网络边界。
 *
 * 这份测试盯的是 2026-09-15 team2 那个缺陷的同一形状：一个禁用的按钮不说明自己
 * 为什么禁用，等同于坏掉。tsc 与 lint 对此永远不会有意见，所以只能靠这里。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { researchWorkflow as C } from "@repo/contracts";

const reviewResearchMaterial = vi.fn();
const passResearchGate = vi.fn();

vi.mock("@/lib/live-research-workflow", async () => {
  const actual = await vi.importActual<typeof import("@/lib/live-research-workflow")>(
    "@/lib/live-research-workflow",
  );
  return {
    ...actual,
    reviewResearchMaterial: (...a: unknown[]) => reviewResearchMaterial(...a),
    passResearchGate: (...a: unknown[]) => passResearchGate(...a),
  };
});

const { ResearchMaterialReview } = await import("@/components/agent/research-material-review");

const THREAD = "11111111-1111-4111-8111-111111111111";

function material(over: Partial<{ id: string; verdict: C.MaterialVerdictName; attempts: number; note: string | null }> = {}) {
  return {
    id: over.id ?? "m1",
    source: "paste" as const,
    label: over.id ?? "陈教授访谈转录稿",
    verdict: over.verdict ?? ("pending" as C.MaterialVerdictName),
    note: over.note ?? null,
    attempts: over.attempts ?? 0,
    createdAt: "2026-09-16T00:00:00.000Z",
  };
}

function session(phase: C.ResearchPhaseName, materials: ReturnType<typeof material>[]) {
  return {
    threadId: THREAD,
    phase,
    lineage: { materialBatchId: null, fieldSchemeVersion: 0, logicVersion: 0, publishedGraphVersion: 0 },
    materials,
    verifyDueAt: null,
    updatedAt: "2026-09-16T00:00:00.000Z",
  };
}

beforeEach(() => {
  reviewResearchMaterial.mockReset();
  passResearchGate.mockReset();
});
afterEach(cleanup);

describe("出现时机", () => {
  it.each(C.RESEARCH_PHASES.filter((p) => C.pendingGate(p) !== "materials"))(
    "阶段 %s 时**不渲染**（渲染了就是个必被服务端拒的假按钮）",
    (phase) => {
      render(<ResearchMaterialReview session={session(phase, [material()])} onChange={() => {}} />);
      expect(screen.queryByTestId("research-material-review")).toBeNull();
    },
  );

  it("materials_review 阶段渲染", () => {
    render(<ResearchMaterialReview session={session("materials_review", [material()])} onChange={() => {}} />);
    expect(screen.getByTestId("research-material-review")).toBeInTheDocument();
  });
});

describe("禁用的按钮必须说明原因（team2 教训）", () => {
  it("还有待判定的材料时：按钮禁用 + 说清还剩几条", () => {
    render(
      <ResearchMaterialReview
        session={session("materials_review", [material({ id: "a", verdict: "accepted" }), material({ id: "b" })])}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("research-pass-gate-materials")).toBeDisabled();
    expect(screen.getByTestId("research-gate-disabled-reason")).toHaveTextContent("还有 1 条材料没有判定");
  });

  it("有材料标为缺失/有误时：按钮禁用 + 说清原因", () => {
    render(
      <ResearchMaterialReview
        session={session("materials_review", [material({ id: "a", verdict: "wrong", note: "数字对不上" })])}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("research-pass-gate-materials")).toBeDisabled();
    expect(screen.getByTestId("research-gate-disabled-reason")).toHaveTextContent("缺失或有误");
  });

  it("一条材料都没有时：按钮禁用 + 说清没有材料", () => {
    render(<ResearchMaterialReview session={session("materials_review", [])} onChange={() => {}} />);
    expect(screen.getByTestId("research-gate-disabled-reason")).toHaveTextContent("还没有任何材料");
  });

  it("**凡是禁用就一定有原因**——不存在「灰着但不说话」的状态", () => {
    for (const mats of [[], [material()], [material({ verdict: "missing" })]]) {
      cleanup();
      render(<ResearchMaterialReview session={session("materials_review", mats)} onChange={() => {}} />);
      const btn = screen.getByTestId("research-pass-gate-materials");
      if ((btn as HTMLButtonElement).disabled) {
        expect(screen.queryByTestId("research-gate-disabled-reason")).not.toBeNull();
      }
    }
  });

  it("全部 accepted 时按钮可点，且不再显示禁用原因", () => {
    render(
      <ResearchMaterialReview
        session={session("materials_review", [material({ id: "a", verdict: "accepted" })])}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("research-pass-gate-materials")).toBeEnabled();
    expect(screen.queryByTestId("research-gate-disabled-reason")).toBeNull();
  });
});

describe("逐条判定", () => {
  it("点「有误」真的调用了服务端，并把原因一起送过去", async () => {
    const next = session("materials_review", [material({ verdict: "wrong" })]);
    reviewResearchMaterial.mockResolvedValue(next);
    const onChange = vi.fn();
    render(<ResearchMaterialReview session={session("materials_review", [material()])} onChange={onChange} />);

    fireEvent.change(screen.getByTestId("research-note-input-m1"), { target: { value: "2027 那段缺" } });
    fireEvent.click(screen.getByTestId("research-verdict-m1-wrong"));

    await waitFor(() => expect(reviewResearchMaterial).toHaveBeenCalledWith(THREAD, "m1", "wrong", "2027 那段缺"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(next));
  });

  it("没写原因时提示「Agent 只能猜该补什么」，而不是静静地退回去", () => {
    render(
      <ResearchMaterialReview
        session={session("materials_review", [material({ verdict: "missing", note: null })])}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("research-material-note-m1")).toHaveTextContent("只能猜");
  });

  it("重采次数用尽后，「缺失/有误」不可再点（标了也采不了 = 又一个假按钮）", () => {
    render(
      <ResearchMaterialReview
        session={session("materials_review", [material({ verdict: "missing", attempts: C.MAX_COLLECTION_ATTEMPTS })])}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("research-verdict-m1-missing")).toBeDisabled();
    expect(screen.getByTestId("research-verdict-m1-wrong")).toBeDisabled();
    // 但"通过"仍然可点——否则这条材料就永远卡死，整条研判再也过不了门①
    expect(screen.getByTestId("research-verdict-m1-accepted")).toBeEnabled();
  });
});

describe("服务端拒绝", () => {
  it("过门被拒时显示服务端理由的 what + next 两句，不是一句「操作失败」", async () => {
    const err = Object.assign(new Error("conflict"), { reasonCode: "MATERIALS_UNRESOLVED" });
    Object.setPrototypeOf(err, (await import("@/lib/api-client")).ApiError.prototype);
    passResearchGate.mockRejectedValue(err);

    render(
      <ResearchMaterialReview
        session={session("materials_review", [material({ verdict: "accepted" })])}
        onChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("research-pass-gate-materials"));

    await waitFor(() => {
      const box = screen.getByTestId("research-gate-failure");
      expect(box).toHaveTextContent("还有材料没有逐条判定完");
      // next 那半句才是用户真正需要的
      expect(box).toHaveTextContent("逐条标为通过、缺失或有误");
    });
  });
});
