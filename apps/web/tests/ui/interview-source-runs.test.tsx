import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { interviewTranscriptDisplay } from "@/components/itv/interview-transcript-display";
import { InterviewRunsStep } from "@/components/itv/interview-runs-step";
afterEach(cleanup);
it("keeps report actions above the saved transcript without a second progress hero", () => {
  render(<InterviewRunsStep runs={[]} pending={false} onGenerateReport={vi.fn()} />);
  expect(screen.queryByRole("heading", { name: "开始访谈" })).not.toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "生成报告" }).closest('[data-testid="itv-step-actions"]')).not.toBeNull();
});
it("queued experts are not presented as actively interviewing", () => {
  render(<InterviewRunsStep runs={[{ expertId: "queued-7", displayName: "待访谈专家", status: "pending", completedQuestions: 0, totalQuestions: 1 }]} pending={false} onGenerateReport={vi.fn()} />);
  expect(screen.getByText("等待访谈 · 0/1")).toBeVisible();
  expect(screen.queryByText("进行中 · 0/1")).not.toBeInTheDocument();
});
it("expert cards filter by stable attribution while keeping question links", () => {
  render(<InterviewRunsStep runs={[
    { expertId: "nurse-7", displayName: "护理角色", status: "completed", completedQuestions: 1, totalQuestions: 1 },
    { expertId: "doctor-8", displayName: "医生角色", status: "running", completedQuestions: 0, totalQuestions: 1 },
  ]} document={{ documentId: "runs-2", step: "runs", version: 1, contentHash: "b".repeat(64), evidenceMode: "simulated", references: [], markdown: "# 访谈汇总\n\n## [护理角色](#expert-nurse-7)\n\n交接记录需要复核。[追问](#question-q7)\n\n## [医生角色](#expert-doctor-8)\n\n急诊分诊尚未回答。" }} pending={false} onGenerateReport={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /护理角色/u }));
  expect(screen.getByText(/交接记录需要复核/)).toBeVisible();
  expect(screen.queryByText("急诊分诊尚未回答。")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "追问" })).toHaveAttribute("href", "#question-q7");
  fireEvent.click(screen.getByRole("button", { name: /护理角色/u }));
  expect(screen.getByText("急诊分诊尚未回答。")).toBeVisible();
});
it("left expert cards select the matching summary without requiring the top tabs", () => {
  render(<InterviewRunsStep runs={[
    { expertId: "nurse-7", displayName: "护理角色", status: "completed", completedQuestions: 1, totalQuestions: 1 },
    { expertId: "doctor-8", displayName: "医生角色", status: "completed", completedQuestions: 1, totalQuestions: 1 },
  ]} document={{ documentId: "runs-card-nav", step: "runs", version: 1, contentHash: "e".repeat(64), evidenceMode: "simulated", references: [], markdown: "## [护理角色](#expert-nurse-7)\n\n护理回答。\n\n## [医生角色](#expert-doctor-8)\n\n医生回答。" }} pending={false} onGenerateReport={vi.fn()} />);
  fireEvent.click(screen.getAllByRole("button", { name: /医生角色/u })[0]!);
  expect(screen.getByText("医生回答。")).toBeVisible();
  expect(screen.queryByText("护理回答。")).not.toBeInTheDocument();
});
it("progress uses persisted counters while summary retains Markdown attribution", () => {
  render(<InterviewRunsStep runs={[{ expertId: "nurse-7", displayName: "护理模拟角色", status: "running", completedQuestions: 2, totalQuestions: 4 }]} document={{ documentId: "runs-1", step: "runs", version: 1, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [], markdown: "## 护理模拟角色\n\n> 最近一次交接班遗漏发生在夜班。\n\n来源：[问题七](#question-q7)" }} pending={false} onGenerateReport={vi.fn()} />);
  expect(screen.getByText("已保存回答 2/4")).toBeVisible();
  expect(screen.getByText("最近一次交接班遗漏发生在夜班。")).toBeVisible();
  expect(screen.getByRole("link", { name: "问题七" })).toHaveAttribute("href", "#question-q7");
  expect(screen.getByRole("button", { name: "生成报告" })).toBeDisabled();
});
it("execution task progress counts experts and distinguishes each persisted state", () => {
  render(<InterviewRunsStep runs={[
    { expertId: "finished", displayName: "完成专家", status: "completed", completedQuestions: 1, totalQuestions: 1 },
    { expertId: "active", displayName: "进行专家", status: "running", completedQuestions: 0, totalQuestions: 1 },
    { expertId: "queued", displayName: "排队专家", status: "pending", completedQuestions: 0, totalQuestions: 1 },
    { expertId: "failed", displayName: "失败专家", status: "failed", completedQuestions: 0, totalQuestions: 1 },
  ]} taskProgress pending={false} onGenerateReport={vi.fn()} />);
  expect(screen.getByText(/^已完成专家 1\/4/u)).toBeVisible();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.getByText("进行中 1")).toBeVisible();
  expect(screen.getByText("等待访谈 1")).toBeVisible();
  expect(screen.getByText("执行失败 1")).toBeVisible();
  expect(screen.getByText("已完成 1")).toBeVisible();
  expect(screen.queryByText("已完成 · 1/1")).not.toBeInTheDocument();
});
it("only projects saved Markdown insight sections and preserves source attribution", () => {
  const markdown = "# 模拟访谈摘要\n\n## [采购专家](#expert-purchase)\n\n### 关键观点\n\n- [采购审批至少经过两级](#question-q1)\n\n### 争议点与风险\n\n- 预算否决人身份待核实。\n\n## [技术专家](#expert-tech)\n\n### 核心发现\n\n- 技术评审需要安全确认。";
  render(<InterviewRunsStep runs={[
    { expertId: "purchase", displayName: "采购专家", status: "completed", completedQuestions: 1, totalQuestions: 1 },
    { expertId: "tech", displayName: "技术专家", status: "completed", completedQuestions: 1, totalQuestions: 1 },
  ]} document={{ documentId: "runs-grouped", step: "runs", version: 2, contentHash: "c".repeat(64), evidenceMode: "simulated", references: [], markdown }} pending={false} onGenerateReport={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "关键观点（1）" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "争议点与风险（1）" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "核心发现（1）" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: /后续追问/u })).not.toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "采购审批至少经过两级" })[0]).toHaveAttribute("href", "#question-q1");
  fireEvent.click(screen.getByRole("button", { name: /采购专家/u }));
  expect(screen.getByRole("heading", { name: "关键观点（1）" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "核心发现（1）" })).not.toBeInTheDocument();
});
it("does not mistake a question about risk for an insight heading or invent list entries", () => {
  const markdown = "## [采购专家](#expert-purchase)\n\n### 如何降低采购风险？\n\n这是普通回答。\n\n### 关键观点\n\n暂无明确观点。\n\n### 争议点与风险：\n\n- 否决角色待核实。";
  render(<InterviewRunsStep runs={[{ expertId: "purchase", displayName: "采购专家", status: "completed", completedQuestions: 1, totalQuestions: 1 }]}
    document={{ documentId: "runs-risk", step: "runs", version: 1, contentHash: "d".repeat(64), evidenceMode: "simulated", references: [], markdown }} pending={false} onGenerateReport={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "关键观点（0）" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "争议点与风险（1）" })).toBeVisible();
  expect(screen.getAllByRole("heading", { name: "争议点与风险（1）" })).toHaveLength(1);
  expect(screen.getByText("这是普通回答。")).toBeVisible();
});

