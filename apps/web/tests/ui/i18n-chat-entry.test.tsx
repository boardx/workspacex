import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { TaskWorkbenchEmptyState } from "@/components/chat/chat-task-workbench-empty-state";
import { NewThreadButton, SidebarBrandHeader, ThreadListHeader, ThreadMeta, ThreadCardButton } from "@/components/chat/thread-list-shell";
import type { ThreadCard } from "@/lib/live-chat";

afterEach(cleanup);
function SwitchLanguage() {
  const { setLocale } = useI18n();
  return <button onClick={() => setLocale("zh-CN")}>switch language</button>;
}
const card: ThreadCard = {
  id: "thr-a", title: "用户自己的原文", subtitle: "", badges: ["degraded", "review-pending"],
  status: "awaiting-approval", artifactCount: 3, lastActivityAt: "invalid raw timestamp",
  visibilityScope: "private", pinned: false,
};

it("renders the English welcome and live context without changing supplied content", () => {
  render(<I18nProvider initialLocale="en"><TaskWorkbenchEmptyState onUseTemplate={vi.fn()} materialsCount={3} skillsCount={2} briefing={<aside>用户简报：保留原文</aside>} inProject /></I18nProvider>);
  expect(screen.getByText("What would you like to accomplish today?")).toBeTruthy();
  expect(screen.getByTestId("chat-task-workbench-context-chip-materials").textContent).toBe("Materials 3");
  expect(screen.getByTestId("chat-task-workbench-context-chip-skills").textContent).toBe("Skills 2");
  expect(screen.getByTestId("chat-task-workbench-context-chip-project").textContent).toBe("Project: This project");
  expect(screen.getByTestId("chat-task-workbench-context-chip-memory").textContent).toBe("Memory: This conversation only");
  expect(screen.getByText("用户简报：保留原文")).toBeTruthy();
});

it("prefills the authored English goal exactly once only on explicit template selection", () => {
  const select = vi.fn();
  render(<I18nProvider initialLocale="en"><TaskWorkbenchEmptyState onUseTemplate={select} materialsCount={0} skillsCount={0} /></I18nProvider>);
  expect(select).not.toHaveBeenCalled();
  const research = screen.getByRole("button", { name: "Research a market and create a sourced report" });
  expect(research.getAttribute("data-testid")).toBe("chat-task-workbench-template-research");
  fireEvent.click(research);
  expect(select).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenCalledWith("Research the current market and create a report with source citations.");
});

it("updates labels in place without selecting a template or replacing raw briefing nodes", () => {
  const select = vi.fn();
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><TaskWorkbenchEmptyState onUseTemplate={select} materialsCount={0} skillsCount={0} briefing={<aside data-testid="raw-briefing">私人原文</aside>} /></I18nProvider>);
  const template = screen.getByTestId("chat-task-workbench-template-research");
  expect(template.textContent).toContain("Research a market");
  const briefing = screen.getByTestId("raw-briefing");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("chat-task-workbench-template-research")).toBe(template);
  expect(template.textContent).toContain("调研市场并产出带来源的报告");
  expect(screen.getByTestId("raw-briefing")).toBe(briefing);
  expect(select).not.toHaveBeenCalled();
});

it("localizes shared sidebar defaults and shortcut help while preserving explicit caller labels", () => {
  const click = vi.fn();
  render(<I18nProvider initialLocale="en"><SidebarBrandHeader /><ThreadListHeader /><NewThreadButton disabled={false} onClick={click} /><NewThreadButton disabled onClick={click} label="用户指定名称" /></I18nProvider>);
  expect(screen.getByRole("heading", { name: "Conversations" })).toBeTruthy();
  expect(screen.getByTitle("⌘K / Ctrl+K Search conversations")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
  expect(click).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "用户指定名称" }).hasAttribute("disabled")).toBe(true);
});

it("localizes accessible facts without altering status enums, actual counts or malformed timestamps", () => {
  render(<I18nProvider initialLocale="en"><ThreadMeta card={card} /></I18nProvider>);
  const status = screen.getByTestId("chat-task-workbench-thread-status");
  expect(status.getAttribute("data-status")).toBe("awaiting-approval");
  expect(status.textContent).toBe("Waiting for your confirmation");
  expect(screen.getByTestId("chat-task-workbench-thread-artifact-count").textContent).toContain("3 artifacts");
  expect(screen.getByText(/invalid raw timestamp/)).toBeTruthy();
  expect(screen.getByText(/Degraded/)).toBeTruthy();
  expect(screen.getByText(/Review pending/)).toBeTruthy();
});

it("preserves an edited raw title and the input node across locale switches, including Escape", () => {
  const rename = vi.fn();
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><ThreadCardButton card={card} selected onSelect={vi.fn()} onRename={rename} onDelete={vi.fn()} pending={null} failure={null} /></I18nProvider>);
  fireEvent.doubleClick(screen.getByTestId("chat-thread-thr-a"));
  const input = screen.getByRole("textbox", { name: "New conversation title" }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "用户编辑的 title 🌍" } });
  input.setSelectionRange(2, 4);
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByRole("textbox", { name: "新的会话标题" })).toBe(input);
  expect(input.value).toBe("用户编辑的 title 🌍");
  expect([input.selectionStart, input.selectionEnd]).toEqual([2, 4]);
  expect(rename).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByText("用户自己的原文")).toBeTruthy();
});
