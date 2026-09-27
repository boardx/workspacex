import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MarkdownSurveyEditor } from "@/components/survey/live/markdown-survey-editor";

it("reviews Markdown before explicitly applying it to the survey", () => {
  const apply = vi.fn();
  render(<MarkdownSurveyEditor value="# 客户调查\n\n## q1 [open]\n您的建议？" locked={false} onChange={vi.fn()} onPreview={apply} />);
  fireEvent.click(screen.getByRole("button", { name: "校对并预览题目" }));
  expect(screen.getByRole("dialog", { name: "Markdown 预览与校对" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "问卷渲染预览" })).toHaveTextContent("您的建议？");
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "应用到问卷" }));
  expect(apply).toHaveBeenCalledOnce();
});
