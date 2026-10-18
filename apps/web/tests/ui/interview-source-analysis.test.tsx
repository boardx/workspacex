import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InterviewAnalysisStep } from "@/components/itv/interview-analysis-step";
afterEach(cleanup);
it("analysis cards retain canonical source links and Markdown lists", () => {
  render(<InterviewAnalysisStep document={{ documentId: "analysis-1", step: "analysis", version: 1, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [], markdown: "# 分析\n\n## 研究范围\n\n- 依据[需求来源](#source-intake)核对夜班场景。\n\n## AI 建议\n\n- 继续询问[交接问题](#question-q7)。" }} pending={false} onGenerate={vi.fn()} onConfirm={vi.fn()} />);
  expect(screen.getByRole("link", { name: "需求来源" })).toHaveAttribute("href", "#source-intake");
  expect(screen.getByRole("link", { name: "交接问题" })).toHaveAttribute("href", "#question-q7");
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
});
it('shows nested saved recommendations and gives legacy analysis an explicit regenerate action',()=>{
 const onGenerate=vi.fn();
 const view=render(<InterviewAnalysisStep document={{documentId:'analysis-nested',step:'analysis',version:1,contentHash:'a'.repeat(64),evidenceMode:'simulated',references:[],markdown:'# 研究分析\n\n## 研究建议\n\n### 招募分组\n按主动晚睡与轮班分别访谈。\n\n## 待验证假设\n比较工作约束与睡眠时长的关系。\n\n## 适用边界\n模拟研究不能作为医学因果证据。'}} pending={false} onGenerate={onGenerate} onConfirm={vi.fn()}/>);
 expect(screen.getByText('按主动晚睡与轮班分别访谈。')).toBeVisible();expect(screen.queryByText('当前文档未单列建议。请补充审阅，不自动生成通用建议。')).not.toBeInTheDocument();
 view.rerender(<InterviewAnalysisStep document={{documentId:'old',step:'analysis',version:1,contentHash:'a'.repeat(64),evidenceMode:'simulated',references:[],markdown:'# 每天晚睡的弊端\n\n仅有主题科普，未形成研究设计。'}} pending={false} onGenerate={onGenerate} onConfirm={vi.fn()}/>);
 expect(screen.getByText(/缺少.*研究建议/)).toBeVisible();
});