it("keeps provider top-level headings inside the attributed expert and repeated segments", () => {
  const markdown = "## [护理角色](#expert-nurse-7)\n\n# 模拟访谈\n\n护理原始回答。\n\n## 关键观点\n\n- 护理交接待核实。\n\n## [医生角色](#expert-doctor-8)\n\n# 医生模拟访谈\n\n医生原始回答。\n\n## 核心发现\n\n- 医生分诊待核实。\n\n## [护理角色](#expert-nurse-7)\n\n## 续答\n\n护理续答。";
  render(<InterviewRunsStep runs={[
    { expertId: "nurse-7", displayName: "护理角色", status: "completed", completedQuestions: 1, totalQuestions: 1 },
    { expertId: "doctor-8", displayName: "医生角色", status: "completed", completedQuestions: 1, totalQuestions: 1 },
  ]} document={{ documentId: "runs-provider-headings", step: "runs", version: 1, contentHash: "f".repeat(64), evidenceMode: "simulated", references: [], markdown }} pending={false} onGenerateReport={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /护理角色/u }));
  expect(screen.getByText("护理原始回答。")).toBeVisible();
  expect(screen.getByText("护理续答。")).toBeVisible();
  expect(screen.queryByText("医生原始回答。")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "关键观点（1）" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "核心发现（1）" })).not.toBeInTheDocument();
});

it("projects compact simulated records without changing the saved source", () => {
  const markdown = "# 模拟访谈记录\n\n以下回答来自模型模拟，需真人验证。\n\n## [护理角色](#expert-persona-nurse)\n\n# 模拟访谈记录\n\n专家 ID：persona-nurse\n\n## 问题\n\n交接如何复核？\n\n## 回答\n\n我们用 persona 方法分类，保留这句实质回答。[来源](#question-q7)\n\n<script>alert('unsafe')</script>";
  const document = { documentId: "compact", step: "runs" as const, version: 1, contentHash: "a".repeat(64), evidenceMode: "simulated" as const, references: [], markdown };
  render(<InterviewRunsStep runs={[{ expertId: "persona-nurse", displayName: "护理角色", status: "completed", completedQuestions: 1, totalQuestions: 1 }]} document={document} pending={false} onGenerateReport={vi.fn()} />);
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "模拟访谈记录" })).not.toBeInTheDocument();
  expect(screen.queryByText("专家 ID：persona-nurse")).not.toBeInTheDocument();
  expect(screen.getByText("模拟访谈 · 需真人验证")).toBeVisible();
  expect(screen.getByText(/我们用 persona 方法分类/u)).toBeVisible();
  expect(screen.getByRole("link", { name: "来源" })).toHaveAttribute("href", "#question-q7");
  expect(screen.getByTestId("itv-source-runs-markdown").querySelector("script")).toBeNull();
  expect(document.markdown).toBe(markdown);
});

