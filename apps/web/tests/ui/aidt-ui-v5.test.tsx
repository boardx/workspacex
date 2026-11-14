import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AidtReportPreview } from "@/features/aidt/components/aidt-report-preview";
import { AidtAssistantPanel } from "@/features/aidt/components/aidt-assistant-panel";
import { aidtIdeaReadiness } from "@/features/aidt/lib/aidt-idea-readiness";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";

it("requires three complete, distinct named concepts instead of three layouts or empty candidates", () => {
  const ideas = ["试饮", "口味卡", "同伴墙"].map((title, index) => ({ id: String(index), title, description: "先体验。再选择。", image: "data:image/png;base64,test" }));
  expect(aidtIdeaReadiness(ideas).ready).toBe(true);
  expect(aidtIdeaReadiness(ideas.slice(0, 2)).ready).toBe(false);
  expect(aidtIdeaReadiness([...ideas.slice(0, 2), { ...ideas[2]!, title: " 试 饮 " }]).ready).toBe(false);
  expect(aidtIdeaReadiness([...ideas.slice(0, 2), { ...ideas[2]!, image: undefined }]).ready).toBe(false);
});
it("keeps an edited report until students explicitly confirm replacement", () => {
  const regenerate = vi.fn();
  render(<AidtReportPreview drafts={emptyAidtUiDrafts()} text="学生自己的报告" sourceRevision={1} revision={2} onChange={vi.fn()} regenerate={regenerate} readOnly={false} />);
  fireEvent.click(screen.getByRole("button", { name: "从成果重新整理" }));
  expect(regenerate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "保留当前报告" }));
  expect(screen.getByLabelText("小组报告草稿")).toHaveValue("学生自己的报告");
  fireEvent.click(screen.getByRole("button", { name: "从成果重新整理" }));
  fireEvent.click(screen.getByRole("button", { name: "确认替换" }));
  expect(regenerate).toHaveBeenCalledTimes(1);
});
it("keeps the existing chat mounted when its auxiliary panel is closed", () => {
  const close = vi.fn();
  const { rerender } = render(<AidtAssistantPanel open fullPage={false} onClose={close}><textarea aria-label="existing composer" defaultValue="未发送草稿" /></AidtAssistantPanel>);
  fireEvent.keyDown(document, { key: "Escape" }); expect(close).toHaveBeenCalledOnce();
  rerender(<AidtAssistantPanel open={false} fullPage={false} onClose={close}><textarea aria-label="existing composer" defaultValue="未发送草稿" /></AidtAssistantPanel>);
  expect(screen.getByLabelText("existing composer")).toHaveValue("未发送草稿");
  expect(screen.getByTestId("aidt-assistant-panel")).not.toBeVisible();
});

import { AidtStageOutput } from "@/features/aidt/components/aidt-stage-output";
import { AIDT_STEPS } from "@/lib/project-aidt";
it("restores each candidate's rationale after changing the proposed selection", () => {
  function Stage() {
    const [draft, update] = React.useState<AidtUiStageDraft>(() => ({ ...emptyAidtUiDrafts()[4]!, selectedIdeaId: "draft-1", fields: { reason: "A 的选择理由" } }));
    return <AidtStageOutput projectId="group" step={AIDT_STEPS[3]!} draft={draft} update={update} readOnly={false} toolHref={() => "#"} />;
  }
  render(<Stage />);
  fireEvent.click(screen.getByLabelText("拟选择候选 2（不是投票）"));
  expect(screen.getByLabelText("选择理由与不同意见")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("选择理由与不同意见"), { target: { value: "B 的选择理由" } });
  fireEvent.click(screen.getByLabelText("拟选择候选 1（不是投票）"));
  expect(screen.getByLabelText("选择理由与不同意见")).toHaveValue("A 的选择理由");
  expect(screen.getByText(/B 的选择理由/)).toBeInTheDocument();
});
