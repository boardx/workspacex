import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AidtReportPreview } from "@/features/aidt/components/aidt-report-preview";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import type { AidtSharedReportController } from "@/features/aidt/lib/use-aidt-shared-stages";

function controller(overrides: Partial<AidtSharedReportController> = {}): AidtSharedReportController {
  return { available: true, loading: false, saving: false, canSave: true, serverRevision: 4, serverMarkdown: "服务器上一稿", savedAt: "2026-11-15T00:00:00Z", savedBy: "student-a", matchesServer: false, conflict: false, needsBaseReview: false, error: null, loadError: null, save: vi.fn().mockResolvedValue(undefined), reload: vi.fn(), restore: vi.fn(), reviewBase: vi.fn(), ...overrides };
}
function View({ shared, readOnly = false }: { shared: AidtSharedReportController; readOnly?: boolean }) {
  return <AidtReportPreview drafts={emptyAidtUiDrafts()} text="我的人工报告编辑" sourceRevision={1} revision={1} onChange={vi.fn()} regenerate={vi.fn()} readOnly={readOnly} shared={shared} />;
}
it("uses only the controller receipt to show saved state and does not confuse exports with shared save", () => {
  const shared = controller(); const { rerender } = render(<View shared={shared} />);
  expect(screen.getByTestId("aidt-report-save-state")).toHaveTextContent("报告编辑尚未保存");
  fireEvent.click(screen.getByTestId("aidt-report-save")); expect(shared.save).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("aidt-report-save-state")).not.toHaveTextContent("小组报告已保存");
  rerender(<View shared={{ ...shared, matchesServer: true, canSave: false }} />);
  expect(screen.getByTestId("aidt-report-save-state")).toHaveTextContent("小组报告已保存");
  expect(screen.getByTestId("aidt-report-receipt")).toHaveTextContent("服务器版本 4");
});
it("protects report edits through conflict review and requires explicit restore confirmation", () => {
  const shared = controller({ conflict: true, needsBaseReview: true, canSave: false, serverMarkdown: "<script>服务器稿仍是文字</script>" });
  render(<View shared={shared} />);
  expect(screen.getByTestId("aidt-report-save")).toBeDisabled();
  expect(screen.getByLabelText("小组报告草稿")).toHaveValue("我的人工报告编辑");
  fireEvent.click(screen.getByTestId("aidt-report-review-base")); expect(shared.reviewBase).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByTestId("aidt-report-restore")); expect(shared.restore).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "保留当前报告" })); expect(shared.restore).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("aidt-report-restore")); fireEvent.click(screen.getByRole("button", { name: "确认恢复报告" }));
  expect(shared.restore).toHaveBeenCalledOnce();
  expect(screen.getByTestId("aidt-report-conflict").querySelector("script")).toBeNull();
});
it("keeps failures retryable and blocks writes and restore after read-only downgrade", () => {
  const shared = controller({ loadError: "小组报告读取失败" });
  render(<View shared={shared} readOnly />);
  expect(screen.getByTestId("aidt-report-save-error")).toHaveTextContent("当前编辑保留");
  expect(screen.getByTestId("aidt-report-save")).toBeDisabled();
  expect(screen.getByTestId("aidt-report-restore")).toBeDisabled();
  fireEvent.click(screen.getByTestId("aidt-report-reload")); expect(shared.reload).toHaveBeenCalledOnce();
  expect(shared.save).not.toHaveBeenCalled(); expect(shared.restore).not.toHaveBeenCalled();
});
