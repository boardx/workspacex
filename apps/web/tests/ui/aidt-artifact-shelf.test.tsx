import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { AidtArtifactShelf } from "@/features/aidt/components/aidt-artifact-shelf";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import { SharedStage } from "@repo/contracts/aidt-stages";

it("previews the exact saved stages without navigating or reading the current draft", () => {
  const draft = emptyAidtUiDrafts()[1]!;
  draft.fields.initial = "已保存的研究题目";
  const stage = SharedStage.parse({
    projectId: "group", stageId: 1, revision: 4, updatedBy: "student",
    updatedAt: "2026-11-19T00:00:00.000Z", sourceStageRevisions: [],
    content: { schemaVersion: 1, draft },
  });
  render(<AidtArtifactShelf stages={{ 1: stage }} stageId={2} projectId="group" sessionToken={null} phase="ready" />);
  fireEvent.click(screen.getByRole("button", { name: /工作坊主题命题.*V4/ }));
  expect(screen.getByText(/已保存的研究题目/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
  expect(screen.queryByText(/已保存的研究题目/)).toBeNull();
});
