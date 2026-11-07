import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
const api = vi.hoisted(() => ({ turn: vi.fn(), read: vi.fn(), apply: vi.fn() }));
vi.mock("@/lib/knowledge-graph-api", async (load) => ({ ...(await load<typeof import("@/lib/knowledge-graph-api")>()), fetchTurnMemory: api.turn, fetchThreadKnowledge: api.read, applyHumanAction: api.apply }));
import { TurnMemoryLine } from "@/components/chat/knowledge/turn-memory-line";
import { KnowledgeGraphError } from "@/lib/knowledge-graph-api";
import { publishKnowledgeSnapshot } from "@/lib/knowledge-graph-events";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { knowledgeGraph } from "@repo/contracts/chat-knowledge-graph";
const thread = "raw-thread"; const message = "raw-message";
const conflict = { promptId: "raw-prompt", kind: "conflict" as const, newerClaim: { id: "raw-new", statement: "模型新说法 {new}" }, olderClaim: { id: "raw-old", statement: "用户原说法 {old}", saidAt: "2026-11-01T12:00:00Z" } };
const turn = knowledgeGraph.getTurnMemory.out.parse({ messageId: message, captured: [], pending: false, prompt: { type: "conflict", conflict }, supersede: null, recalled: [], recallDegraded: false });
const read = knowledgeGraph.getThreadKnowledge.out.parse({ scope: { kind: "chat_session", id: thread }, revision: 13, objects: [], claims: [], edges: [], ingestion: { queued: 0, running: 0, failed: 0, failures: [] }, canEdit: true, canPromote: true, visibility: "owner_only", extractionActive: true });
let changeLocale: () => void = () => {};
function Driver() { const { setLocale } = useI18n(); React.useEffect(() => { changeLocale = () => setLocale("zh-CN"); return () => { changeLocale = () => {}; }; }, [setLocale]); return null; }
beforeEach(() => { api.turn.mockReset(); api.read.mockReset(); api.apply.mockReset(); api.turn.mockResolvedValue(turn); api.read.mockResolvedValue(read); publishKnowledgeSnapshot({ threadId: thread, canEdit: true, revision: 7 }); });
afterEach(() => { cleanup(); publishKnowledgeSnapshot(null); });

it.each([
  { code: "KG_NOT_OWNER" as const, status: 403, testid: "kg-conflict-error", en: "Only the conversation creator can edit its memories.", zh: "只有对话的创建者可以修改这里的记忆。" },
  { code: "KG_PROMPT_NOT_FOUND" as const, status: 404, testid: "kg-conflict-gone", en: "This reminder is no longer available.", zh: "这条提醒已经不在了。" },
])("formats actual TurnMemoryLine $code only at render, preserving one CAS action on locale", async ({ code, status, testid, en, zh }) => {
  api.apply.mockRejectedValue(new KnowledgeGraphError(code, status));
  render(<I18nProvider initialLocale="en"><Driver /><TurnMemoryLine threadId={thread} messageId={message} /></I18nProvider>);
  fireEvent.click(await screen.findByTestId("kg-conflict-keep-new"));
  const notice = await screen.findByTestId(testid); expect(notice).toHaveTextContent(en); expect(notice).not.toHaveTextContent(code);
  expect(api.apply).toHaveBeenCalledTimes(1); expect(api.apply).toHaveBeenCalledWith(thread, 13, { type: "resolveConflict", promptId: conflict.promptId, resolution: "keep_new" }); expect(api.read).toHaveBeenCalledTimes(1); expect(api.turn).toHaveBeenCalledTimes(1);
  act(() => changeLocale()); expect(screen.getByTestId(testid)).toBe(notice); expect(notice).toHaveTextContent(zh); expect(api.apply).toHaveBeenCalledTimes(1); expect(api.read).toHaveBeenCalledTimes(1); expect(api.turn).toHaveBeenCalledTimes(1);
});
