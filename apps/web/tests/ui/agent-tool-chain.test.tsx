import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  AgentToolChain,
  deriveThinkingSeconds,
  toolChainSummaryText,
} from "@/components/chat/agent-tool-chain";
import { toolChainSteps } from "@/lib/mock/agent-tool-chain";
import type { AgentRunView } from "@/lib/agent-run";

type Step = AgentRunView["steps"][number];

/**
 * TOOLCHAIN-01（人类 2026-08-13 裁决方案 A：默认收起 + 一行摘要）活体折叠式工具调用链。
 * 这里钉住三件事，任一被后人改回旧行为都会红：
 *  1. 摘要文案的分支（有/无耗时、有/无工具）；
 *  2. **默认收起** —— step 细节在点开前不在 DOM（P7「默认可见」被反转的机械证据）；
 *  3. 失败在**收起态**就以红徽标显性（默认收起不违背「出错看得见」）。
 */

// 造一个 `startedAt`/`endedAt` 无法解析的 step，验证耗时缺失时摘要退化。
function undatedToolStep(): Step {
  return {
    kind: "tool_call",
    status: "succeeded",
    startedAt: "not-a-date",
    endedAt: "not-a-date",
    inputDigest: null,
    outputDigest: null,
    failureCode: null,
    toolName: "list_org_skills",
    toolArgsSummary: "{}",
    toolResultSummary: "ok",
    planningNote: null,
  };
}

describe("toolChainSummaryText / deriveThinkingSeconds", () => {
  it("有耗时 + 有工具：思考了 X 秒 · 调用了 N 个工具", () => {
    const steps = toolChainSteps("collapsed"); // 三工具成功链，时间可解析
    expect(deriveThinkingSeconds(steps)).not.toBeNull();
    // UI 评分 2026-08-23 第 3 项：收起态必须带首个工具名+参数片段（默认视图不再黑盒）
    // D6：折叠头新增「· N 步」计数（`steps.length`，含非工具调用步骤），插在秒数之后、
    // 工具摘要之前——`^` 起点仍是"思考了…"，只是中间多了一截。
    expect(toolChainSummaryText(steps)).toMatch(/^思考了 [\d.]+ 秒 · \d+ 步 · 调用了 \S+.* 等 3 个工具$/);
  });

  it("耗时无法解析：退化为不带秒的摘要，但仍带步骤数（steps.length 真实可得，不随秒数一起退化）", () => {
    const steps = [undatedToolStep()];
    expect(deriveThinkingSeconds(steps)).toBeNull();
    expect(toolChainSummaryText(steps)).toMatch(/^1 步 · 调用了 \S+/);
  });

  /**
   * 2026-08-19 人类实测反馈（#1589）：`思考了 0 秒` 读起来自相矛盾（"0 秒"却"调用了
   * 3 个工具"，像埋点坏了）。`startedAt === endedAt` 这类边界会算出恰好 0.0 秒——
   * 这条钉住修复：0 与"无法解析"同等退化成不带秒的文案，不印出会被读成"没思考"的数字。
   */
  it("耗时恰好 0 秒（startedAt===endedAt）：同样退化为不带秒，不印「思考了 0 秒」", () => {
    const zeroStep: Step = {
      ...undatedToolStep(),
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(deriveThinkingSeconds([zeroStep])).toBe(0);
    expect(toolChainSummaryText([zeroStep])).toMatch(/^1 步 · 调用了 \S+/);
    expect(toolChainSummaryText([zeroStep])).not.toContain("0 秒");
  });

  it("有 step 但零工具调用：说「模型直接作答」，不说「调用了 0 个工具」", () => {
    const steps = toolChainSteps("no-tools");
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => s.kind !== "tool_call")).toBe(true);
    expect(toolChainSummaryText(steps)).toContain("模型直接作答");
  });

  /**
   * D6（chat-main-fidelity-rubric.md）—— 折叠头补「· N 步」计数。`steps.length`
   * 是全部步骤（含非工具调用的规划步骤），不是 `toolSteps.length` 的重复表达。
   */
  it("D6：摘要带真实步骤总数（steps.length），不是工具调用数的重复", () => {
    const steps = toolChainSteps("collapsed");
    expect(toolChainSummaryText(steps)).toContain(`${steps.length} 步`);
  });
});

