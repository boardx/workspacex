import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TaskWorkbenchEmptyState } from "@/components/chat/chat-task-workbench-empty-state";
import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";
import { AidtChatEmptyState } from "@/features/aidt/components/aidt-chat-empty-state";

it("keeps teaching copy local while ordinary Chat retains its four templates and live context chips", () => {
  const choose = vi.fn();
  render(<><section data-testid="ordinary-chat"><TaskWorkbenchEmptyState materialsCount={2} skillsCount={1} onUseTemplate={choose} /></section><section data-testid="teaching-chat"><AidtChatEmptyState /></section></>);
  const ordinary = within(screen.getByTestId("ordinary-chat")), teaching = within(screen.getByTestId("teaching-chat"));
  expect(ordinary.getAllByRole("button")).toHaveLength(4);
  expect(ordinary.getByTestId("chat-task-workbench-context-chip-materials")).toHaveTextContent("材料 2");
  expect(ordinary.getByTestId("chat-task-workbench-context-chip-project")).toHaveTextContent("个人对话");
  expect(ordinary.queryByText("先说说你们的想法")).toBeNull();
  expect(teaching.getByText("先说说你们的想法")).toBeVisible();
  expect(teaching.queryByRole("button")).toBeNull(); expect(teaching.queryByRole("textbox")).toBeNull();
  fireEvent.click(ordinary.getByRole("button", { name: "调研市场并产出带来源的报告" }));
  expect(choose).toHaveBeenCalledOnce();
});

it.each([
  [0, "先用一句原始命题"],
  [1, "访谈问题初稿"],
  [2, "暂无也可以"],
  [3, "一个点子一行"],
  [4, "最想知道什么"],
  [5, "原验证问题"],
] as const)("gives stage %i one concise student-first input hint without prefilling a response", (index, hint) => {
  render(<AidtChatEmptyState step={AIDT_STEPS[index]} />);
  expect(screen.getByTestId("aidt-chat-welcome")).toHaveTextContent(hint); expect(screen.getByText("先说说你们的想法")).toBeVisible();
  expect(screen.queryByRole("textbox")).toBeNull(); expect(screen.queryByRole("button")).toBeNull();
});
