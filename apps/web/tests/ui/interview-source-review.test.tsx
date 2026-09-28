import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InterviewSourceReportReview } from "@/components/itv/interview-source-report-review";
import type { InterviewMarkdownEnvelope } from "@/lib/interview-markdown-api";
const { submit, load } = vi.hoisted(() => ({ submit: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/interview-markdown-api", () => ({ reviewInterviewMarkdownReport: submit, loadInterviewMarkdown: load }));
const source: InterviewMarkdownEnvelope = { interviewId: "itv-review", revisionId: "rev-review", version: 3, execution: null, review: null,
  states: [], documents: [{ documentId: "doc-review", step: "report", version: 2, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [], markdown: "# 原报告\r\n\r\n原文。" }] };
beforeEach(() => { submit.mockReset(); load.mockReset(); submit.mockResolvedValue({}); load.mockResolvedValue(source); });
afterEach(cleanup);
it("requests changes against exact current document identity without sending or changing body", async () => {
  const saved = vi.fn();
  render(<InterviewSourceReportReview source={source} onSaved={saved} />);
  expect(screen.getByRole("button", { name: "批准报告" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "复核备注" }), { target: { value: "补充真人证据" } });
  fireEvent.click(screen.getByRole("button", { name: "要求修改" }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith(source));
  expect(submit).toHaveBeenCalledWith("itv-review", { expectedVersion: 3, requestId: expect.any(String), revisionId: "rev-review", documentId: "doc-review", documentVersion: 2, contentHash: "a".repeat(64), status: "changes_requested", note: "补充真人证据" });
  expect(source.documents[0]?.markdown).toBe("# 原报告\r\n\r\n原文。");
});
it("failed review preserves note and reports failure without pretending approved", async () => {
  submit.mockRejectedValue(new Error("stale"));
  render(<InterviewSourceReportReview source={source} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "保留备注" } });
  fireEvent.click(screen.getByRole("button", { name: "要求修改" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("原报告保留");
  expect(screen.getByRole("textbox")).toHaveValue("保留备注");
  expect(load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "重新载入复核版本（保留备注）" }));
  await waitFor(() => expect(load).toHaveBeenCalledWith("itv-review"));
  expect(screen.getByRole("textbox")).toHaveValue("保留备注");
});
