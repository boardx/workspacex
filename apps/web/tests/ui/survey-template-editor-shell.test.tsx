import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SurveyTemplateEditorShell } from "@/components/survey/templates/survey-template-editor-shell";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  cleanup();
  push.mockReset();
});

describe("SurveyTemplateEditorShell", () => {
  it("呈现独立报告模块编辑器并返回报告模块列表", () => {
    render(<SurveyTemplateEditorShell templateId="tpl-digital-collaboration" />);

    expect(screen.getByTestId("survey-template-editor-shell")).toBeInTheDocument();
    expect(screen.queryByText("BoardX Survey")).not.toBeInTheDocument();
    expect(screen.getByTestId("survey-template-editor")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("survey-template-back-to-list"));
    expect(push).toHaveBeenCalledWith("/studio/survey?tab=reports");
  });

  it("按报告模块 ID 加载对应标题和章节数量", () => {
    render(<SurveyTemplateEditorShell templateId="tpl-team-health" />);

    expect(screen.getByRole("heading", { name: "团队协作健康度报告模块" })).toBeInTheDocument();
    expect(screen.getByText(/6 个报告章节/)).toBeInTheDocument();
    expect(screen.getAllByTestId(/^survey-template-section-(?!list$)/)).toHaveLength(6);
  });
});
