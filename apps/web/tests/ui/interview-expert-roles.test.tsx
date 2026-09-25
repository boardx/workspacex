import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PersistentDigitalInterviewWorkflow } from "@/components/itv/digital-interview-workflow";
import { MOCK_DIGITAL_EXPERTS, toDigitalExpertCatalogRow } from "@/lib/mock/digital-expert-personas";
import type { DigitalInterviewWorkflowView } from "@/lib/interview-api";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const expert = { ...toDigitalExpertCatalogRow(MOCK_DIGITAL_EXPERTS[0]!), expertId: "generated-1", displayName: "陈明远", role: "AI 教育成效评估专家", bio: "擅长学习效果测量与教学实验设计，评估 AI 对学习成果和教育公平的影响。", materialBoundary: "未绑定 Context Pack 材料版本" };
const view: DigitalInterviewWorkflowView = {
  interviewId: "itv-roles", name: "AI 教育", tags: [], topic: "AI 教育成效",
  status: "experts_pending", sourceQuickInterviewId: null, selectedExpertIds: [expert.expertId, "static-1"],
  reportId: null, version: 4, scope: { kind: "none", projectId: null, researchProjectId: null },
  currentStep: "experts", revisionId: "r1", topicVersionId: "t1", expertSnapshotVersionId: null, questionVersionId: null,
  expertCandidates: [expert, { ...expert, expertId: "static-1", role: "教育数据治理专家", bio: "擅长学生数据隐私与算法公平性审查。" }],
  questions: [], questionCandidates: [], skillThreadId: "s1", skillMessages: [], skillProposals: [], expertRuns: [],
  studyEvidenceMode: "simulated", reportReview: { eligibility: "blocked_missing_participant_evidence", message: "需要真实受访者证据后才能批准。", action: "添加并复核真实受访者回答" },
};
describe("访谈专家角色卡片", () => {
  it("distinguishes controls when two experts share the same role", () => {
    render(<PersistentDigitalInterviewWorkflow initialView={{ ...view, expertCandidates: [expert, { ...expert, expertId: "static-1", bio: "擅长课堂数据分析。" }] }} />);
    fireEvent.click(screen.getByRole("button", { name: "查看专家详情 AI 教育成效评估专家（第 2 位）" }));
    expect(screen.getByTestId("itv-expert-detail-bio")).toHaveTextContent("擅长课堂数据分析。");
    fireEvent.click(screen.getByTestId("itv-expert-detail-close"));
    fireEvent.click(screen.getByRole("button", { name: "删除专家 AI 教育成效评估专家（第 2 位）" }));
    const cards = within(screen.getByTestId("itv-expert-step")).getAllByRole("article");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent(expert.bio);
  });

  it("shows professional roles and descriptions instead of personal names and technical status", () => {
    render(<PersistentDigitalInterviewWorkflow initialView={view} />);
    const cards = within(screen.getByTestId("itv-expert-step")).getAllByRole("article");
    expect(cards[0]?.querySelector("strong")).toHaveTextContent("AI 教育成效评估专家");
    expect(cards[0]).toHaveTextContent("擅长学习效果测量与教学实验设计");
    expect(cards[0]).not.toHaveTextContent("陈明远");
    expect(cards[0]).not.toHaveTextContent("Context Pack");
    expect(cards[1]).toHaveTextContent("教育数据治理专家");
  });
  it("keeps details available and deletes the selected role without removing another expert", () => {
    render(<PersistentDigitalInterviewWorkflow initialView={view} />);
    fireEvent.click(screen.getByRole("button", { name: "查看专家详情 AI 教育成效评估专家" }));
    expect(screen.getByTestId("itv-expert-detail-bio")).toHaveTextContent(expert.bio);
    expect(screen.getByTestId("itv-expert-detail-boundary")).toHaveTextContent("Context Pack");
    fireEvent.click(screen.getByTestId("itv-expert-detail-close"));
    fireEvent.click(screen.getByRole("button", { name: "删除专家 AI 教育成效评估专家" }));
    const cards = within(screen.getByTestId("itv-expert-step")).getAllByRole("article");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent("教育数据治理专家");
    expect(screen.getByRole("button", { name: "删除专家 教育数据治理专家" })).toBeDisabled();
  });
});
