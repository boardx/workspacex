import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InterviewOutlineStep } from "@/components/itv/interview-outline-step";
import { InterviewRunsStep } from "@/components/itv/interview-runs-step";
import { InterviewWorkbenchHeader, INTERVIEW_WORKBENCH_STEPS } from "@/components/itv/interview-workbench-header";
afterEach(cleanup);
const document = { documentId: "polish", step: "runs" as const, version: 1, contentHash: "a".repeat(64), evidenceMode: "simulated" as const, references: [], markdown: "## [护理专家](#expert-nurse)\n\n回答内容。[来源](#question-q1)" };
it("collapses answers initially and toggles them without changing saved source", () => {
 const { rerender } = render(<InterviewRunsStep runs={[]} document={document} pending={false} onGenerateReport={vi.fn()}/>);
 expect(screen.getByRole("button", {name: "展开答案"})).toHaveAttribute("aria-expanded", "false");
 expect(screen.queryByText("回答内容。")).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button", {name: "展开答案"}));
 expect(screen.getByRole("link", {name: "来源"})).toHaveAttribute("href", "#question-q1");
 rerender(<InterviewRunsStep runs={[]} document={{...document,version:2}} pending={false} onGenerateReport={vi.fn()}/>);
 expect(screen.getByRole("button", {name: "收起答案"})).toHaveAttribute("aria-expanded", "true");
 fireEvent.click(screen.getByRole("button", {name: "收起答案"}));
 expect(screen.queryByRole("link", {name: "来源"})).not.toBeInTheDocument();
 expect(document.markdown).toContain("[来源](#question-q1)");
});
it("shows one generation indicator and no request-to-generate empty message while busy", () => {
 const {container} = render(<InterviewOutlineStep document={{...document,step:"outline",markdown:""}} expertsDocument={{...document,step:"experts"}} pending generating loadingAction="generate" onChange={vi.fn()} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()}/>);
 expect(screen.getAllByRole("status")).toHaveLength(1);
 expect(container.querySelectorAll(".animate-spin")).toHaveLength(1);
 expect(screen.queryByText("尚无专家问题，请先生成访谈问题。")).not.toBeInTheDocument();
 expect(screen.getByRole("button",{name:"生成访谈问题"})).toBeDisabled();
});
it("keeps outline stage indication static during generation", () => {
 const {container} = render(<InterviewWorkbenchHeader name="访谈" tags={[]} steps={INTERVIEW_WORKBENCH_STEPS} activeStep="outline" runningStep="outline" status="draft" version={1} topic={null} onStepChange={vi.fn()} onReturnToList={vi.fn()}/>);
 expect(container.querySelectorAll(".animate-spin")).toHaveLength(0);
 expect(screen.getByTestId("itv-workbench-step-outline")).toHaveAttribute("aria-busy","true");
});

it("selecting an expert opens its saved answer and deselecting restores collapsed records", () => {
 render(<InterviewRunsStep runs={[{expertId:"nurse",displayName:"护理专家",status:"completed",completedQuestions:1,totalQuestions:1}]} document={document} pending={false} onGenerateReport={vi.fn()}/>);
 fireEvent.click(screen.getByRole("button",{name:"护理专家 已完成"}));
 expect(screen.getByRole("button",{name:"收起答案"})).toHaveAttribute("aria-expanded","true");
 expect(screen.getByRole("link",{name:"来源"})).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"护理专家 已完成"}));
 expect(screen.getByRole("button",{name:"展开答案"})).toHaveAttribute("aria-expanded","false");
});
