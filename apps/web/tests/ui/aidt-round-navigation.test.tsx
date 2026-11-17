import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AidtRoundNavigation } from "@/features/aidt/components/aidt-round-navigation";
import { AidtNextRound } from "@/features/aidt/components/aidt-next-round";
import type { AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";
const mocks = vi.hoisted(() => ({ history: vi.fn() }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ listAidtStageHistory: mocks.history }));
const draft = { fields: { questionSnapshot: JSON.stringify({ schemaVersion: 1, question: "如何理解？", beforeTestBelief: "未知", verificationBasis: "", verificationLimits: "静态理解", prototypeRef: "纸面V1", sourceStageRevision: 1 }), understandingChangeStatus: "insufficient", unresolvedQuestions: "缺少情境", returnStep: "2", returnReason: "补访不同情境", nextAction: "访谈赶课者", reflectionConfirmed: "true" }, ideas: [], selectedIdeaId: "" };
const saved: AidtSharedStage = { projectId: "g", stageId: 6, revision: 3, updatedBy: "editor", updatedAt: "2026-11-15T00:00:00Z", sourceStageRevisions: [{ stageId: 5, revision: 1 }], content: { schemaVersion: 1, draft } };
beforeEach(() => { mocks.history.mockReset(); });
it("carries saved reflection when returning to step2, never requests a new prototype", () => {
  const view = render(<AidtRoundNavigation projectId="g" stageNumber={6} draft={draft} savedRound={saved} matchesServer={false} returnRevision={null} />);
  expect(screen.queryByRole("link")).toBeNull();
  view.rerender(<AidtRoundNavigation projectId="g" stageNumber={6} draft={draft} savedRound={saved} matchesServer returnRevision={null} />);
  expect(screen.getByRole("link")).toHaveAttribute("href", "/aidt/g?step=2&tool=outcome&returnRevision=3");
  view.rerender(<AidtRoundNavigation projectId="g" stageNumber={2} draft={{ fields: {}, ideas: [], selectedIdeaId: "" }} savedRound={saved} matchesServer={false} returnRevision="3" />);
  expect(screen.getByTestId("aidt-return-context")).toHaveTextContent("访谈赶课者");
  expect(mocks.history).not.toHaveBeenCalled();
});
it("requires saved matching record and explicit confirmation before starting another round", () => {
  const start = vi.fn(); const view = render(<AidtNextRound draft={draft} savedRevision={3} matchesServer={false} readOnly={false} onStart={start} />);
  expect(screen.getByRole("button")).toBeDisabled();
  view.rerender(<AidtNextRound draft={draft} savedRevision={3} matchesServer readOnly={false} onStart={start} />);
  fireEvent.click(screen.getByRole("button", { name: "开始下一轮测试草稿" })); expect(start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认开始下一轮草稿" })); expect(start).toHaveBeenCalledOnce();
  view.rerender(<AidtNextRound draft={draft} savedRevision={3} matchesServer readOnly onStart={start} />);
  fireEvent.click(screen.getByRole("button")); expect(start).toHaveBeenCalledOnce();
});
it("reads the exact older revision after the sixth-step head advances and retries errors", async () => {
  const historical = { ...saved, revision: 2 };
  mocks.history.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ items: [historical], nextBeforeRevision: null });
  render(<AidtRoundNavigation projectId="g" stageNumber={2} draft={draft} savedRound={saved} matchesServer={false} returnRevision="2" sessionToken="captured-token" />);
  expect(screen.getByRole("status")).toHaveTextContent("正在读取第6步共享 V2");
  expect(await screen.findByRole("alert")).toHaveTextContent("尚未带入上下文");
  expect(screen.queryByTestId("aidt-return-context")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重试读取本轮学习" }));
  expect(await screen.findByTestId("aidt-return-context")).toHaveTextContent("第6步共享 V2");
  expect(mocks.history.mock.calls[1]!.slice(0, 4)).toEqual(["g", 6, "captured-token", { beforeRevision: 3, limit: 1 }]);
});
it.each([
  { ...saved, revision: 1 },
  { ...saved, revision: 2, projectId: "other" },
  { ...saved, revision: 2, stageId: 5 },
  { ...saved, revision: 2, content: { ...saved.content, draft: { ...draft, fields: { ...draft.fields, returnStep: "1" } } } },
])("does not claim inherited context from a wrong revision, scope or return decision", async (row) => {
  mocks.history.mockResolvedValue({ items: [row], nextBeforeRevision: null });
  render(<AidtRoundNavigation projectId="g" stageNumber={2} draft={draft} savedRound={saved} matchesServer={false} returnRevision="2" sessionToken="token" />);
  await screen.findByRole("alert");
  expect(screen.queryByTestId("aidt-return-context")).toBeNull();
  expect(screen.getByRole("link")).toHaveAttribute("href", "/aidt/g?step=6&tool=outcome");
});
it("aborts and isolates late historical responses across project and token ABA", async () => {
  let resolve!: (page: { items: AidtSharedStage[]; nextBeforeRevision: null }) => void;
  const old = new Promise<{ items: AidtSharedStage[]; nextBeforeRevision: null }>((yes) => { resolve = yes; });
  const row = (text: string, projectId = "g"): AidtSharedStage => ({ ...saved, projectId, revision: 2, content: { ...saved.content, draft: { ...draft, fields: { ...draft.fields, nextAction: text } } } });
  mocks.history.mockReturnValueOnce(old).mockResolvedValueOnce({ items: [row("B的行动", "b")], nextBeforeRevision: null }).mockResolvedValueOnce({ items: [row("返回后的新行动")], nextBeforeRevision: null });
  const view = render(<AidtRoundNavigation projectId="g" stageNumber={2} draft={draft} matchesServer={false} returnRevision="2" sessionToken="token-a" />);
  const signal = mocks.history.mock.calls[0]![4] as AbortSignal;
  view.rerender(<AidtRoundNavigation projectId="b" stageNumber={2} draft={draft} matchesServer={false} returnRevision="2" sessionToken="token-b" />);
  expect(signal.aborted).toBe(true);
  expect(await screen.findByTestId("aidt-return-context")).toHaveTextContent("B的行动");
  view.rerender(<AidtRoundNavigation projectId="g" stageNumber={2} draft={draft} matchesServer={false} returnRevision="2" sessionToken="token-a" />);
  expect(screen.queryByText(/B的行动/)).toBeNull();
  expect(await screen.findByTestId("aidt-return-context")).toHaveTextContent("返回后的新行动");
  await act(async () => resolve({ items: [row("过期行动")], nextBeforeRevision: null }));
  expect(screen.getByTestId("aidt-return-context")).not.toHaveTextContent("过期行动");
});
it("offers a history-verification link without claiming inherited context when login is missing or the revision is invalid", () => {
  const view = render(<AidtRoundNavigation projectId="g" stageNumber={2} draft={draft} matchesServer={false} returnRevision="2" />);
  expect(screen.getByRole("alert")).toHaveTextContent("登录后才能读取");
  expect(screen.queryByTestId("aidt-return-context")).toBeNull();
  view.rerender(<AidtRoundNavigation projectId="g" stageNumber={2} draft={draft} matchesServer={false} returnRevision="fake" sessionToken="token" />);
  expect(screen.getByRole("alert")).toHaveTextContent("版本号无效");
  expect(mocks.history).not.toHaveBeenCalled();
});
