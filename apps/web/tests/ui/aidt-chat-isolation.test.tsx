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
  [0, "先写你们的初始命题：想研究谁、什么场景、什么体验？"],
  [1, "先贴出你们自己拟的访谈问题初稿，再一起改进。"],
  [2, "先写用户画像与HMW（我们如何……）初稿，附上已有证据。"],
  [3, "围绕选定的HMW，先把你们自己脑暴的第一轮点子发来。"],
  [4, "先说明原型给谁用、什么形式，以及这次要表达或验证什么。"],
  [5, "先写测试问题，或带着真实反馈说说你们的反思。"],
] as const)("gives stage %i one concise student-first input hint without prefilling a response", (index, hint) => {
  render(<AidtChatEmptyState step={AIDT_STEPS[index]} />);
  expect(screen.getByText(hint)).toBeVisible(); expect(screen.getByText("先说说你们的想法")).toBeVisible();
  expect(screen.queryByRole("textbox")).toBeNull(); expect(screen.queryByRole("button")).toBeNull();
});
