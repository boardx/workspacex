/**
 * 预测比对表 —— 真渲染 + 真点击。
 *
 * 三条最要紧的断言，都关于「复盘会不会退化成自我确认」：
 * ① 当初的预测是只读的（可编辑 ⇒ 会被今天的认知悄悄修饰 ⇒ 必然显得更准）；
 * ② 没兑现必须选根因才能提交（否则读完比对表仍然不知道该改哪里）；
 * ③ 框架性根因要被单独说出来（它是唯一会改变**下一次**研判的信号）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { researchWorkflow as C } from "@repo/contracts";

const fillResearchPrediction = vi.fn();
vi.mock("@/lib/live-research-workflow", async () => {
  const actual = await vi.importActual<typeof import("@/lib/live-research-workflow")>(
    "@/lib/live-research-workflow",
  );
  return { ...actual, fillResearchPrediction: (...a: unknown[]) => fillResearchPrediction(...a) };
});

const { ResearchVerification } = await import("@/components/agent/research-verification");

const THREAD = "11111111-1111-4111-8111-111111111111";

function pred(over: Partial<{
  id: string; statement: string; actual: string | null;
  verdict: C.PredictionVerdictName | null; rootCause: C.RootCauseName | null;
}> = {}) {
  return {
    id: over.id ?? "p1",
    graphVersion: 2,
    statement: over.statement ?? "2027 年国产 EDA 覆盖 3 个环节",
    actual: over.actual ?? null,
    verdict: over.verdict ?? null,
    rootCause: over.rootCause ?? null,
    createdAt: "2026-09-16T00:00:00.000Z",
    filledAt: over.verdict ? "2026-12-16T00:00:00.000Z" : null,
  };
}

beforeEach(() => {
  // ⚠ 给一个默认的 resolved 值，而不是裸 mockReset()。
  // 实测：只 reset 时，某条用例里这个 mock 会在没有实现的情况下被调用，
  // 产生一条谁也没接住的 rejection —— vitest 把它算在**后面**某条用例头上，
  // 于是那条用例的断言明明全过，报告里却是红的（隔离单跑就绿）。
  // 这类"失败归错了人"的现象极难排查，所以这里写明白而不是留一行 mockReset。
  fillResearchPrediction.mockClear();
  fillResearchPrediction.mockResolvedValue([]);
});
afterEach(cleanup);

describe("一条预测都没有时不渲染", () => {
  it("不留一个空表头", () => {
    render(<ResearchVerification threadId={THREAD} predictions={[]} onChange={() => {}} />);
    expect(screen.queryByTestId("research-verification")).toBeNull();
  });
});

describe("当初的预测不可编辑", () => {
  it("预测文本没有对应的输入框——只有「实际」那一侧可填", () => {
    render(<ResearchVerification threadId={THREAD} predictions={[pred()]} onChange={() => {}} />);
    const inputs = screen.getAllByRole("textbox");
    // 只有一个输入框（实际情况），预测是纯文本
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toHaveAttribute("data-testid", "research-actual-p1");
    expect(screen.getByTestId("research-prediction-p1")).toHaveTextContent("2027 年国产 EDA 覆盖 3 个环节");
  });

  it("已回填的条目连输入框都没有（回填过的不给二次修饰的机会）", () => {
    render(
      <ResearchVerification
        threadId={THREAD}
        predictions={[pred({ verdict: "missed", actual: "只覆盖 1 个", rootCause: "framework" })]}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("没兑现必须选根因", () => {
  it("选了「未兑现」但没选根因 ⇒ 提交禁用 + 说明", () => {
    render(<ResearchVerification threadId={THREAD} predictions={[pred()]} onChange={() => {}} />);
    fireEvent.change(screen.getByTestId("research-actual-p1"), { target: { value: "只覆盖 1 个" } });
    fireEvent.click(screen.getByTestId("research-verdict-p1-missed"));

    expect(screen.getByTestId("research-fill-p1")).toBeDisabled();
    expect(screen.getByTestId("research-fill-blocked-p1")).toHaveTextContent("必须选根因");
  });

  it("选了根因后可提交，并把三项一起送给服务端", async () => {
    fillResearchPrediction.mockResolvedValue([]);
    render(<ResearchVerification threadId={THREAD} predictions={[pred()]} onChange={() => {}} />);
    fireEvent.change(screen.getByTestId("research-actual-p1"), { target: { value: "只覆盖 1 个" } });
    fireEvent.click(screen.getByTestId("research-verdict-p1-missed"));
    fireEvent.click(screen.getByTestId("research-root-cause-p1-framework"));

    expect(screen.getByTestId("research-fill-p1")).toBeEnabled();
    fireEvent.click(screen.getByTestId("research-fill-p1"));
    await waitFor(() =>
      expect(fillResearchPrediction).toHaveBeenCalledWith(THREAD, "p1", "只覆盖 1 个", "missed", "framework"),
    );
  });

  it("选「兑现」时不出现根因选择（兑现了还要选根因是制造噪音），且可直接提交", () => {
    render(<ResearchVerification threadId={THREAD} predictions={[pred()]} onChange={() => {}} />);
    fireEvent.change(screen.getByTestId("research-actual-p1"), { target: { value: "如期覆盖 3 个" } });
    fireEvent.click(screen.getByTestId("research-verdict-p1-matched"));

    expect(screen.queryByTestId("research-root-cause-picker-p1")).toBeNull();
    expect(screen.getByTestId("research-fill-p1")).toBeEnabled();
  });

  it("先选未兑现+根因，再改回兑现 ⇒ 根因被清掉（不提交自相矛盾的组合）", async () => {
    fillResearchPrediction.mockResolvedValue([]);
    render(<ResearchVerification threadId={THREAD} predictions={[pred()]} onChange={() => {}} />);
    fireEvent.change(screen.getByTestId("research-actual-p1"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("research-verdict-p1-missed"));
    fireEvent.click(screen.getByTestId("research-root-cause-p1-execution"));
    fireEvent.click(screen.getByTestId("research-verdict-p1-matched"));
    fireEvent.click(screen.getByTestId("research-fill-p1"));

    await waitFor(() => expect(fillResearchPrediction).toHaveBeenCalledWith(THREAD, "p1", "x", "matched", null));
  });

  it("什么都没填时说「先写下实际情况」，不是笼统的「不能提交」", () => {
    render(<ResearchVerification threadId={THREAD} predictions={[pred()]} onChange={() => {}} />);
    expect(screen.getByTestId("research-fill-blocked-p1")).toHaveTextContent("先写下实际情况");
  });
});

describe("框架性信号单独说出来", () => {
  it("有框架性根因时明说「判断逻辑本身需要修订」", () => {
    render(
      <ResearchVerification
        threadId={THREAD}
        predictions={[pred({ verdict: "missed", actual: "x", rootCause: "framework" })]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("research-framework-signal")).toHaveTextContent("判断逻辑本身需要修订");
  });

  it("只有执行性根因时不出现那句（不把一次执行失误说成逻辑要改）", () => {
    render(
      <ResearchVerification
        threadId={THREAD}
        predictions={[pred({ verdict: "partial", actual: "x", rootCause: "execution" })]}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByTestId("research-framework-signal")).toBeNull();
  });
});

describe("汇总", () => {
  it("逐档计数出现在摘要里", () => {
    render(
      <ResearchVerification
        threadId={THREAD}
        predictions={[
          pred({ id: "a", verdict: "matched", actual: "x" }),
          pred({ id: "b", verdict: "missed", actual: "y", rootCause: "framework" }),
          pred({ id: "c" }),
        ]}
        onChange={() => {}}
      />,
    );
    const s = screen.getByTestId("research-verification-summary");
    expect(s).toHaveTextContent("共 3 条");
    expect(s).toHaveTextContent("已回填 2 条");
  });
});

describe("服务端拒绝", () => {
  it("显示 what + next 两句", async () => {
    // 造一个**结构上**带 reasonCode 的错误，而不是 ApiError 实例：
    // explainResearchFailure 现在结构化读它，正是为了跨模块边界也不丢含义。
    fillResearchPrediction.mockRejectedValue(
      Object.assign(new Error("conflict"), { reasonCode: "ROOT_CAUSE_REQUIRED" }),
    );
    render(<ResearchVerification threadId={THREAD} predictions={[pred()]} onChange={() => {}} />);
    fireEvent.change(screen.getByTestId("research-actual-p1"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("research-verdict-p1-matched"));
    fireEvent.click(screen.getByTestId("research-fill-p1"));

    await waitFor(() => {
      const box = screen.getByTestId("research-verification-failure");
      expect(box).toHaveTextContent("必须说清根因");
      expect(box).toHaveTextContent("框架性");
    });
  });
});
