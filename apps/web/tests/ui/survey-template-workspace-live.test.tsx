import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SurveyLibraryTemplate } from "@repo/contracts/survey-template-library";
import { SurveyTemplateWorkspace } from "@/components/survey/library/template-workspace";
const request = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("@/lib/survey/runtime-client", () => ({ surveyRequest: request }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const row = (
  patch: Partial<SurveyLibraryTemplate> = {},
): SurveyLibraryTemplate => ({
  id: "saved",
  kind: "question",
  title: "已存模板",
  description: "模板说明",
  version: 3,
  updatedAt: "2026-09-21T00:00:00.000Z",
  questions: [
    {
      id: "q",
      order: 1,
      chapterId: "general",
      type: "single",
      title: "体验题",
      required: true,
      options: ["好", "一般"],
    },
  ],
  template: { id: "report", title: "配套报告", sections: [] },
  ...patch,
});
beforeEach(() => {
  request.mockReset();
  router.push.mockReset();
  router.replace.mockReset();
  vi.restoreAllMocks();
});
describe("persisted template workspace", () => {
  it("saves conflicted local edits as a new entity without updating the source", async () => {
    request
      .mockResolvedValueOnce(row())
      .mockRejectedValueOnce(new Error("版本冲突，修改仍保留"))
      .mockResolvedValueOnce(
        row({ id: "rescued-copy", title: "本地修改 副本", version: 1 }),
      );
    render(<SurveyTemplateWorkspace templateId="saved" kind="question" />);
    await screen.findByDisplayValue("已存模板");
    fireEvent.change(screen.getByLabelText("模板名称"), {
      target: { value: "本地修改" },
    });
    fireEvent.change(screen.getByLabelText("问题内容"), {
      target: { value: "待保留题目" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存模板" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "另存副本" }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        "/studio/survey/question-templates/rescued-copy",
      ),
    );
    expect(request.mock.calls[2]).toEqual([
      "/surveys/templates",
      {
        method: "POST",
        body: {
          kind: "question",
          title: "本地修改 副本",
          description: "模板说明",
          questions: [{ ...row().questions[0], title: "待保留题目" }],
          template: row().template,
        },
      },
    ]);
    expect(request.mock.calls[2]![1].body).not.toHaveProperty(
      "expectedVersion",
    );
  });
  it("refuses a detail payload belonging to the other template kind", async () => {
    request.mockResolvedValueOnce(row({ kind: "report" }));
    render(<SurveyTemplateWorkspace templateId="saved" kind="question" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "模板类型不匹配",
    );
    expect(screen.queryByLabelText("问题内容")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存模板" })).toBeDisabled();
  });
  it("retains edited fields and questions after a failed save with the expected version", async () => {
    request
      .mockResolvedValueOnce(row())
      .mockRejectedValueOnce(new Error("版本冲突，修改仍保留"));
    render(<SurveyTemplateWorkspace templateId="saved" kind="question" />);
    await screen.findByDisplayValue("已存模板");
    fireEvent.change(screen.getByLabelText("模板名称"), {
      target: { value: "待保存名称" },
    });
    fireEvent.change(screen.getByLabelText("问题内容"), {
      target: { value: "修改后的体验题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存模板" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("版本冲突");
    expect(screen.getByLabelText("模板名称")).toHaveValue("待保存名称");
    expect(screen.getByLabelText("问题内容")).toHaveValue("修改后的体验题");
    expect(screen.getByText("有未保存修改")).toBeInTheDocument();
    expect(screen.queryByText("模板已保存")).not.toBeInTheDocument();
    expect(request).toHaveBeenLastCalledWith(
      "/surveys/templates/saved",
      expect.objectContaining({
        method: "PUT",
        body: expect.objectContaining({
          expectedVersion: 3,
          title: "待保存名称",
          questions: [expect.objectContaining({ title: "修改后的体验题" })],
        }),
      }),
    );
  });
  it("saves the full configuration and reloads canonical data from the persisted detail endpoint", async () => {
    request
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row({ title: "服务端规范名称", version: 4 }));
    const { unmount } = render(
      <SurveyTemplateWorkspace templateId="saved" kind="question" />,
    );
    await screen.findByDisplayValue("已存模板");
    fireEvent.change(screen.getByLabelText("模板名称"), {
      target: { value: "新名称" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存模板" }));
    await screen.findByText("模板已保存");
    expect(screen.getByLabelText("模板名称")).toHaveValue("服务端规范名称");
    expect(screen.getByRole("button", { name: "保存模板" })).toBeDisabled();
    expect(request.mock.calls[1]![1].body.template).toEqual(row().template);
    unmount();
    request.mockResolvedValueOnce(row({ title: "服务端规范名称", version: 4 }));
    render(<SurveyTemplateWorkspace templateId="saved" kind="question" />);
    await screen.findByDisplayValue("服务端规范名称");
    expect(request).toHaveBeenLastCalledWith("/surveys/templates/saved");
    fireEvent.click(screen.getByRole("tab", { name: "报告配置" }));
    expect(screen.getByLabelText("报告标题")).toHaveValue("配套报告");
  });
  it("creates a new empty template without seeded questions and routes to the persisted entity", async () => {
    request.mockResolvedValueOnce(
      row({ id: "created", title: "新模板", version: 1 }),
    );
    render(<SurveyTemplateWorkspace templateId="new" kind="question" />);
    await screen.findByLabelText("模板名称");
    expect(request).not.toHaveBeenCalled();
    expect(
      screen.getByText("添加第一道题目，开始设计问卷。"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("模板名称"), {
      target: { value: "新模板" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新增题目" }));
    fireEvent.click(screen.getByRole("button", { name: "保存模板" }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        "/studio/survey/question-templates/created",
      ),
    );
    expect(request).toHaveBeenCalledWith(
      "/surveys/templates",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ kind: "question", title: "新模板" }),
      }),
    );
    expect(request.mock.calls[0]![1].body).not.toHaveProperty("responses");
    expect(request.mock.calls[0]![1].body).not.toHaveProperty("publication");
  });
  it("protects unsaved edits when returning to the library", async () => {
    request.mockResolvedValueOnce(row());
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<SurveyTemplateWorkspace templateId="saved" kind="question" />);
    await screen.findByDisplayValue("已存模板");
    fireEvent.change(screen.getByLabelText("模板名称"), {
      target: { value: "不丢失" },
    });
    fireEvent.click(screen.getByRole("button", { name: "返回模板列表" }));
    expect(window.confirm).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("模板名称")).toHaveValue("不丢失");
  });
  it("edits report reference questions and preserves them alongside the report template", async () => {
    request
      .mockResolvedValueOnce(row({ kind: "report" }))
      .mockResolvedValueOnce(row({ kind: "report", version: 4 }));
    render(<SurveyTemplateWorkspace templateId="saved" kind="report" />);
    await screen.findByLabelText("报告标题");
    fireEvent.click(screen.getByRole("tab", { name: "题目配置" }));
    fireEvent.change(screen.getByLabelText("问题内容"), {
      target: { value: "参考量表题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存模板" }));
    await screen.findByText("模板已保存");
    expect(request.mock.calls[1]![1].body).toMatchObject({
      kind: "report",
      questions: [expect.objectContaining({ id: "q", title: "参考量表题" })],
      template: row().template,
    });
  });
});
