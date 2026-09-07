import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ChildCancellationNotice, latestCancelledRun } from "@/components/chat/workbench/child-cancellation-notice";
it("renders child uncertainty as status and removes it when confirmed", () => {
  const view = render(<ChildCancellationNotice text="父任务已停止，子任务仍待停止确认。" />);
  expect(screen.getByRole("status")).toHaveTextContent("子任务仍待停止确认");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  view.rerender(<ChildCancellationNotice text={null} />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
it("selects only cancelled runs from this task's journal, never the previous task", () => {
  const event = (runId: string, emittedAt: string, status: "cancelled" | "running") => ({ runId, seq: 1, emittedAt, kind: "status" as const, status });
  expect(latestCancelledRun({ old: [event("old", "2026-09-07T01:00:00Z", "cancelled")], newer: [event("newer", "2026-09-07T02:00:00Z", "cancelled")], active: [event("active", "2026-09-07T03:00:00Z", "running")] })).toBe("newer");
  expect(latestCancelledRun({})).toBeNull();
});
