import * as React from "react";
import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AidtChatEmptyState } from "@/features/aidt/components/aidt-chat-empty-state";
import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";

it.each([
  [0, "原始命题", "选题理由与来源"],
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
  expect(screen.getByTestId("aidt-input-scaffold")).toHaveTextContent("猜测");
  expect(screen.getByTestId("aidt-input-scaffold")).toHaveTextContent("____");
  expect(screen.queryByText(/奶茶/)).toBeNull();
  rerender(<AidtChatEmptyState step={AIDT_STEPS[2]} />);
  expect(screen.getByTestId("aidt-input-scaffold")).toHaveTextContent("暂无");
  expect(screen.getByTestId("aidt-input-scaffold")).not.toHaveTextContent("暂无的原因");
  rerender(<AidtChatEmptyState step={AIDT_STEPS[5]} />);
  expect(screen.getByTestId("aidt-input-scaffold")).toHaveTextContent("证据不足");
});
