import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createSurveyQuestion } from "@repo/contracts/survey-question-types";
import { SurveyQuestionEditor } from "@/components/survey/live/question-editor";

afterEach(() => vi.unstubAllGlobals());

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
