/**
 * 阶段条 —— **真渲染**，断言用户实际看到的字。
 *
 * 不写成"调用 pendingGate 返回 materials"这种对纯函数的断言：那种测试在 team2 上
 * 全绿过，而那个界面的按钮点下去什么都不发生。评分卡 U2/U3 要的是"用户看到了什么"，
 * 所以这里断言的是屏幕上的文本。
 *
 * 穷举全部 12 个阶段，因为阶段条最容易坏的方式不是某一个阶段显示错，
 * 而是**某个阶段被漏掉**——漏掉的那个不会报错，它只是显示成空白。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { researchWorkflow as C } from "@repo/contracts";
import { ResearchPhaseBar } from "@/components/agent/research-phase-bar";

afterEach(cleanup);

function renderBar(phase: C.ResearchPhaseName, over: Partial<{ v: number; due: string | null }> = {}) {
  render(
    <ResearchPhaseBar
      phase={phase}
      publishedGraphVersion={over.v ?? 0}
      verifyDueAt={over.due ?? null}
    />,
  );
}

describe("阶段条", () => {
  it.each([...C.RESEARCH_PHASES])("阶段 %s 都渲染出中文阶段名（没有一个阶段是空白）", (phase) => {
    renderBar(phase);
    expect(screen.getByTestId("research-phase-label")).toHaveTextContent(C.PHASE_LABELS[phase]);
  });

  it.each([...C.RESEARCH_PHASES])("阶段 %s 的「在等谁」与契约的 pendingGate 一致", (phase) => {
    renderBar(phase);
    const gate = C.pendingGate(phase);
    if (gate) {
      // 等人时必须写清等的是**哪一道门**，不能只说"等待确认"
      expect(screen.getByTestId("research-waiting-gate")).toHaveTextContent(C.GATE_LABELS[gate]);
      expect(screen.queryByTestId("research-waiting-none")).toBeNull();
    } else {
      // 不等人时也要明说。空着会让用户以为界面没加载出来——
      // 「没有待办」和「不知道有没有待办」是两回事。
      expect(screen.getByTestId("research-waiting-none")).toBeInTheDocument();
      expect(screen.queryByTestId("research-waiting-gate")).toBeNull();
    }
  });

  it("三道硬门对应的阶段，界面都真的提示了等待", () => {
    for (const gate of C.HARD_GATES) {
      cleanup();
      renderBar(C.GATE_TRANSITIONS[gate].from);
      expect(
        screen.getByTestId("research-waiting-gate"),
        `硬门 ${gate} 的阶段没有提示等待`,
      ).toHaveTextContent(C.GATE_LABELS[gate]);
    }
  });

  it("未发布时不显示版本号（0 不该显示成「第 0 版」）", () => {
    renderBar("collecting", { v: 0 });
    expect(screen.queryByTestId("research-published-version")).toBeNull();
  });

  it("已发布时显示第几版", () => {
    renderBar("graph_published", { v: 3 });
    expect(screen.getByTestId("research-published-version")).toHaveTextContent("第 3 版");
  });

  it("没有到期时间时不显示到期栏（不给一个假日期占位）", () => {
    renderBar("graph_published", { due: null });
    expect(screen.queryByTestId("research-verify-due")).toBeNull();
  });

  it("有到期时间时显示它", () => {
    renderBar("awaiting_verification", { due: "2026-12-16T00:00:00.000Z" });
    expect(screen.getByTestId("research-verify-due")).toHaveTextContent("2026");
  });

  it("步骤高亮随阶段推进：材料阶段在第一步，发布后在第二步，回填在第三步", () => {
    renderBar("materials_review");
    expect(screen.getByTestId("research-step-1")).toHaveAttribute("data-state", "active");
    cleanup();
    renderBar("graph_published");
    expect(screen.getByTestId("research-step-2")).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("research-step-1")).toHaveAttribute("data-state", "done");
    cleanup();
    renderBar("backfilling");
    expect(screen.getByTestId("research-step-3")).toHaveAttribute("data-state", "active");
  });
});
