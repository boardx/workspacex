import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AidtStageJourney } from "@/features/aidt/components/aidt-stage-journey";

function renderJourney(element: React.ReactElement) { const result = render(element); (screen.getByTestId("aidt-stage-journey") as HTMLDetailsElement).open = true; return result; }

const base = { inputText: "本组提供的材料", currentOutput: "当前学生草稿", reportNote: "报告仍需学生审阅" };

it.each([
  [1, "自己的观察", "研究哪个具体问题", "供第2步显式引用"],
  [2, "真实观察、访谈材料", "哪些是原始记录、解释", "供第3步形成画像"],
  [3, "模式与矛盾", "保留哪些不同意见", "供第4步显式引用"],
  [4, "自己先想到的点子", "理由属于具体候选", "形成时的问题依据"],
  [5, "待检验假设", "核对真实保存的原型版本", "文字计划不等于已制作"],
  [6, "用户实际说了什么", "还不能判断什么", "保留各次测试及前后版本引用"],
] as const)("keeps step %i student input, judgment and handoff explicit", (stageNumber, input, decision, handoff) => {
  renderJourney(<AidtStageJourney {...base} stageNumber={stageNumber} />);
  expect(within(screen.getByText("学生先提供").parentElement!).getByText(input, { exact: false })).toBeVisible();
  expect(within(screen.getByText("本组自己决定").parentElement!).getByText(decision, { exact: false })).toBeVisible();
  expect(within(screen.getByText("下一步带走什么").parentElement!).getByText(handoff, { exact: false })).toBeVisible();
  expect(screen.getByText("Agent可协助")).toBeVisible();
  expect(screen.getByText(/讨论由学生整理进成果/)).toBeVisible();
  expect(screen.getByTestId("aidt-journey-report-note")).toHaveTextContent(base.reportNote);
});

it("shows the formal deliverables while keeping student drafts editable", () => {
  const { rerender } = renderJourney(<AidtStageJourney {...base} stageNumber={4} />);
  expect(screen.getByText(/至少3份不同点子描述单PDF/)).toBeVisible();
  expect(screen.getByText(/草稿可编辑，不锁定阶段/)).toBeVisible();
  rerender(<AidtStageJourney {...base} stageNumber={5} />);
  expect(screen.getByText(/正式交付静态粗原型/)).toBeVisible();
  expect(screen.getByText(/方案数量由实际需要决定，不固定3个/)).toBeVisible();
  rerender(<AidtStageJourney {...base} stageNumber={6} />);
  expect(screen.getByText(/正式产出迭代后原型/)).toBeVisible();
  expect(screen.getByText(/不把推断当成用户原话/)).toBeVisible();
});

it("does not infer past work or an input source from the current draft", () => {
  renderJourney(<AidtStageJourney {...base} stageNumber={1} inputText="  " />);
  fireEvent.click(screen.getByText("本页输入与引用依据"));
  expect(screen.getByText(/不自动补造前序依据/)).toBeVisible();
  expect(screen.getByTestId("aidt-journey-previous")).toHaveTextContent("尚未保留旧稿");
  expect(screen.getByTestId("aidt-journey-previous")).not.toHaveTextContent(base.currentOutput);
  expect(screen.getByTestId("aidt-journey-current")).toHaveTextContent(base.currentOutput);
});

it("blocks keeping an empty or read-only draft, then delegates a writable draft explicitly", () => {
  const keep = vi.fn();
  const { rerender } = renderJourney(<AidtStageJourney {...base} stageNumber={6} currentOutput={" \n "} onKeepCheckpoint={keep} />);
  const button = () => screen.getByRole("button", { name: "保留当前内容作本页对照" });
  expect(button()).toBeDisabled();
  fireEvent.click(button());
  rerender(<AidtStageJourney {...base} stageNumber={6} readOnly onKeepCheckpoint={keep} />);
  expect(button()).toBeDisabled();
  fireEvent.click(button());
  expect(keep).not.toHaveBeenCalled();
  rerender(<AidtStageJourney {...base} stageNumber={6} onKeepCheckpoint={keep} />);
  expect(button()).toBeEnabled();
  fireEvent.click(button());
  expect(keep).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("aidt-journey-previous")).toHaveTextContent("尚未保留旧稿");
  expect(screen.getByText(/本页临时对照，刷新后清除/)).toBeVisible();
});

it("switches retained comparisons without replacing current work or creating a new checkpoint", () => {
  const keep = vi.fn();
  const checkpoints = [{ number: 1, text: "旧稿A的理由" }, { number: 2, text: "旧稿B的理由" }];
  renderJourney(<AidtStageJourney {...base} stageNumber={4} checkpoints={checkpoints} onKeepCheckpoint={keep} />);
  expect(screen.getByTestId("aidt-journey-previous")).toHaveTextContent("旧稿B的理由");
  const earlier = within(screen.getByRole("group", { name: "选择本页先前记录" })).getByRole("button", { name: "本页记录 1" });
  fireEvent.click(earlier);
  expect(earlier).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("aidt-journey-previous")).toHaveTextContent("旧稿A的理由");
  expect(screen.getByTestId("aidt-journey-current")).toHaveTextContent(base.currentOutput);
  expect(keep).not.toHaveBeenCalled();
  expect(checkpoints).toEqual([{ number: 1, text: "旧稿A的理由" }, { number: 2, text: "旧稿B的理由" }]);
});
