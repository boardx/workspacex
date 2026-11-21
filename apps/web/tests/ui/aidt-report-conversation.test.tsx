import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { AidtReportConversation } from "@/features/aidt/components/aidt-report-conversation";
import { AidtReportOutput } from "@/features/aidt/components/aidt-report-output";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/features/aidt/lib/aidt-summary-results", async importOriginal => ({
  ...await importOriginal<typeof import("@/features/aidt/lib/aidt-summary-results")>(),
  readAidtChatReportDraft: read,
}));

const scope = { orgId: "org", userId: "user", projectId: "project", sessionToken: "test", lifecycleKey: "life" };
const draft = "# 小组研究报告\n\n第一项发现";
const sources = [{ stageId: 2, revision: 7 }];
const candidate = { markdown: draft, sourceReview: { status: "available", receipt: {
  stageRevisions: sources, application: { state: "message-dispatch-observed" },
} } };

function props(): ComponentProps<typeof AidtReportConversation> {
  return {
    messages: [{ id: "agent-result", role: "assistant", content: draft }], loading: false, running: false,
    projectId: scope.projectId, entityId: "group-report", threadId: "report-thread", text: null,
    onChange: vi.fn(), historyScope: scope, onDraftReady: vi.fn(),
    shared: {
      available: true, loading: false, saving: false, canSave: true, canConfirm: true,
      serverRevision: null, serverMarkdown: null, savedAt: null, savedBy: null, matchesServer: false,
      conflict: false, needsBaseReview: false, error: null, loadError: null, chooseSources: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined), confirm: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn(), restore: vi.fn(), reviewBase: vi.fn(),
    },
  };
}

it("opens the report output after an authorized Chat result without adopting or saving it", async () => {
  read.mockResolvedValue(candidate);
  const input = props();
  const view = render(<AidtReportConversation {...input} running />);
  expect(input.onDraftReady).not.toHaveBeenCalled();
  view.rerender(<AidtReportConversation {...input} />);
  await waitFor(() => expect(input.onDraftReady).toHaveBeenCalledWith(draft));
  expect(input.onChange).not.toHaveBeenCalled();
  expect(input.shared.save).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "确认小组报告" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "采用报告草稿" }));
  expect(input.onChange).toHaveBeenCalledWith(draft);
  expect(input.shared.chooseSources).toHaveBeenCalledWith(sources);

  view.rerender(<AidtReportConversation {...input} text={draft} shared={{ ...input.shared, canConfirm: false }} />);
  fireEvent.click(screen.getByRole("button", { name: "保存报告草稿" }));
  expect(input.shared.save).toHaveBeenCalledOnce();
  expect(input.shared.confirm).not.toHaveBeenCalled();

  view.rerender(<AidtReportConversation {...input} text={draft} shared={{ ...input.shared, canSave: false, matchesServer: true }} />);
  fireEvent.click(screen.getByRole("button", { name: "确认小组报告" }));
  expect(input.shared.confirm).toHaveBeenCalledOnce();
});

it("discards a late candidate after the report entity changes", async () => {
  let complete!: (result: unknown) => void;
  read.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const input = props();
  const view = render(<AidtReportConversation {...input} />);
  view.rerender(<AidtReportConversation {...input} entityId="different-report" threadId="different-thread" messages={[]} />);
  await act(async () => complete(candidate));
  expect(input.onDraftReady).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "采用报告草稿" })).toBeNull();
});

it("shows only the report document and status in the right inspector", () => {
  const input = props();
  render(<AidtReportOutput text={null} proposalText={draft} shared={input.shared} />);
  expect(screen.getByRole("article", { name: "报告正文" })).toHaveTextContent("第一项发现");
  expect(screen.getByTestId("aidt-report-save-state")).toHaveTextContent("待采用");
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: /确认|编辑/ })).toBeNull();
});

it("opens the default group report from a single card when no report exists", async () => {
  const { AidtReportDirectory } = await import("@/features/aidt/components/aidt-report-directory");
  render(<AidtReportDirectory href={id => "/aidt/project?step=6&summary=1&entity=" + id} />);
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByText("待起草")).toBeVisible();
  expect(screen.getByRole("link", { name: "打开小组研究报告" })).toHaveAttribute("href", "/aidt/project?step=6&summary=1&entity=group-report");
});
