import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { AgentPlanPanel, type PlanTodo } from "@/components/chat/agent-plan-panel";
import { PlanStepActionList } from "@/components/chat/plan-step-action-list";
import type { PlanStepAction } from "@/lib/chat-workbench/trace-plan";
function SwitchLanguage() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
it("localizes the plan summary without replacing raw plan entries or their canonical status", () => {
  const todos: PlanTodo[] = [{ content: "模型计划原文 {count}", status: "completed" }, { content: "尚未执行的原文🌍", status: "pending" }];
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><AgentPlanPanel steps={[]} stateSnapshotTodos={todos} /></I18nProvider>);
  const panel = screen.getByTestId("agent-plan-panel"); expect(screen.getByText("Plan 1/2")).toBeTruthy();
  const raw = screen.getByText(todos[0]!.content); expect(panel.getAttribute("data-plan-done")).toBe("1");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("agent-plan-panel")).toBe(panel); expect(screen.getByText(todos[0]!.content)).toBe(raw);
  expect(screen.getByText("计划 1/2")).toBeTruthy(); expect(raw.closest("li")?.getAttribute("data-plan-status")).toBe("completed");
});
it("keeps action disclosure and original file projection while translating count and status", () => {
  const todo: PlanTodo = { content: "用户计划原文", status: "in_progress" };
  const actions: PlanStepAction[] = [{ id: "raw-action", kind: "tool", tool: "read_file", args: { path: "用户文件{count}.txt" }, status: "failed" }];
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><PlanStepActionList todo={todo} actions={actions} /></I18nProvider>);
  expect(screen.getByText("1 action")).toBeTruthy(); const disclosure = screen.getByTestId("chat-task-workbench-plan-step-actions");
  const row = screen.getByTestId("chat-task-workbench-plan-step-action"); expect(row.textContent).toBe("Read file · 用户文件{count}.txt · Failed");
  expect(disclosure.hasAttribute("open")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("chat-task-workbench-plan-step-action")).toBe(row); expect(disclosure.hasAttribute("open")).toBe(true);
  expect(row.textContent).toBe("读取文件 · 用户文件{count}.txt · 失败"); expect(row.getAttribute("data-status")).toBe("failed");
});
