import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
const api = vi.hoisted(() => ({ turn: vi.fn(), read: vi.fn(), apply: vi.fn() }));
vi.mock("@/lib/knowledge-graph-api", async load => ({ ...(await load<typeof import("@/lib/knowledge-graph-api")>()), fetchTurnMemory: api.turn, fetchThreadKnowledge: api.read, applyHumanAction: api.apply }));
import { TurnMemoryLine } from "@/components/chat/knowledge/turn-memory-line";
import { SupersedeNoticeLine } from "@/components/chat/knowledge/supersede-notice-line";
import { KnowledgeGraphError } from "@/lib/knowledge-graph-api";
import { publishKnowledgeSnapshot } from "@/lib/knowledge-graph-events";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { knowledgeGraph, KgSupersedeNotice } from "@repo/contracts/chat-knowledge-graph";
const thread = "raw-thread"; const message = "raw-message";
const notice = KgSupersedeNotice.parse({ noticeId: "raw-notice", newerClaim: { id: "raw-new", statement: "新原文 {new}" }, olderClaim: { id: "raw-old", statement: "旧原文 {old}" }, state: "applied" });
let changeLocale: () => void = () => {};
function Driver() { const { setLocale } = useI18n(); React.useEffect(() => { changeLocale = () => setLocale("zh-CN"); return () => { changeLocale = () => {}; }; }, [setLocale]); return null; }
function app(child: React.ReactNode) { return <I18nProvider initialLocale="en"><Driver />{child}</I18nProvider>; }
beforeEach(() => { api.turn.mockReset(); api.read.mockReset(); api.apply.mockReset(); api.turn.mockResolvedValue(knowledgeGraph.getTurnMemory.out.parse({ messageId: message, captured: [], pending: false, prompt: null, supersede: notice, recalled: [], recallDegraded: false })); api.read.mockResolvedValue(knowledgeGraph.getThreadKnowledge.out.parse({ scope: { kind: "chat_session", id: thread }, revision: 13, objects: [], claims: [], edges: [], ingestion: { queued: 0, running: 0, failed: 0, failures: [] }, canEdit: true, canPromote: true, visibility: "owner_only", extractionActive: true })); publishKnowledgeSnapshot({ threadId: thread, canEdit: true, revision: 7 }); });
afterEach(() => { cleanup(); publishKnowledgeSnapshot(null); });
it.each([
  { code: "KG_NOT_OWNER" as const, status: 403, en: "Only the conversation creator can edit its memories.", zh: "只有对话的创建者可以修改这里的记忆。" },
  { code: "KG_REVISION_CHANGED" as const, status: 409, en: "The content changed. The latest version has been loaded; please try again.", zh: "内容已变化，已为你刷新到最新，请再操作一次。" },
])("keeps actual supersede-parent $code cause until render without changing the CAS action", async ({ code, status, en, zh }) => {
  api.apply.mockRejectedValue(new KnowledgeGraphError(code, status)); render(app(<TurnMemoryLine threadId={thread} messageId={message} />)); const button = await screen.findByTestId("kg-supersede-undo"); fireEvent.click(button); const error = await screen.findByTestId("kg-supersede-undo-error"); expect(error).toHaveTextContent(en); expect(error).not.toHaveTextContent(code); expect(api.apply).toHaveBeenCalledTimes(1); expect(api.apply).toHaveBeenCalledWith(thread, 13, { type: "undoSupersede", noticeId: notice.noticeId }); expect(api.read).toHaveBeenCalledTimes(1); expect(api.turn).toHaveBeenCalledTimes(1); act(() => changeLocale()); expect(screen.getByTestId("kg-supersede-undo")).toBe(button); expect(screen.getByTestId("kg-supersede-undo-error")).toBe(error); expect(error).toHaveTextContent(zh); expect(screen.getByTestId("kg-supersede-text")).toHaveTextContent(notice.newerClaim.statement); expect(screen.getByTestId("kg-supersede-text")).toHaveTextContent(notice.olderClaim.statement); expect(api.apply).toHaveBeenCalledTimes(1); expect(api.read).toHaveBeenCalledTimes(1); expect(api.turn).toHaveBeenCalledTimes(1);
});
it("preserves an unknown caller's raw undo error across locale", async () => { const raw = "外部调用失败 {reason}"; const undo = vi.fn(async () => { throw new Error(raw); }); render(app(<SupersedeNoticeLine notice={notice} onUndo={undo} />)); fireEvent.click(screen.getByTestId("kg-supersede-undo")); const error = await screen.findByTestId("kg-supersede-undo-error"); expect(error.textContent).toBe(raw); act(() => changeLocale()); expect(screen.getByTestId("kg-supersede-undo-error")).toBe(error); expect(error.textContent).toBe(raw); expect(undo).toHaveBeenCalledTimes(1); });
