import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SurveyTemplateWorkspace } from "@/components/survey/library/template-workspace";
import { SurveyTemplateActions } from "@/components/survey/library/template-actions";
import {
  getBuiltinSurveyTemplate,
  getBuiltinSurveyTemplates,
} from "@/lib/survey/builtin-templates";
import { requiredTemplateQuestions } from "@/lib/survey/template-reuse";
import type { SurveyDraftInput } from "@repo/contracts/survey-runtime";
const request = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("@/lib/survey/runtime-client", () => ({ surveyRequest: request }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  request.mockReset();
  router.push.mockReset();
  router.replace.mockReset();
  vi.restoreAllMocks();
});
const emptyDraft = (): SurveyDraftInput => ({
  title: "我的问卷",
  questions: [],
  template: { id: "empty", title: "空报告", sections: [] },
});
describe("builtin template integration", () => {
  it("loads a builtin without an API request and treats its unchanged configuration as clean", async () => {
    const source = getBuiltinSurveyTemplates("question")[0]!;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<SurveyTemplateWorkspace templateId={source.id} kind="question" />);
    await screen.findByDisplayValue(source.title);
    expect(request).not.toHaveBeenCalled();
    expect(screen.queryByText("有未保存修改")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "保存为我的模板" }),
    ).toBeEnabled();
    expect(screen.getByText(/内置模板不会被更改/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回模板列表" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith("/studio/survey?tab=modules");
  });
  it("saves an unchanged builtin using POST as an independent personal template", async () => {
    const source = getBuiltinSurveyTemplates("question")[0]!;
    request.mockResolvedValueOnce({
      ...source,
      id: "personal-copy",
      version: 1,
      updatedAt: "2026-09-21T00:00:00.000Z",
    });
    render(<SurveyTemplateWorkspace templateId={source.id} kind="question" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "保存为我的模板" }),
    );
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        "/studio/survey/question-templates/personal-copy",
      ),
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]).toEqual([
      "/surveys/templates",
      {
        method: "POST",
        body: {
          kind: source.kind,
          title: source.title,
          description: source.description,
          questions: source.questions,
          template: source.template,
        },
      },
    ]);
    expect(getBuiltinSurveyTemplate(source.id, "question")).toEqual(source);
  });
  it("retains failed builtin edits without mutating the catalog", async () => {
    const source = getBuiltinSurveyTemplates("question")[0]!;
    request.mockRejectedValueOnce(new Error("网络中断，请重试"));
    render(<SurveyTemplateWorkspace templateId={source.id} kind="question" />);
    await screen.findByDisplayValue(source.title);
    fireEvent.change(screen.getByLabelText("模板名称"), {
      target: { value: "我的改进版" },
    });
    fireEvent.change(screen.getByLabelText("问题内容"), {
      target: { value: "修改的问题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存为我的模板" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("网络中断");
    expect(screen.getByLabelText("模板名称")).toHaveValue("我的改进版");
    expect(screen.getByLabelText("问题内容")).toHaveValue("修改的问题");
    expect(screen.getByText("有未保存修改")).toBeInTheDocument();
    expect(getBuiltinSurveyTemplate(source.id, "question")).toEqual(source);
  });
  it.each(["builtin-not-found", "builtin-tpl-team-health"])(
    "rejects unavailable or wrong-kind builtin %s without a personal API fallback",
    async (id) => {
      render(<SurveyTemplateWorkspace templateId={id} kind="question" />);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        /内置模板.*不存在|内置模板.*类型/,
      );
      expect(request).not.toHaveBeenCalled();
      expect(screen.queryByLabelText("问题内容")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "保存为我的模板" }),
      ).toBeDisabled();
    },
  );
  it("keeps builtin application available after personal loading fails, preserving its error and retry", async () => {
    request.mockRejectedValueOnce(new Error("个人模板暂时无法加载"));
    const source = getBuiltinSurveyTemplates("question")[0]!,
      onApply = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <SurveyTemplateActions
        kind="question"
        draft={emptyDraft()}
        onApply={onApply}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "使用问卷模板" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "个人模板暂时无法加载",
    );
    fireEvent.change(screen.getByLabelText("选择问卷模板"), {
      target: { value: source.id },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("个人模板暂时无法加载");
    expect(screen.getByRole("button", { name: "重试加载" })).toBeEnabled();
    expect(screen.getByRole("group", { name: "内置模板" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "应用模板" }));
    const applied = onApply.mock.calls[0]![0] as SurveyDraftInput;
    expect(applied.questions).toEqual(source.questions);
    applied.questions[0]!.title = "副本题目";
    expect(getBuiltinSurveyTemplate(source.id, "question")).toEqual(source);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("requires explicit destination bindings for builtin reports", async () => {
    const source = getBuiltinSurveyTemplates("report")[0]!;
    const current: SurveyDraftInput = {
      ...emptyDraft(),
      questions: source.questions.map((q, i) => ({
        ...q,
        id: `destination-${i}`,
      })),
    };
    request.mockResolvedValueOnce([]);
    const onApply = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <SurveyTemplateActions kind="report" draft={current} onApply={onApply} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "使用报告模板" }));
    fireEvent.change(await screen.findByLabelText("选择报告模板"), {
      target: { value: source.id },
    });
    const refs = requiredTemplateQuestions(source.template);
    expect(refs.length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "应用模板" })).toBeDisabled();
    for (const ref of refs) {
      const index = source.questions.findIndex((q) => q.id === ref);
      fireEvent.change(
        screen.getByLabelText(`对应题目：${source.questions[index]!.title}`),
        { target: { value: `destination-${index}` } },
      );
    }
    fireEvent.click(screen.getByRole("button", { name: "应用模板" }));
    const applied = onApply.mock.calls[0]![0] as SurveyDraftInput;
    expect(applied.questions).toBe(current.questions);
    expect(requiredTemplateQuestions(applied.template)).toEqual(
      refs.map(
        (ref) =>
          `destination-${source.questions.findIndex((q) => q.id === ref)}`,
      ),
    );
    expect(applied.template.id).not.toBe(source.template.id);
    expect(getBuiltinSurveyTemplate(source.id, "report")).toEqual(source);
  });
});
