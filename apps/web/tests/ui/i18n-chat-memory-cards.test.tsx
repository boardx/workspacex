import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryCard, type UndoOutcome } from "@/components/chat/knowledge/memory-card";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { KgMemoryCard } from "@repo/contracts/chat-knowledge-graph";
const raw = "原始记忆 {count} const raw = '{locale}';";
const remember = KgMemoryCard.parse({ cardId: "raw-card", kind: "remember", items: [{ claimId: null, statement: raw }], state: "open" });
const forget = KgMemoryCard.parse({ cardId: "raw-forget", kind: "forget", items: [{ claimId: "raw-one", statement: raw }, { claimId: "raw-two", statement: "另一条原文 {item}" }], state: "open" });
let changeLocale: () => void = () => {};
function Driver() { const { setLocale } = useI18n(); React.useEffect(() => { changeLocale = () => setLocale("zh-CN"); return () => { changeLocale = () => {}; }; }, [setLocale]); return null; }
afterEach(cleanup);

it("keeps edited raw memory and one pending explicit acceptance across locale", async () => {
  let finish!: (card: KgMemoryCard) => void; const actOn = vi.fn(() => new Promise<KgMemoryCard>(done => { finish = done; }));
  render(<I18nProvider initialLocale="en"><Driver /><MemoryCard card={remember} canAct onAct={actOn} /></I18nProvider>);
  const input = screen.getByRole("textbox", { name: "Memory to save (editable)" }); const draft = "用户编辑 {name}";
  fireEvent.change(input, { target: { value: draft } }); fireEvent.click(screen.getByRole("button", { name: "Remember" }));
  expect(input).toBeDisabled(); act(() => changeLocale()); expect(screen.getByTestId("kg-card-remember-text")).toBe(input); expect(input).toHaveValue(draft); expect(actOn).toHaveBeenCalledTimes(1); expect(actOn).toHaveBeenCalledWith("accept", { editedStatement: draft });
  await act(async () => { finish({ ...remember, state: "done", items: [{ claimId: "raw-saved", statement: draft }] }); });
  expect(screen.getByTestId("kg-card-done")).toHaveTextContent("已记住"); expect(actOn).toHaveBeenCalledTimes(1);
});

it("retains the exact subset of raw claim IDs for explicit forgetting through locale", async () => {
  const actOn = vi.fn(async () => ({ ...forget, state: "done" as const }));
  render(<I18nProvider initialLocale="en"><Driver /><MemoryCard card={forget} canAct onAct={actOn} /></I18nProvider>);
  const second = forget.items[1]; if (!second) throw new Error("Missing second canonical fixture item");
  const checkbox = screen.getByRole("checkbox", { name: `Forget ${second.statement}` }); fireEvent.click(checkbox); expect(checkbox).not.toBeChecked();
  act(() => changeLocale()); expect(screen.getByTestId("kg-card-forget-check-raw-two")).toBe(checkbox); expect(checkbox).not.toBeChecked(); expect(actOn).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("kg-card-accept")); await screen.findByTestId("kg-card-done");
  expect(actOn).toHaveBeenCalledTimes(1); expect(actOn).toHaveBeenCalledWith("accept", { claimIds: ["raw-one"] });
});

it("renders an overview using raw statements and source titles with canonical links and no actions", () => {
  const actOn = vi.fn(async () => remember);
  const card = KgMemoryCard.parse({ ...remember, kind: "overview", items: [{ claimId: "raw-one", statement: raw, claimKind: "fact", source: { threadId: "raw-thread", title: "原对话标题 {title}" } }] });
  render(<I18nProvider initialLocale="en"><Driver /><MemoryCard card={card} canAct={false} onAct={actOn} /></I18nProvider>);
  const root = screen.getByTestId("kg-card-overview"); expect(root).toHaveTextContent("What I remember about you"); expect(root).toHaveTextContent(raw); expect(root).toHaveTextContent("原对话标题 {title}");
  const link = screen.getByTestId("kg-overview-brain-link"); expect(link).toHaveAttribute("href", "/brain");
  act(() => changeLocale()); expect(screen.getByTestId("kg-card-overview")).toBe(root); expect(root).toHaveTextContent(raw); expect(screen.getByTestId("kg-overview-brain-link")).toBe(link); expect(actOn).not.toHaveBeenCalled();
});