describe("AgentToolChain 渲染", () => {
  it("零 step：整体不渲染（是没发生，不是黑盒）", () => {
    const { container } = render(<AgentToolChain steps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("默认收起：摘要在场，但逐条 step 细节点开前不在 DOM", () => {
    render(<AgentToolChain steps={toolChainSteps("collapsed")} />);
    expect(screen.getByTestId("agent-tool-chain-summary")).toHaveTextContent(/调用了 \S+.* 等 3 个工具/);
    // 收起态：细节区与 step 行都不在 DOM —— 这正是方案 A 反转 P7「默认可见」的证据。
    expect(screen.queryByTestId("agent-tool-chain-detail")).toBeNull();
    expect(screen.queryByTestId("agent-tool-chain-step-0")).toBeNull();

    fireEvent.click(screen.getByTestId("agent-tool-chain-toggle"));
    expect(screen.getByTestId("agent-tool-chain-step-0")).toHaveAttribute("data-tool-name", "list_org_skills");
  });

  it("失败在收起态就显性：红徽标可见，无需点开", () => {
    render(<AgentToolChain steps={toolChainSteps("failure")} />);
    // 未点开就断言：失败徽标已在场，step 细节仍收起。
    expect(screen.queryByTestId("agent-tool-chain-detail")).toBeNull();
    expect(screen.getByTestId("agent-tool-chain-fail-badge")).toHaveTextContent("失败");
    expect(screen.queryByTestId("agent-tool-chain-ok")).toBeNull();
  });

  it("全绿收起态：显示成功图标而非失败徽标", () => {
    render(<AgentToolChain steps={toolChainSteps("collapsed")} />);
    expect(screen.getByTestId("agent-tool-chain-ok")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-tool-chain-fail-badge")).toBeNull();
  });

  /** D6（chat-main-fidelity-rubric.md）—— 展开体顶部「工具调用 · N」块头。 */
  it("D6：展开态顶部有「工具调用 · N」块头，N 与折叠态收起头的工具计数一致", () => {
    const steps = toolChainSteps("collapsed");
    const toolCount = steps.filter((s) => s.kind === "tool_call").length;
    render(<AgentToolChain steps={steps} />);
    fireEvent.click(screen.getByTestId("agent-tool-chain-toggle"));
    expect(screen.getByTestId("agent-tool-chain-count-header")).toHaveTextContent(`工具调用 · ${toolCount}`);
  });

  it("D6：零工具调用时不渲染「工具调用 · N」块头（避免印一个「· 0」）", () => {
    render(<AgentToolChain steps={toolChainSteps("no-tools")} />);
    fireEvent.click(screen.getByTestId("agent-tool-chain-toggle"));
    expect(screen.queryByTestId("agent-tool-chain-count-header")).toBeNull();
  });
});

/** #742 Gap 1 —— 工具调用进行中态：折叠头与展开态都要能看到「还没落终态」。 */
describe("AgentToolChain 进行中态（#742 Gap 1）", () => {
  it("收起态就有「进行中」徽标——不用点开就知道还有调用没完成", () => {
    render(<AgentToolChain steps={toolChainSteps("in-progress-per-tool")} />);
    expect(screen.getByTestId("agent-tool-chain-in-progress-badge")).toHaveTextContent("进行中");
    expect(screen.queryByTestId("agent-tool-chain-fail-badge")).toBeNull();
    expect(screen.queryByTestId("agent-tool-chain-ok")).toBeNull();
  });

  it("展开态：in_progress 的那一步显示脉动图标 + 「正在调用」文案，且没有结果文本", () => {
    render(<AgentToolChain steps={toolChainSteps("in-progress-per-tool")} defaultOpen />);
    const lookupStep = screen.getByTestId("agent-tool-chain-step-3");
    expect(lookupStep).toHaveAttribute("data-tool-status", "in_progress");
    expect(lookupStep).toHaveTextContent("正在调用 lookup_time");
    expect(screen.getByTestId("agent-tool-chain-in-progress-3")).toHaveTextContent("正在调用…结果尚未返回");
    // 进行中态没有专属卡片（还没有结果可渲染），所以 lookup_time 的展示型卡片不应出现。
    expect(screen.queryByTestId("agent-tool-chain-lookup-time-card")).toBeNull();
  });
});

/** #742 Gap 4 —— per-tool 定制渲染：至少 write_todos / search_documents / read_document /
 * lookup_time 四个工具各有贴合数据形状的展开态卡片，不是「参数 JSON + 结果 JSON」文本。 */
describe("AgentToolChain per-tool 定制卡片（#742 Gap 4）", () => {
  it("write_todos：渲成计划条目列表，不是原始 JSON", () => {
    render(<AgentToolChain steps={toolChainSteps("in-progress-per-tool")} defaultOpen />);
    const list = screen.getByTestId("agent-tool-chain-write-todos-list");
    expect(list).toHaveTextContent("搜索相关文档");
    expect(list).toHaveTextContent("综合结论作答");
    expect(list).toHaveTextContent("进行中");
  });

  it("search_documents：结果渲成文档条目列表", () => {
    render(<AgentToolChain steps={toolChainSteps("in-progress-per-tool")} defaultOpen />);
    const card = screen.getByTestId("agent-tool-chain-search-documents-card");
    expect(card).toHaveTextContent("A.md");
    expect(card).toHaveTextContent("B.md");
    expect(card).toHaveTextContent("C.md");
  });

  it("read_document：文件名与正文预览分开展示", () => {
    render(<AgentToolChain steps={toolChainSteps("in-progress-per-tool")} defaultOpen />);
    const card = screen.getByTestId("agent-tool-chain-read-document-card");
    expect(card).toHaveTextContent("A.md");
    expect(card).toHaveTextContent("多步执行取证样例正文");
  });
});
