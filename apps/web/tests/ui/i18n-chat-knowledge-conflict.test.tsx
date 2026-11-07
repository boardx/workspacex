import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConflictPromptCard } from "@/components/chat/knowledge/conflict-prompt-card";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { KgConflictPrompt } from "@repo/contracts/chat-knowledge-graph";
const prompt = KgConflictPrompt.parse({ promptId: "raw-prompt", kind: "conflict", newerClaim: { id: "raw-new", statement: "新的模型说法 {newer}" }, olderClaim: { id: "raw-old", statement: "原用户说法 {older}", saidAt: "2026-11-01T12:00:00Z" } });
let changeLocale: () => void = () => {};
function Driver() { const { setLocale } = useI18n(); React.useEffect(() => { changeLocale = () => setLocale("zh-CN"); return () => { changeLocale = () => {}; }; }, [setLocale]); return null; }
afterEach(cleanup);

it("preserves both raw applicability drafts and canonical resolution through locale", async () => {
  const resolve = vi.fn(async () => {});
  render(<I18nProvider initialLocale="en"><Driver /><ConflictPromptCard prompt={prompt} canResolve onResolve={resolve} /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Keep both" }));
  const newer = screen.getByRole("textbox", { name: "When does the new memory apply?" });
  const older = screen.getByRole("textbox", { name: "When does the original memory apply?" });
  fireEvent.change(newer, { target: { value: "新条件 {newer} 原文" } }); fireEvent.change(older, { target: { value: "旧条件 {older} 原文" } });
  act(() => changeLocale()); expect(screen.getByTestId("kg-conflict-cond-newer")).toBe(newer); expect(screen.getByTestId("kg-conflict-cond-older")).toBe(older);
  expect(newer).toHaveValue("新条件 {newer} 原文"); expect(older).toHaveValue("旧条件 {older} 原文"); expect(resolve).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("kg-conflict-both-save"));
  await screen.findByTestId("kg-conflict-resolved"); expect(resolve).toHaveBeenCalledTimes(1); expect(resolve).toHaveBeenCalledWith("keep_both", { newer: "新条件 {newer} 原文", older: "旧条件 {older} 原文" });
});

it("keeps a pending replacement once and translates its eventual resolved chrome without changing statements", async () => {
  let finish!: () => void; const resolve = vi.fn(() => new Promise<void>(done => { finish = done; }));
  render(<I18nProvider initialLocale="en"><Driver /><ConflictPromptCard prompt={{ ...prompt, kind: "possible_change" }} canResolve onResolve={resolve} /></I18nProvider>);
  const button = screen.getByRole("button", { name: "Replace" });
  expect(screen.getByTestId("kg-conflict-text")).toHaveTextContent(prompt.newerClaim.statement); expect(screen.getByTestId("kg-conflict-text")).toHaveTextContent(prompt.olderClaim.statement);
  fireEvent.click(button); expect(button).toBeDisabled(); act(() => changeLocale()); expect(screen.getByTestId("kg-conflict-keep-new")).toBe(button); expect(button).toBeDisabled(); expect(resolve).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); }); expect(screen.getByTestId("kg-conflict-resolved")).toHaveTextContent("已取代，之后只按新的这条记"); expect(resolve).toHaveBeenCalledWith("keep_new", undefined); expect(resolve).toHaveBeenCalledTimes(1);
});

it("shows localized readonly explanation with raw old/new content and no action controls", () => {
  const resolve = vi.fn(async () => {});
  render(<I18nProvider initialLocale="en"><Driver /><ConflictPromptCard prompt={prompt} canResolve={false} onResolve={resolve} /></I18nProvider>);
  const text = screen.getByTestId("kg-conflict-text"); expect(text).toHaveTextContent("This differs from what you said"); expect(text).toHaveTextContent(prompt.newerClaim.statement); expect(text).toHaveTextContent(prompt.olderClaim.statement);
  act(() => changeLocale()); expect(screen.getByTestId("kg-conflict-text")).toBe(text); expect(screen.queryAllByRole("button")).toHaveLength(0); expect(resolve).not.toHaveBeenCalled();
});

it("keeps unknown caller error text raw through locale without repeating the decision", async () => {
  const raw = "调用方原始失败 {reason}"; const resolve = vi.fn(async () => { throw new Error(raw); });
  render(<I18nProvider initialLocale="en"><Driver /><ConflictPromptCard prompt={prompt} canResolve onResolve={resolve} /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Use the new memory" }));
  const notice = await screen.findByTestId("kg-conflict-error"); expect(notice.textContent).toBe(raw);
  act(() => changeLocale()); expect(screen.getByTestId("kg-conflict-error")).toBe(notice); expect(notice.textContent).toBe(raw); expect(resolve).toHaveBeenCalledTimes(1);
});
