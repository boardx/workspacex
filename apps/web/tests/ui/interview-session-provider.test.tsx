import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InterviewCompletionProvider } from "@/components/itv/interview-completion-provider";
import { useInterviewSource } from "@/components/itv/interview-session-provider";
import { InterviewMarkdownPlanningStep } from "@/components/itv/interview-markdown-planning-step";
import type { InterviewMarkdownEnvelope } from "@/lib/interview-markdown-api";
const { read, initialize, scope } = vi.hoisted(() => ({ read: vi.fn(), initialize: vi.fn(), scope: { session: { userId: "actor-a", currentOrgId: "org-a", sessionToken: "test-token" }, status: "authenticated" } }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => scope }));
vi.mock("@/lib/interview-markdown-api", () => ({ loadInterviewMarkdown: read, initializeInterviewMarkdown: initialize }));
function envelope(version = 1, markdown = "已保存需求"): InterviewMarkdownEnvelope {
 return { interviewId: "itv-session-5967", revisionId: "revision-5967", version, documents: [{ documentId: "doc-intake", step: "intake", version, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [], markdown }], states: [{ documentId: "doc-intake", status: "draft", failure: null }], execution: null, review: null };
}
function Probe({ name = "source" }: { name?: string }) {
 const { source, refresh, setSource, syncError } = useInterviewSource("itv-session-5967");
 return <><output data-testid={name}>{source?.documents[0]?.markdown ?? "unknown"}</output><button onClick={() => void refresh().then(setSource).catch(() => {})}>同步 {name}</button><p>{syncError}</p></>;
}
beforeEach(() => { read.mockReset().mockResolvedValue(envelope()); initialize.mockReset().mockResolvedValue(envelope()); scope.session = { userId: "actor-a", currentOrgId: "org-a", sessionToken: "test-token" }; });
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("retains source across stage remounts, updates on focus, retains it on failure", async () => {
 const view = render(<InterviewCompletionProvider><Probe key="first" /></InterviewCompletionProvider>);
 fireEvent.click(screen.getByRole("button", { name: "同步 source" }));
 await screen.findByText("已保存需求");
 read.mockReturnValue(new Promise(() => {}));
 view.rerender(<InterviewCompletionProvider><Probe key="next-stage" /></InterviewCompletionProvider>);
 expect(screen.getByTestId("source")).toHaveTextContent("已保存需求");
 read.mockResolvedValue(envelope(2, "远端更新"));
 fireEvent(window, new Event("focus"));
 await waitFor(() => expect(screen.getByTestId("source")).toHaveTextContent("远端更新"));
 read.mockRejectedValue(new Error("offline")); fireEvent(window, new Event("online"));
 await screen.findByText("最新访谈数据同步失败，已显示的内容保留。");
 expect(screen.getByTestId("source")).toHaveTextContent("远端更新");
 read.mockResolvedValue(envelope(3, "网络恢复后的需求"));
 fireEvent.click(screen.getByRole("button", { name: "同步 source" }));
 await screen.findByText("网络恢复后的需求");
 expect(screen.queryByText("最新访谈数据同步失败，已显示的内容保留。")).not.toBeInTheDocument();
 expect(initialize).not.toHaveBeenCalled();
});
it("uses a single background poll for multiple subscribers and stops when hidden/unmounted", async () => {
 vi.useFakeTimers();
 const view = render(<InterviewCompletionProvider><Probe /><Probe name="other" /></InterviewCompletionProvider>);
 await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
 expect(read).toHaveBeenCalledTimes(1);
 const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
 await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
 expect(read).toHaveBeenCalledTimes(1); hidden.mockRestore();
 view.unmount(); await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
 expect(read).toHaveBeenCalledTimes(1); expect(initialize).not.toHaveBeenCalled();
});
it("drops the snapshot on actor or organization switch and rejects the old in-flight result", async () => {
 let resolve!: (next: InterviewMarkdownEnvelope) => void;
 read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
 const view = render(<InterviewCompletionProvider><Probe /></InterviewCompletionProvider>);
 fireEvent.click(screen.getByRole("button", { name: "同步 source" }));
 await act(async () => { await Promise.resolve(); });
 scope.session = { userId: "actor-b", currentOrgId: "org-b", sessionToken: "token-b" };
 view.rerender(<InterviewCompletionProvider><Probe /></InterviewCompletionProvider>);
 await act(async () => { resolve(envelope()); });
 expect(screen.getByTestId("source")).toHaveTextContent("unknown");
});
it("preserves an edited intake when background data changes and offers explicit conflict resolution", async () => {
 const dirty = vi.fn();
 render(<InterviewCompletionProvider><InterviewMarkdownPlanningStep interviewId="itv-session-5967" step="intake" onVersionChange={vi.fn()} onDirtyChange={dirty} onContinue={vi.fn()} /></InterviewCompletionProvider>);
 const input = await screen.findByRole("textbox", { name: "研究需求 Markdown" });
 await waitFor(() => expect(input).toHaveValue("已保存需求"));
 fireEvent.change(input, { target: { value: "本地未保存文字" } });
 read.mockResolvedValue(envelope(2, "另一端更新了需求")); fireEvent(window, new Event("focus"));
 await screen.findByRole("button", { name: "放弃本地修改，采用最新版本" });
 expect(input).toHaveValue("本地未保存文字");
 fireEvent.click(screen.getByRole("button", { name: "放弃本地修改，采用最新版本" }));
 expect(input).toHaveValue("另一端更新了需求"); expect(dirty).toHaveBeenLastCalledWith(false);
});
it.each(["missing", "older", "hash", "id", "unadvanced-aggregate"])("rejects %s report identity regressions from shared background reads", async mismatch => {
 const base = envelope(10, "已保存的报告正文");
 base.documents = [{ ...base.documents[0]!, documentId: "report-v2", step: "report", version: 2 }];
 read.mockResolvedValue(base);
 render(<InterviewCompletionProvider><Probe /></InterviewCompletionProvider>);
 fireEvent.click(screen.getByRole("button", { name: "同步 source" }));
 await screen.findByText("已保存的报告正文");
 const next = { ...base, version: mismatch === "unadvanced-aggregate" ? 10 : 11, documents: mismatch === "missing" ? [] : [{ ...base.documents[0]!, markdown: "不可信的新响应", version: mismatch === "older" ? 1 : mismatch === "unadvanced-aggregate" ? 3 : 2, contentHash: mismatch === "hash" ? "b".repeat(64) : base.documents[0]!.contentHash, documentId: mismatch === "id" ? "wrong-id" : "report-v2" }] };
 read.mockResolvedValue(next); fireEvent(window, new Event("focus"));
 await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
 expect(screen.getByTestId("source")).toHaveTextContent("已保存的报告正文");
});
it("restores usable subscription after StrictMode effect cleanup", async () => {
 render(<React.StrictMode><InterviewCompletionProvider><Probe /></InterviewCompletionProvider></React.StrictMode>);
 fireEvent.click(screen.getByRole("button", { name: "同步 source" }));
 await screen.findByText("已保存需求");
 read.mockResolvedValue(envelope(2, "严格模式刷新")); fireEvent(window, new Event("focus"));
 await screen.findByText("严格模式刷新");
});