it.each(["persona-68ecb1285cee2aeada7537e9", "virtual-095b8b15-8a25-454e-ad94-a83828ed2ef6"])("uses readable expert attribution and hides only technical record headers (%s)", (id) => {
  const markdown = `## [${id}](#expert-${id})\n\n${id.startsWith("virtual-") ? `# 王志远（${id}）访谈记录` : `# 访谈回答：王志远（${id}）`}\n\n身份声明：本内容为基于模拟画像库生成的专家视角推演，需真人验证。\n\n问题：[上线时如何使用 ${id}？](#question-q7)\n\n回答：保留 ${id} 作为回答中的参照。`;
  render(<InterviewRunsStep runs={[{ expertId: id, displayName: "王志远", status: "completed", completedQuestions: 1, totalQuestions: 1 }]} document={{ documentId: "technical", step: "runs", version: 1, contentHash: "c".repeat(64), evidenceMode: "simulated", references: [], markdown }} pending={false} onGenerateReport={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "王志远", level: 2 })).toBeVisible();
  expect(screen.queryByRole("heading", { name: /访谈回答/u })).not.toBeInTheDocument();
  expect(screen.queryByText(/^身份声明：/u)).not.toBeInTheDocument();
  expect(screen.getByText(`回答：保留 ${id} 作为回答中的参照。`)).toBeVisible();
  expect(screen.getByRole("link", { name: `上线时如何使用 ${id}？` })).toHaveAttribute("href", "#question-q7");
});

it("preserves substantive statements and fenced examples in the display projection", () => {
  const markdown = "# 模拟访谈记录\n\n~~~markdown\n# 模拟访谈记录\n专家 ID：persona-example\n~~~\n\n回答：身份声明：本内容为基于模拟画像库生成的专家视角推演，是我们讨论的风险。";
  const display = interviewTranscriptDisplay(markdown, true);
  expect(display).toContain("~~~markdown\n# 模拟访谈记录\n专家 ID：persona-example\n~~~");
  expect(display).toContain("回答：身份声明：");
  expect(interviewTranscriptDisplay("# 模拟访谈记录\n\n以下回答来自模型模拟，需真人验证。", false)).toBe("# 模拟访谈记录\n\n以下回答来自模型模拟，需真人验证。");
});
it.each([
  "> **身份声明**：本内容为基于模拟画像库生成的专家视角推演，需真人验证。",
  "**声明**：以下所有回答均基于提供的模拟研究计划与材料生成的定性推演，需真人验证。",
  "> **身份声明**：本内容为基于模拟画像库生成的专家视角推演，\n> 需真人验证。",
])("only hides formatted boilerplate in leading metadata (%s)", (notice) => {
  const markdown = `## [护理角色](#expert-nurse)\n\n${notice}\n\n### 回答\n\n先保留有意义的回答。\n\n${notice}\n\n## [医生角色](#expert-doctor)\n\n${notice}\n\n### 回答\n\n医生的回答。`;
  const display = interviewTranscriptDisplay(markdown, true);
  expect(display.split(notice)).toHaveLength(2);
  expect(display).toContain(`先保留有意义的回答。\n\n${notice}`);
  expect(display).toContain("医生的回答。");
});

it("preserves substantive expert-suffixed headings and indented metadata examples", () => {
  const markdown = "## [角色](#expert-persona-x)\n\n### 关键发现（persona-x）\n\n    专家 ID：persona-x\n\n\t专家 ID：persona-x\n\n### 访谈回答：角色（persona-x）\n\n### 角色（persona-x）访谈记录";
  const display = interviewTranscriptDisplay(markdown, true);
  expect(display).toContain("### 关键发现（persona-x）");
  expect(display).toContain("    专家 ID：persona-x");
  expect(display).toContain("\t专家 ID：persona-x");
  expect(display).not.toContain("### 访谈回答：角色（persona-x）");
  expect(display).not.toContain("### 角色（persona-x）访谈记录");
});

it("preserves a code fence immediately following a leading notice without a blank line", () => {
  const markdown = "## [角色](#expert-persona-x)\n\n身份声明：本内容为基于模拟画像库生成的专家视角推演\n```md\n## 模拟访谈记录\n代码例子必须保留\n```";
  const display = interviewTranscriptDisplay(markdown, true);
  expect(display).toContain("```md\n## 模拟访谈记录\n代码例子必须保留\n```");
});