it.each([
  { state: "stale" as const, id: "kg-card-stale", en: "This card changed and was not applied" },
  { state: "dismissed" as const, id: "kg-card-dismissed", en: "This memory was not saved to long-term memory" },
  { state: "undone" as const, id: "kg-card-undone", en: "Restored" },
])("localizes terminal $state without reactivating decisions", ({ state, id, en }) => {
  const actOn = vi.fn(async () => remember);
  render(<I18nProvider initialLocale="en"><Driver /><MemoryCard card={{ ...remember, state }} canAct onAct={actOn} /></I18nProvider>);
  const root = screen.getByTestId(id); expect(root).toHaveTextContent(en); act(() => changeLocale()); expect(screen.getByTestId(id)).toBe(root); expect(screen.queryAllByRole("button")).toHaveLength(0); expect(actOn).not.toHaveBeenCalled();
});

const undoText: Record<UndoOutcome, string> = { undone: "Undone. This memory was not saved to long-term memory", kept: "other sources", not_undoable: "cannot undo only this save", unknown: "Undid this save" };

it.each<UndoOutcome>(["undone", "kept", "not_undoable", "unknown"])("preserves the server-based undo outcome %s through locale without another undo", async outcome => {
  const actOn = vi.fn(async () => remember); const undo = vi.fn(async () => outcome);
  const card = { ...remember, state: "done" as const, items: [{ claimId: "raw-saved", statement: raw }] };
  render(<I18nProvider initialLocale="en"><Driver /><MemoryCard card={card} canAct onAct={actOn} onUndo={undo} /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await act(async () => {}); const root = screen.getByTestId("kg-card-done"); expect(undo).toHaveBeenCalledTimes(1); expect(undo).toHaveBeenCalledWith("raw-saved"); expect(root).toHaveTextContent(undoText[outcome]);
  act(() => changeLocale()); expect(screen.getByTestId("kg-card-done")).toBe(root); expect(undo).toHaveBeenCalledTimes(1); expect(actOn).not.toHaveBeenCalled(); expect(screen.queryByTestId("kg-card-undo")).toBeNull();
});

it("keeps a caller-provided failure raw and does not repeat acceptance on locale", async () => {
  const reason = "调用方失败原文 {reason}"; const actOn = vi.fn(async () => { throw new Error(reason); });
  render(<I18nProvider initialLocale="en"><Driver /><MemoryCard card={remember} canAct onAct={actOn} /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Remember" })); const failure = await screen.findByTestId("kg-card-error"); expect(failure.textContent).toBe(reason);
  act(() => changeLocale()); expect(screen.getByTestId("kg-card-error")).toBe(failure); expect(failure.textContent).toBe(reason); expect(actOn).toHaveBeenCalledTimes(1);
});

it("keeps readonly raw memory visible without any editor or decision", () => {
  const actOn = vi.fn(async () => remember);
  render(<I18nProvider initialLocale="en"><Driver /><MemoryCard card={remember} canAct={false} onAct={actOn} /></I18nProvider>);
  const root = screen.getByTestId("kg-card-remember"); expect(root).toHaveTextContent("Save this to your long-term memory?"); expect(root).toHaveTextContent(raw); expect(screen.queryAllByRole("button")).toHaveLength(0); expect(screen.queryByRole("textbox")).toBeNull();
  act(() => changeLocale()); expect(screen.getByTestId("kg-card-remember")).toBe(root); expect(root).toHaveTextContent(raw); expect(actOn).not.toHaveBeenCalled();
});
