import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AidtReportHistory } from "@/features/aidt/components/aidt-report-history";
import { AidtReportPreview } from "@/features/aidt/components/aidt-report-preview";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import type { AidtReportHistoryScope } from "@/features/aidt/lib/aidt-report-history";
import type { AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";
import { ApiError } from "@/lib/api-client";
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ listAidtStageHistory: mocks.list }));
const scope: AidtReportHistoryScope = { projectId: "p", orgId: "org", userId: "student", sessionToken: "token", lifecycleKey: "life" };
function saved(): AidtSharedStage {
  return { projectId: "p", stageId: 6, revision: 2, updatedBy: "student", updatedAt: "2026-11-16T00:00:00Z", sourceStageRevisions: [], content: { schemaVersion: 1, draft: { fields: { understandingEvidence: "<script>学生材料待核对</script>", returnStep: "undecided" }, ideas: [], selectedIdeaId: "" } } };
}
function start() { fireEvent.click(screen.getByText("审阅历史学习并加入报告")); fireEvent.click(screen.getByRole("button", { name: "读取历史学习记录" })); }
beforeEach(() => { mocks.list.mockReset(); mocks.list.mockImplementation(async (_p: string, stage: number) => ({ items: stage === 6 ? [saved()] : [], nextBeforeRevision: null })); });
it("requires review and explicit append, retains the newest manual text, and never saves in the background", async () => {
  const change = vi.fn(), regenerate = vi.fn();
  const props = { drafts: emptyAidtUiDrafts(), text: "学生人工报告", sourceRevision: 1, revision: 1, onChange: change, regenerate, readOnly: false, historyScope: scope };
  const view = render(<AidtReportPreview {...props} />);
  expect(mocks.list).not.toHaveBeenCalled(); start();
  const chapter = await screen.findByTestId("aidt-report-history-chapter");
  expect(change).not.toHaveBeenCalled(); expect(regenerate).not.toHaveBeenCalled();
  expect(chapter).toHaveTextContent("<script>学生材料待核对</script>"); expect(chapter.querySelector("script")).toBeNull();
  expect(screen.getByRole("button", { name: "追加历史章节到当前报告" })).toBeDisabled();
  view.rerender(<AidtReportPreview {...props} text="读取时继续修改后的人工报告" />);
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "追加历史章节到当前报告" }));
  expect(change).toHaveBeenCalledOnce(); expect(change.mock.calls[0]![0]).toMatch(/^读取时继续修改后的人工报告\n\n## 历史学习追溯/);
  expect(screen.getByText(/再主动保存到小组/)).toBeInTheDocument(); expect(screen.queryByTestId("aidt-report-history-chapter")).toBeNull();
});
it("cancels an in-flight request and ignores its late data", async () => {
  let resolve!: (value: unknown) => void; mocks.list.mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  const change = vi.fn(); render(<AidtReportHistory scope={scope} value="人工稿" onChange={change} readOnly={false} />); start();
  const signal = mocks.list.mock.calls[0]![4] as AbortSignal;
  fireEvent.click(screen.getByRole("button", { name: "取消历史读取" })); expect(signal.aborted).toBe(true);
  await act(async () => resolve({ items: [saved()], nextBeforeRevision: null }));
  expect(screen.queryByTestId("aidt-report-history-chapter")).toBeNull(); expect(change).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "读取历史学习记录" })).toBeEnabled();
});
it("ignores a late request across A to B to A scopes and aborts pending reads on unmount", async () => {
  let resolve!: (value: unknown) => void; mocks.list.mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  const change = vi.fn(), view = render(<AidtReportHistory scope={scope} value="人工稿" onChange={change} readOnly={false} />); start();
  const oldSignal = mocks.list.mock.calls[0]![4] as AbortSignal;
  view.rerender(<AidtReportHistory scope={{ ...scope, projectId: "B" }} value="B人工稿" onChange={change} readOnly={false} />);
  expect(oldSignal.aborted).toBe(true);
  view.rerender(<AidtReportHistory scope={scope} value="新A人工稿" onChange={change} readOnly={false} />);
  await act(async () => resolve({ items: [saved()], nextBeforeRevision: null }));
  expect(screen.queryByTestId("aidt-report-history-chapter")).toBeNull(); expect(change).not.toHaveBeenCalled();
  mocks.list.mockReturnValueOnce(new Promise(() => {}));
  start(); const newSignal = mocks.list.mock.calls.at(-1)![4] as AbortSignal;
  view.unmount(); expect(newSignal.aborted).toBe(true);
});
it.each(["projectId", "orgId", "userId", "sessionToken", "lifecycleKey"] as const)("clears reviewed rows synchronously when scope %s changes", async field => {
  const change = vi.fn(), view = render(<AidtReportHistory scope={scope} value="人工稿" onChange={change} readOnly={false} />); start();
  await screen.findByTestId("aidt-report-history-chapter"); fireEvent.click(screen.getByRole("checkbox"));
  view.rerender(<AidtReportHistory scope={{ ...scope, [field]: "different" }} value="人工稿" onChange={change} readOnly={false} />);
  expect(screen.queryByTestId("aidt-report-history-chapter")).toBeNull(); expect(change).not.toHaveBeenCalled();
});
it("aborts on unmount and on read-only downgrade, preserving report content", async () => {
  mocks.list.mockReturnValueOnce(new Promise(() => {}));
  const change = vi.fn(), view = render(<AidtReportHistory scope={scope} value="人工稿" onChange={change} readOnly={false} />); start();
  const signal = mocks.list.mock.calls[0]![4] as AbortSignal;
  view.rerender(<AidtReportHistory scope={scope} value="人工稿" onChange={change} readOnly />); expect(signal.aborted).toBe(true);
  fireEvent.click(screen.getByText("审阅历史学习并加入报告")); fireEvent.click(screen.getByRole("button", { name: "读取历史学习记录" }));
  await screen.findByTestId("aidt-report-history-chapter"); expect(screen.getByRole("checkbox")).toBeDisabled();
  expect(screen.getByRole("button", { name: "追加历史章节到当前报告" })).toBeDisabled();
  view.unmount(); expect(change).not.toHaveBeenCalled();
});
it("clears all rows after access denial, keeps report edits and permits explicit retry", async () => {
  mocks.list.mockResolvedValueOnce({ items: [saved()], nextBeforeRevision: 2 }).mockRejectedValueOnce(new ApiError(403, "FORBIDDEN", {}));
  const change = vi.fn(); render(<AidtReportHistory scope={scope} value="人工稿" onChange={change} readOnly={false} />); start();
  expect(await screen.findByText(/已清除本次读取结果/)).toBeInTheDocument();
  expect(screen.queryByTestId("aidt-report-history-chapter")).toBeNull(); expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "读取历史学习记录" })); await screen.findByTestId("aidt-report-history-chapter");
});
it("does not append beyond the existing report contract length limit", async () => {
  const change = vi.fn(); render(<AidtReportHistory scope={scope} value={"字".repeat(99999)} onChange={change} readOnly={false} />); start();
  await screen.findByTestId("aidt-report-history-chapter"); fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("alert")).toHaveTextContent("超过报告10万字限制");
  expect(screen.getByRole("button", { name: "追加历史章节到当前报告" })).toBeDisabled(); expect(change).not.toHaveBeenCalled();
});
