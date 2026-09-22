import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FlexibleReportEditor } from "@/components/survey/report/template-editor";
import type { survey } from "@repo/contracts";
vi.mock("@/components/survey/report/report-document", () => ({
  SurveyReportDocument: () => <div>报告预览</div>,
}));
function Harness({ readonly = false }: { readonly?: boolean }) {
  const [template, setTemplate] = React.useState<survey.SurveyReportTemplate>({
    id: "template",
    title: "测试报告",
    sections: [{ id: "s1", title: "第一章", blocks: [] }],
  });
  return (
    <>
      <FlexibleReportEditor
        template={template}
        onChange={setTemplate}
        questions={[]}
        responses={[]}
        readonly={readonly}
      />
      <output data-testid="value">{JSON.stringify(template)}</output>
    </>
  );
}
describe("flexible report template", () => {
  it("adds, copies and reorders independent chapters", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "新增章节" }));
    fireEvent.change(screen.getByLabelText("章节标题"), {
      target: { value: "第二章" },
    });
    fireEvent.click(screen.getByRole("button", { name: "复制章节" }));
    const data = JSON.parse(screen.getByTestId("value").textContent!);
    expect(data.sections).toHaveLength(3);
    expect(new Set(data.sections.map((s: { id: string }) => s.id)).size).toBe(
      3,
    );
    fireEvent.click(screen.getByRole("button", { name: "章节上移" }));
    expect(
      JSON.parse(screen.getByTestId("value").textContent!).sections[1].title,
    ).toBe("第二章 副本");
  });
  it("allows mixed content blocks and editable text", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "添加文字说明" }));
    fireEvent.change(screen.getByLabelText("正文"), {
      target: { value: "实际分析说明" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加数据表" }));
    const blocks = JSON.parse(screen.getByTestId("value").textContent!)
      .sections[0].blocks;
    expect(blocks.map((b: { type: string }) => b.type)).toEqual([
      "text",
      "table",
    ]);
    expect(blocks[0].text).toBe("实际分析说明");
  });
  it("does not expose mutations in readonly mode", () => {
    render(<Harness readonly />);
    expect(screen.queryByRole("button", { name: "新增章节" })).toBeNull();
    expect(screen.getByLabelText("报告标题")).toHaveProperty("readOnly", true);
  });
});

import { createSurveyQuestion } from "@repo/contracts/survey-question-types";
function TypedHarness() {
  const questions = [
    createSurveyQuestion("short", "text", 1),
    createSurveyQuestion("nps", "nps", 2),
    createSurveyQuestion("description", "layout", 3),
  ];
  const [template, setTemplate] = React.useState<survey.SurveyReportTemplate>({
    id: "t",
    title: "t",
    sections: [
      {
        id: "s",
        title: "s",
        blocks: [
          {
            id: "b",
            type: "table",
            title: "b",
            questionIds: [],
            statistic: "mean",
            samplePolicy: "valid",
            minGroupSize: 5,
          },
        ],
      },
    ],
  });
  return (
    <>
      <FlexibleReportEditor
        template={template}
        onChange={setTemplate}
        questions={questions}
        responses={[]}
      />
      <output data-testid="typed-template">{JSON.stringify(template)}</output>
    </>
  );
}
it("offers only supported statistics and never binds page elements", () => {
  render(<TypedHarness />);
  expect(
    screen.queryByRole("checkbox", { name: /说明文字/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "1. 单行文本" }));
  expect(screen.getByLabelText("统计口径")).toHaveValue("responses");
  expect(
    screen.queryByRole("option", { name: "均值" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "1. 单行文本" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "2. NPS" }));
  expect(screen.getByLabelText("统计口径")).toHaveValue("nps");
  expect(
    screen.getByRole("option", { name: "选择比例（%）" }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("统计口径"), {
    target: { value: "percentage" },
  });
  expect(
    JSON.parse(screen.getByTestId("typed-template").textContent!).sections[0]
      .blocks[0].statistic,
  ).toBe("percentage");
});
