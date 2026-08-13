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
  it("呈现独立模板编辑器并返回模板列表", () => {
    render(<SurveyTemplateEditorShell templateId="tpl-digital-collaboration" />);

    expect(screen.getByTestId("survey-template-editor-shell")).toBeInTheDocument();
    expect(screen.getByTestId("survey-template-editor")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("survey-template-back-to-list"));
    expect(push).toHaveBeenCalledWith("/studio/survey?tab=templates");
  });
});
