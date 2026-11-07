import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
const api = vi.hoisted(() => ({ turn: vi.fn(), read: vi.fn(), apply: vi.fn(), actCard: vi.fn(), undoCard: vi.fn() }));
vi.mock("@/lib/knowledge-graph-api", async load => ({ ...(await load<typeof import("@/lib/knowledge-graph-api")>()), fetchTurnMemory: api.turn, fetchThreadKnowledge: api.read, applyHumanAction: api.apply, actOnMemoryCard: api.actCard, undoMemoryCard: api.undoCard }));
import { TurnMemoryLine } from "@/components/chat/knowledge/turn-memory-line";
import { KnowledgeGraphError } from "@/lib/knowledge-graph-api";
import { publishKnowledgeSnapshot } from "@/lib/knowledge-graph-events";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { knowledgeGraph, KgMemoryCard } from "@repo/contracts/chat-knowledge-graph";
const thread = "raw-thread"; const message = "raw-message"; const raw = "用户记忆 {locale}";
const read = knowledgeGraph.getThreadKnowledge.out.parse({ scope: { kind: "chat_session", id: thread }, revision: 13, objects: [], claims: [], edges: [], ingestion: { queued: 0, running: 0, failed: 0, failures: [] }, canEdit: true, canPromote: true, visibility: "owner_only", extractionActive: true });
let changeLocale: () => void = () => {};
function Driver() { const { setLocale } = useI18n(); React.useEffect(() => { changeLocale = () => setLocale("zh-CN"); return () => { changeLocale = () => {}; }; }, [setLocale]); return null; }
beforeEach(() => { for (const port of Object.values(api)) port.mockReset(); api.read.mockResolvedValue(read); for (const port of [api.apply, api.actCard, api.undoCard]) port.mockRejectedValue(new KnowledgeGraphError("KG_NOT_OWNER", 403)); publishKnowledgeSnapshot({ threadId: thread, canEdit: true, revision: 7 }); });
afterEach(() => { cleanup(); publishKnowledgeSnapshot(null); });

it.each([
  { name: "remember accept", kind: "remember" as const, state: "open" as const, action: "accept" as const, button: "kg-card-accept", human: false },
  { name: "forget accept", kind: "forget" as const, state: "open" as const, action: "accept" as const, button: "kg-card-accept", human: false },
  { name: "remember dismiss", kind: "remember" as const, state: "open" as const, action: "dismiss" as const, button: "kg-card-dismiss", human: false },
  { name: "undo remember", kind: "remember" as const, state: "done" as const, action: "undo" as const, button: "kg-card-undo", human: true },
  { name: "undo forget", kind: "forget" as const, state: "done" as const, action: "undo" as const, button: "kg-card-undo", human: false },
])("renders actual parent $name rejection in the current locale without another decision", async ({ kind, state, action, button, human }) => {
  const card = KgMemoryCard.parse({ cardId: "raw-card", kind, state, items: [{ claimId: kind === "remember" && state === "open" ? null : "raw-claim", statement: raw }, ...(kind === "forget" && state === "open" ? [{ claimId: "raw-other", statement: "另一条原文 {other}" }] : [])] });
  const turn = knowledgeGraph.getTurnMemory.out.parse({ messageId: message, captured: [], pending: false, prompt: { type: "memory_card", card }, supersede: null, recalled: [], recallDegraded: false });
  api.turn.mockResolvedValue(turn);
  render(<I18nProvider initialLocale="en"><Driver /><TurnMemoryLine threadId={thread} messageId={message} /></I18nProvider>);
  const trigger = await screen.findByTestId(button); const input = screen.queryByTestId("kg-card-remember-text");
  const draft = "编辑原文 {draft}"; if (input) fireEvent.change(input, { target: { value: draft } });
  if (kind === "forget" && state === "open") fireEvent.click(screen.getByTestId("kg-card-forget-check-raw-other"));
  fireEvent.click(trigger); const error = await screen.findByTestId("kg-card-error");
  expect(error).toHaveTextContent(human ? "Only the conversation creator can edit its memories." : "Only the conversation creator can manage memories."); expect(error).not.toHaveTextContent("KG_NOT_OWNER");
  if (action !== "undo") { expect(api.actCard).toHaveBeenCalledTimes(1); expect(api.actCard).toHaveBeenCalledWith(card.cardId, action, action === "dismiss" ? {} : kind === "remember" ? { editedStatement: draft } : { claimIds: ["raw-claim"] }); expect(api.apply).not.toHaveBeenCalled(); expect(api.undoCard).not.toHaveBeenCalled(); }
  else if (kind === "remember") { expect(api.apply).toHaveBeenCalledTimes(1); expect(api.apply).toHaveBeenCalledWith(thread, 13, { type: "revokeClaim", claimId: "raw-claim", reason: "user_undo_remember" }); expect(api.read).toHaveBeenCalledTimes(1); expect(api.turn).toHaveBeenCalledTimes(2); }
  else { expect(api.undoCard).toHaveBeenCalledTimes(1); expect(api.undoCard).toHaveBeenCalledWith(card.cardId); expect(api.apply).not.toHaveBeenCalled(); expect(api.read).not.toHaveBeenCalled(); }
  const calls = Object.values(api).map(port => port.mock.calls.length); act(() => changeLocale());
  expect(screen.getByTestId("kg-card-error")).toBe(error); expect(screen.getByTestId(button)).toBe(trigger); expect(error).toHaveTextContent(human ? "只有对话的创建者可以修改这里的记忆。" : "只有对话创建者能管理记忆。"); expect(Object.values(api).map(port => port.mock.calls.length)).toEqual(calls);
  if (input) { expect(screen.getByTestId("kg-card-remember-text")).toBe(input); expect(input).toHaveValue(draft); }
});
