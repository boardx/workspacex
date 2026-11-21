import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AidtChatEmptyState } from "@/features/aidt/components/aidt-chat-empty-state";
import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";

it.each([
  [1, "访谈问题初稿", "人物发现卡"],
  [2, "暂无", "画像与HMW"],
  [3, "一个点子一行", "三个不同点子"],
  [4, "最想知道什么", "待测试"],
  [5, "原验证问题", "下一轮行动"],
] as const)("gives step %i an optional blank scaffold and an honest output target", (index, input, output) => {
  render(<AidtChatEmptyState step={AIDT_STEPS[index]} />);
  expect(screen.getByTestId("aidt-chat-welcome")).toHaveTextContent(input);
  const help = screen.getByText("不知道怎么开始？").closest("details")!;
  expect(help.open).toBe(false);
  help.open = true;
  expect(screen.getByTestId("aidt-input-scaffold")).toBeVisible();
  expect(screen.getByTestId("aidt-step-deliverable")).toHaveTextContent(output);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});

it("keeps guessing and absent evidence valid without inventing student answers", () => {
  const { rerender } = render(<AidtChatEmptyState step={AIDT_STEPS[0]} />);
  expect(screen.getByTestId("aidt-input-scaffold")).toHaveTextContent("待讨论");
  expect(screen.queryByText(/奶茶/)).toBeNull();
  rerender(<AidtChatEmptyState step={AIDT_STEPS[2]} />);
  expect(screen.getByTestId("aidt-input-scaffold")).toHaveTextContent("暂无");
  expect(screen.getByTestId("aidt-input-scaffold")).not.toHaveTextContent("暂无的原因");
  rerender(<AidtChatEmptyState step={AIDT_STEPS[5]} />);
  expect(screen.getByTestId("aidt-input-scaffold")).toHaveTextContent("证据不足");
});


it("offers a blank Skill-authored template through the native composer port without a second input", () => {
  const offerInitial = vi.fn(() => "accepted" as const);
  render(<AidtChatEmptyState step={AIDT_STEPS[0]} offerInitial={offerInitial} />);
  expect(screen.getByText("你们想研究什么？")).toBeVisible();
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "填入回答提纲" }));
  expect(offerInitial).toHaveBeenCalledWith("原始命题：\n暂定用户与场景：\n想了解的活动或体验：");
  expect(screen.getByRole("status")).toHaveTextContent("填写后可发送");
});
