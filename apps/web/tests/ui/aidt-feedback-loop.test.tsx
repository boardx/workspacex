import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AidtStageOutput } from "@/features/aidt/components/aidt-stage-output";
import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";

vi.mock("@/lib/research-report-export", () => ({ printResearchPdf: vi.fn() }));

function Ideas() {
  const [draft, update] = React.useState<AidtUiStageDraft>(() => {
    const initial = emptyAidtUiDrafts()[4]!;
    return { ...initial, ideas: initial.ideas.map((idea, index) => index === 0 ? { ...idea, title: "学生自己的想法", description: "这一段讨论还没有保存。" } : idea) };
  });
  return <AidtStageOutput projectId="feedback-group" step={AIDT_STEPS[3]!} draft={draft} update={update} readOnly={false} toolHref={() => "#"} />;
}

it("preserves an edited idea until students explicitly confirm its removal", () => {
  render(<Ideas />);
  fireEvent.click(screen.getByRole("button", { name: "移除候选 1" }));
  expect(screen.getByLabelText("候选1名称")).toHaveValue("学生自己的想法");
  expect(screen.getByRole("alert")).toHaveTextContent("移除后，本页未保存的内容将丢失");
  fireEvent.click(screen.getByRole("button", { name: "保留候选" }));
  expect(screen.getByLabelText("候选1核心说明")).toHaveValue("这一段讨论还没有保存。");
  fireEvent.click(screen.getByRole("button", { name: "移除候选 1" }));
  fireEvent.click(screen.getByRole("button", { name: "确认移除候选" }));
  expect(screen.queryByDisplayValue("学生自己的想法")).toBeNull();
});

it("removes an untouched empty candidate without an unnecessary confirmation", () => {
  render(<Ideas />);
  fireEvent.click(screen.getByRole("button", { name: "移除候选 3" }));
  expect(screen.getAllByRole("radio")).toHaveLength(2);
  expect(screen.queryByRole("alert")).toBeNull();
});
