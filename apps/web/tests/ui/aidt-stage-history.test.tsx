import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AidtStageHistory } from "@/features/aidt/components/aidt-stage-history";
import { ApiError } from "@/lib/api-client";
import type { AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ listAidtStageHistory: mocks.list }));
function saved(revision = 2, projectId = "project", initial = "学生命题"): AidtSharedStage {
  return { projectId, stageId: 1, revision, updatedBy: "student-a", updatedAt: "2026-11-15T00:00:00.000Z", content: { schemaVersion: 1, draft: { fields: { initial }, ideas: [], selectedIdeaId: "" } }, sourceStageRevisions: [] };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => { mocks.list.mockReset(); });
it("shows read-only saved versions, source revisions and escaped student content and paginates", async () => {
  const row = saved(2, "project", "<script>学生原话</script>");
  row.sourceStageRevisions = [{ stageId: 1, revision: 1 }];
  mocks.list.mockResolvedValueOnce({ items: [row], nextBeforeRevision: 2 }).mockResolvedValueOnce({ items: [saved(1)], nextBeforeRevision: null });
  render(<AidtStageHistory projectId="project" stageId={1} sessionToken="token" currentRevision={2} />);
  await screen.findByTestId("aidt-history-content-2");
  expect(screen.getByText(/当前已读取版本/)).toHaveTextContent("共享 V2");
  expect(screen.getByText(/实际保存的前序引用/)).toHaveTextContent("第1步 V1");
  expect(screen.getByTestId("aidt-history-content-2")).toHaveTextContent("<script>学生原话</script>");
  expect(screen.getByTestId("aidt-stage-history").querySelector("script")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: /恢复|替换|保存/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "查看更多历史" }));
  await screen.findByTestId("aidt-history-content-1");
  expect(screen.getAllByTestId("aidt-history-revision")).toHaveLength(2);
  expect(mocks.list.mock.calls[1]!.slice(0, 4)).toEqual(["project", 1, "token", { beforeRevision: 2, limit: 10 }]);
  expect(screen.queryByRole("button", { name: "查看更多历史" })).toBeNull();
});
it("distinguishes failed initial loading from empty and retries without dropping loaded pages", async () => {
  mocks.list.mockRejectedValueOnce(new Error("503")).mockResolvedValueOnce({ items: [saved()], nextBeforeRevision: 2 }).mockRejectedValueOnce(new Error("503")).mockResolvedValueOnce({ items: [saved(1)], nextBeforeRevision: null });
  render(<AidtStageHistory projectId="project" stageId={1} sessionToken="token" />);
  await screen.findByRole("alert");
  expect(screen.queryByTestId("aidt-history-empty")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重试读取历史" }));
  await screen.findByTestId("aidt-history-content-2");
  fireEvent.click(screen.getByRole("button", { name: "查看更多历史" }));
  await screen.findByRole("alert");
  expect(screen.getByTestId("aidt-history-content-2")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重试读取历史" }));
  await screen.findByTestId("aidt-history-content-1");
  expect(screen.getAllByTestId("aidt-history-revision")).toHaveLength(2);
});
it("aborts old scopes immediately and ignores their late responses, including A to B to A", async () => {
  const old = deferred<{ items: AidtSharedStage[]; nextBeforeRevision: null }>();
  mocks.list.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ items: [saved(1, "other", "B的命题")], nextBeforeRevision: null }).mockResolvedValueOnce({ items: [saved(3, "project", "返回后的新命题")], nextBeforeRevision: null });
  const view = render(<AidtStageHistory projectId="project" stageId={1} sessionToken="token" />);
  const oldSignal = mocks.list.mock.calls[0]![4] as AbortSignal;
  view.rerender(<AidtStageHistory projectId="other" stageId={1} sessionToken="token-b" />);
  expect(oldSignal.aborted).toBe(true);
  await screen.findByText(/B的命题/);
  view.rerender(<AidtStageHistory projectId="project" stageId={1} sessionToken="token" />);
  expect(screen.queryByText(/B的命题/)).toBeNull();
  await screen.findByText(/返回后的新命题/);
  await act(async () => old.resolve({ items: [saved(9, "project", "过期的命题")], nextBeforeRevision: null }));
  expect(screen.queryByText(/过期的命题/)).toBeNull();
  expect(screen.getByText(/返回后的新命题/)).toBeInTheDocument();
});
it("reauthorizes on token refresh and refreshes after a new saved revision", async () => {
  mocks.list.mockResolvedValue({ items: [saved()], nextBeforeRevision: null });
  const view = render(<AidtStageHistory projectId="project" stageId={1} sessionToken="token" currentRevision={2} />);
  await screen.findByTestId("aidt-history-content-2");
  const oldSignal = mocks.list.mock.calls[0]![4] as AbortSignal;
  view.rerender(<AidtStageHistory projectId="project" stageId={1} sessionToken="refreshed" currentRevision={2} />);
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  expect(oldSignal.aborted).toBe(true);
  expect(mocks.list.mock.calls[1]![2]).toBe("refreshed");
  view.rerender(<AidtStageHistory projectId="project" stageId={1} sessionToken="refreshed" currentRevision={3} />);
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(3));
});
it("clears displayed history on logout and does not fetch while unauthenticated", async () => {
  mocks.list.mockResolvedValue({ items: [saved()], nextBeforeRevision: null });
  const view = render(<AidtStageHistory projectId="project" stageId={1} sessionToken="token" />);
  await screen.findByTestId("aidt-history-content-2");
  const signal = mocks.list.mock.calls[0]![4] as AbortSignal;
  view.rerender(<AidtStageHistory projectId="project" stageId={1} sessionToken={null} />);
  expect(screen.queryByTestId("aidt-history-content-2")).toBeNull();
  expect(signal.aborted).toBe(true);
  expect(mocks.list).toHaveBeenCalledTimes(1);
  expect(screen.getByText("登录后可查看本组的历史版本。")).toBeInTheDocument();
});
it("renders a confirmed empty response as empty", async () => {
  mocks.list.mockResolvedValue({ items: [], nextBeforeRevision: null });
  render(<AidtStageHistory projectId="project" stageId={1} sessionToken="token" />);
  expect(await screen.findByTestId("aidt-history-empty")).toBeInTheDocument();
});
it("hides loaded history after an authorization rejection and retries from the first page", async () => {
  mocks.list.mockResolvedValueOnce({ items: [saved()], nextBeforeRevision: 2 }).mockRejectedValueOnce(new ApiError(403, "FORBIDDEN", {})).mockResolvedValueOnce({ items: [saved(3)], nextBeforeRevision: null });
  render(<AidtStageHistory projectId="project" stageId={1} sessionToken="token" />);
  await screen.findByTestId("aidt-history-content-2");
  fireEvent.click(screen.getByRole("button", { name: "查看更多历史" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("已隐藏此前记录");
  expect(screen.queryByTestId("aidt-history-content-2")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重试读取历史" }));
  await screen.findByTestId("aidt-history-content-3");
  expect(mocks.list.mock.calls[2]![3]).toEqual({ beforeRevision: undefined, limit: 10 });
});
