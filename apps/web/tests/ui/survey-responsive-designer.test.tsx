import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createSurveyQuestion } from "@repo/contracts/survey-question-types";
import { SurveyQuestionEditor } from "@/components/survey/live/question-editor";
import { ResponsiveDesignerPanel } from "@/components/survey/live/responsive-designer-panel";

afterEach(() => vi.unstubAllGlobals());

it("disables portaled inputs while a save is in flight", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const view = render(<ResponsiveDesignerPanel title="题目设置" enabled disabled={false}><input aria-label="面板输入" /></ResponsiveDesignerPanel>);
  fireEvent.click(screen.getByRole("button", { name: "打开题目设置" }));
  expect(screen.getByRole("textbox", { name: "面板输入" })).toBeEnabled();
  view.rerender(<ResponsiveDesignerPanel title="题目设置" enabled disabled><input aria-label="面板输入" /></ResponsiveDesignerPanel>);
  expect(screen.getByRole("textbox", { name: "面板输入" })).toBeDisabled();
});

it("opens mobile outline/settings on demand without losing selected edits", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  function Designer() {
    const [questions, setQuestions] = React.useState([
      { ...createSurveyQuestion("short", "q1", 1), title: "第一题" },
      { ...createSurveyQuestion("short", "q2", 2), title: "第二题" },
    ]);
    return <SurveyQuestionEditor studioLayout questions={questions} onChange={setQuestions} />;
  }
  render(<Designer />);
  expect(screen.queryByRole("textbox", { name: "问题内容" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "打开题目大纲" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "题目大纲" })).getByRole("button", { name: /第二题/ }));
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "打开题目设置" }));
  expect(screen.getByRole("textbox", { name: "问题内容" })).toHaveValue("第二题");
  fireEvent.change(screen.getByRole("textbox", { name: "问题内容" }), { target: { value: "更新后的第二题" } });
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(screen.queryByRole("textbox", { name: "问题内容" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "打开题目设置" }));
  expect(screen.getByRole("textbox", { name: "问题内容" })).toHaveValue("更新后的第二题");
});

it("shows the prototype's question toolbox in the desktop designer", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  render(<SurveyQuestionEditor studioLayout questions={[]} onChange={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "题型工具箱" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^单选$/ })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "题目大纲" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "问卷设计画布" })).toBeInTheDocument();
});
