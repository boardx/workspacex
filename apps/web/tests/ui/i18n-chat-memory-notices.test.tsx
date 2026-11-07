import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
const api = vi.hoisted(() => ({ extract: vi.fn(), read: vi.fn(), apply: vi.fn(), personal: vi.fn() }));
vi.mock("@/lib/knowledge-graph-api", async (load) => ({ ...(await load<typeof import("@/lib/knowledge-graph-api")>()), fetchMessageExtraction: api.extract, fetchThreadKnowledge: api.read, applyHumanAction: api.apply, undoAutoPersonalCopy: api.personal }));
import { SupersedeNoticeLine } from "@/components/chat/knowledge/supersede-notice-line";
import { ExtractionFeedbackChip } from "@/components/chat/knowledge/extraction-feedback-chip";
import { onRememberStatement, publishKnowledgeSnapshot } from "@/lib/knowledge-graph-events";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { knowledgeGraph, KgSupersedeNotice } from "@repo/contracts/chat-knowledge-graph";
const thread = "raw-thread"; const raw = "用户原始消息 {count}";
const notice = KgSupersedeNotice.parse({ noticeId: "raw-notice", newerClaim: { id: "raw-new", statement: "新原文 {new}" }, olderClaim: { id: "raw-old", statement: "旧原文 {old}" }, state: "applied" });
let changeLocale: () => void = () => {};
function Driver() { const { setLocale } = useI18n(); React.useEffect(() => { changeLocale = () => setLocale("zh-CN"); return () => { changeLocale = () => {}; }; }, [setLocale]); return null; }
beforeEach(() => { api.extract.mockReset(); api.read.mockReset(); api.apply.mockReset(); api.personal.mockReset(); publishKnowledgeSnapshot({ threadId: thread, canEdit: true, revision: 7 }); });
afterEach(() => { cleanup(); publishKnowledgeSnapshot(null); });

it("keeps an explicit pending supersede undo once and old/new raw statements through locale", async () => {
  let finish!: () => void; const undo = vi.fn(() => new Promise<void>(done => { finish = done; }));
  render(<I18nProvider initialLocale="en"><Driver /><SupersedeNoticeLine notice={notice} onUndo={undo} /></I18nProvider>);
  const button = screen.getByRole("button", { name: "Undo" }); expect(screen.getByTestId("kg-supersede-text")).toHaveTextContent(notice.newerClaim.statement); expect(screen.getByTestId("kg-supersede-text")).toHaveTextContent(notice.olderClaim.statement);
  fireEvent.click(button); act(() => changeLocale()); expect(screen.getByTestId("kg-supersede-undo")).toBe(button); expect(button).toBeDisabled(); expect(undo).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); }); expect(screen.getByTestId("kg-supersede-undone")).toHaveTextContent(notice.olderClaim.statement); expect(undo).toHaveBeenCalledTimes(1);
});

it("renders a server-undone notice without presenting a fresh undo decision", () => {
  const undo = vi.fn(async () => {});
  render(<I18nProvider initialLocale="en"><Driver /><SupersedeNoticeLine notice={{ ...notice, state: "undone" }} onUndo={undo} /></I18nProvider>);
  const root = screen.getByTestId("kg-supersede-undone"); expect(root).toHaveTextContent("Restored"); expect(root).toHaveTextContent(notice.olderClaim.statement);
  act(() => changeLocale()); expect(screen.getByTestId("kg-supersede-undone")).toBe(root); expect(screen.queryByRole("button")).toBeNull(); expect(undo).not.toHaveBeenCalled();
});

it("keeps empty extraction feedback as display only and manually remembers the original message once", async () => {
  api.extract.mockResolvedValue(knowledgeGraph.getMessageExtraction.out.parse({ status: "empty", claims: [] }));
  const remember = vi.fn(); const off = onRememberStatement(remember);
  try {
    render(<I18nProvider initialLocale="en"><Driver /><ExtractionFeedbackChip threadId={thread} messageId="raw-message" statement={raw} /></I18nProvider>);
    const root = await screen.findByTestId("kg-extraction-empty"); expect(root).toHaveTextContent("No memory was saved automatically");
    const button = screen.getByRole("button", { name: "Remember manually" }); act(() => changeLocale()); expect(screen.getByTestId("kg-extraction-empty")).toBe(root); expect(screen.getByTestId("kg-extraction-empty-remember")).toBe(button); expect(remember).not.toHaveBeenCalled(); expect(api.extract).toHaveBeenCalledTimes(1);
    fireEvent.click(button); expect(button).toBeDisabled(); expect(remember).toHaveBeenCalledTimes(1); expect(remember).toHaveBeenCalledWith(raw); expect(api.apply).not.toHaveBeenCalled();
  } finally { off(); }
});

it("retains actual extracted content and only explicitly undoes its canonical personal copy and current revision", async () => {
  api.extract.mockResolvedValue(knowledgeGraph.getMessageExtraction.out.parse({ status: "written", claims: [{ claimId: "raw-claim", statement: raw, kind: "decision", personalCopyClaimId: "raw-personal" }] }));
  api.read.mockResolvedValue(knowledgeGraph.getThreadKnowledge.out.parse({ scope: { kind: "chat_session", id: thread }, revision: 13, objects: [], claims: [], edges: [], ingestion: { queued: 0, running: 0, failed: 0, failures: [] }, canEdit: true, canPromote: true, visibility: "owner_only", extractionActive: true }));
  api.personal.mockResolvedValue(knowledgeGraph.undoAutoPersonalCopy.out.parse({ personalClaimId: "raw-personal", outcome: "revoked" })); api.apply.mockResolvedValue(knowledgeGraph.applyHumanAction.out.parse({ revision: 14, actionId: "raw-audit-action" }));
  render(<I18nProvider initialLocale="en"><Driver /><ExtractionFeedbackChip threadId={thread} messageId="raw-message" statement={raw} /></I18nProvider>);
  const line = await screen.findByTestId("kg-extraction-line-raw-claim"); expect(screen.getByTestId("kg-extraction-kind-raw-claim")).toHaveTextContent("Decision"); expect(line).toHaveTextContent(raw); expect(screen.getByTestId("kg-extraction-personal-raw-claim")).toHaveTextContent("Saved to personal memory");
  act(() => changeLocale()); expect(screen.getByTestId("kg-extraction-line-raw-claim")).toBe(line); expect(line).toHaveTextContent(raw); expect(api.extract).toHaveBeenCalledTimes(1); expect(api.apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("kg-extraction-undo-raw-claim")); await act(async () => {});
  expect(api.personal).toHaveBeenCalledTimes(1); expect(api.personal).toHaveBeenCalledWith(thread, "raw-claim"); expect(api.apply).toHaveBeenCalledTimes(1); expect(api.apply).toHaveBeenCalledWith(thread, 13, { type: "revokeClaim", claimId: "raw-claim" }); expect(screen.queryByTestId("kg-extraction-line-raw-claim")).toBeNull();
});
