import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SurveyDraftInput } from "@repo/contracts/survey-runtime";
import type { SurveyLibraryTemplate } from "@repo/contracts/survey-template-library";
import { SurveyTemplateActions } from "@/components/survey/library/template-actions";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/survey/runtime-client", () => ({ surveyRequest: request }));
const draft = (): SurveyDraftInput => ({
  title: "当前问卷",
  questions: [
    {
      id: "destination-scale",
      chapterId: "chapter",
      order: 1,
      type: "scale",
      title: "当前满意度",
      required: true,
      options: ["1", "2", "3"],
    },
    {
      id: "destination-group",
      chapterId: "chapter",
      order: 2,
      type: "single",
      title: "当前部门",
      required: true,
      options: ["甲", "乙"],
    },
  ],
  template: { id: "current-template", title: "当前报告", sections: [] },
});
const template = (
  kind: "question" | "report" = "question",
): SurveyLibraryTemplate => ({
  id: "source",
  kind,
  title: "团队模板",
  description: "复用配置",
  version: 2,
  updatedAt: "2026-09-21T00:00:00.000Z",
  questions: [
    {
      id: "source-scale",
      chapterId: "chapter",
      order: 1,
      type: "scale",
      title: "参考满意度",
      required: true,
      options: ["1", "2", "3"],
    },
    {
      id: "source-group",
      chapterId: "chapter",
      order: 2,
      type: "single",
      title: "参考部门",
      required: true,
      options: ["甲", "乙"],
    },
  ],
  template: {
    id: "source-template",
    title: "参考报告",
    sections: [
      {
        id: "source-section",
        title: "分析",
        blocks: [
          {
            id: "source-block",
            type: "table",
            title: "部门满意度",
            questionIds: ["source-scale"],
            groupByQuestionId: "source-group",
            statistic: "mean",
            samplePolicy: "valid",
            minGroupSize: 5,
          },
        ],
      },
    ],
  },
});
beforeEach(() => {
  request.mockReset();
  vi.restoreAllMocks();
});
describe("survey template actions", () => {
  it("keeps the name when a save response cannot confirm the requested template kind", async () => {
    request.mockResolvedValueOnce(template("report"));
    render(
      <SurveyTemplateActions
        kind="question"
        draft={draft()}
        onApply={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "保存为问卷模板" }));
    fireEvent.change(screen.getByLabelText("保存模板名称"), {
      target: { value: "待核对模板" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存到模板库" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "模板保存结果无法确认",
    );
    expect(screen.getByLabelText("保存模板名称")).toHaveValue("待核对模板");
    expect(screen.queryByText("已保存到问卷模板库")).not.toBeInTheDocument();
  });
  it("posts only template configuration, excluding survey responses and publication metadata", async () => {
    request.mockResolvedValueOnce(template());
    const current = {
      ...draft(),
      responses: [{ id: "private-response" }],
      publication: { token: "private-token" },
      report: { issues: [] },
    };
    const onApply = vi.fn();
    render(
      <SurveyTemplateActions
        kind="question"
        draft={current}
        onApply={onApply}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "保存为问卷模板" }));
    fireEvent.change(screen.getByLabelText("保存模板名称"), {
      target: { value: "独立保存模板" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存到模板库" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "已保存到问卷模板库",
    );
    expect(request).toHaveBeenCalledWith("/surveys/templates", {
      method: "POST",
      body: {
        kind: "question",
        title: "独立保存模板",
        description: "",
        questions: current.questions,
        template: current.template,
      },
    });
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("retains entered name and draft after a rejected save and retries the same input", async () => {
    request
      .mockRejectedValueOnce(new Error("保存失败，请重试"))
      .mockResolvedValueOnce(template());
    const current = draft(),
      onApply = vi.fn(),
      before = JSON.stringify(current);
    render(
      <SurveyTemplateActions
        kind="question"
        draft={current}
        onApply={onApply}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "保存为问卷模板" }));
    fireEvent.change(screen.getByLabelText("保存模板名称"), {
      target: { value: "仍需保存" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存到模板库" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
    expect(screen.getByLabelText("保存模板名称")).toHaveValue("仍需保存");
    expect(JSON.stringify(current)).toBe(before);
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存到模板库" }));
    await screen.findByRole("status");
    expect(request.mock.calls[1]).toEqual(request.mock.calls[0]);
  });
  it("applies an independent question/template copy only after replacement confirmation", async () => {
    const source = template(),
      current = draft(),
      onApply = vi.fn();
    request.mockResolvedValueOnce([source]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <SurveyTemplateActions
        kind="question"
        draft={current}
        onApply={onApply}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "使用问卷模板" }));
    fireEvent.change(await screen.findByLabelText("选择问卷模板"), {
      target: { value: source.id },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用模板" }));
    expect(onApply).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "应用模板" }));
    const applied = onApply.mock.calls[0]![0] as SurveyDraftInput;
    expect(applied.title).toBe(current.title);
    expect(applied.questions).toEqual(source.questions);
    expect(applied.questions).not.toBe(source.questions);
    expect(applied.template).toEqual(source.template);
    applied.questions[0]!.title = "副本改名";
    applied.template.sections[0]!.blocks[0]!.questionIds.push("new-reference");
    expect(source.questions[0]!.title).toBe("参考满意度");
    expect(source.template.sections[0]!.blocks[0]!.questionIds).toEqual([
      "source-scale",
    ]);
    expect(current.questions[0]!.id).toBe("destination-scale");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("requires explicit bindings for report question and group references while preserving current questions", async () => {
    const source = template("report"),
      current = draft(),
      onApply = vi.fn();
    request.mockResolvedValueOnce([source]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <SurveyTemplateActions kind="report" draft={current} onApply={onApply} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "使用报告模板" }));
    fireEvent.change(await screen.findByLabelText("选择报告模板"), {
      target: { value: source.id },
    });
    expect(screen.getByRole("button", { name: "应用模板" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("对应题目：参考满意度"), {
      target: { value: "destination-scale" },
    });
    expect(screen.getByRole("button", { name: "应用模板" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("对应题目：参考部门"), {
      target: { value: "destination-group" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用模板" }));
    const applied = onApply.mock.calls[0]![0] as SurveyDraftInput;
    expect(applied.questions).toBe(current.questions);
    expect(applied.title).toBe(current.title);
    expect(applied.template.id).not.toBe(source.template.id);
    expect(applied.template.sections[0]!.blocks[0]).toMatchObject({
      questionIds: ["destination-scale"],
      groupByQuestionId: "destination-group",
    });
    expect(source.template.sections[0]!.blocks[0]).toMatchObject({
      questionIds: ["source-scale"],
      groupByQuestionId: "source-group",
    });
  });
  it("prevents published question replacement but still permits saving its configuration as a template", () => {
    render(
      <SurveyTemplateActions
        kind="question"
        draft={draft()}
        onApply={vi.fn()}
        locked
      />,
    );
    expect(screen.getByRole("button", { name: "使用问卷模板" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "使用问卷模板" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "保存为问卷模板" }),
    ).toBeEnabled();
  });
  it("rejects wrong-kind library rows instead of offering them for replacement", async () => {
    request.mockResolvedValueOnce([template("report")]);
    render(
      <SurveyTemplateActions
        kind="question"
        draft={draft()}
        onApply={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "使用问卷模板" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("模板数据");
    expect(screen.queryByLabelText("选择问卷模板")).not.toBeInTheDocument();
  });
  it("disables an already-open application dialog while the parent is saving", async () => {
    request.mockResolvedValueOnce([template()]);
    const current = draft(),
      onApply = vi.fn();
    const { rerender } = render(
      <SurveyTemplateActions
        kind="question"
        draft={current}
        onApply={onApply}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "使用问卷模板" }));
    fireEvent.change(await screen.findByLabelText("选择问卷模板"), {
      target: { value: "source" },
    });
    rerender(
      <SurveyTemplateActions
        kind="question"
        draft={current}
        onApply={onApply}
        disabled
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "应用模板" })).toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "应用模板" }));
    expect(onApply).not.toHaveBeenCalled();
  });
});

it("超限模板在客户端明确提示且不发送请求，输入保留", async () => {
  const data=draft();
  data.questions[1]!.options=Array.from({length:60},()=>"中".repeat(1000));
  render(<SurveyTemplateActions kind="question" draft={data} onApply={vi.fn()} />);
  fireEvent.click(screen.getByRole("button",{name:"保存为问卷模板"}));
  fireEvent.click(screen.getByRole("button",{name:"保存到模板库"}));
  expect(await screen.findByRole("alert")).toHaveTextContent(/90/);
  expect(screen.getByLabelText("保存模板名称")).toHaveValue("当前问卷");
  expect(request).not.toHaveBeenCalled();
});
