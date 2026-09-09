import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceAdaptationPreview } from "@/components/ai-capability-studio/source-adaptation-preview";

describe("ordinary repository adaptation preview", () => {
  it("requires a file review and keeps unselected source scripts outside the new draft", () => {
    render(<SourceAdaptationPreview />);
    expect(screen.getByTestId("adaptation-create")).toBeDisabled();
    fireEvent.click(screen.getByTestId("adaptation-review"));
    fireEvent.click(screen.getByTestId("adaptation-create"));
    expect(screen.getByTestId("adaptation-draft")).toHaveTextContent("references/imported/README.md");
    expect(screen.getByTestId("adaptation-draft")).not.toHaveTextContent("references/imported/analyze.py");
    expect(screen.getByTestId("adaptation-draft")).toHaveTextContent("当前没有可运行版本");
    expect(screen.getByTestId("adaptation-create")).toBeDisabled();
  });
  it("revokes file confirmation after a changed selection and only stores scripts as references", () => {
    render(<SourceAdaptationPreview />);
    fireEvent.click(screen.getByTestId("adaptation-review"));
    fireEvent.click(screen.getByRole("checkbox", { name: /analyze.py/ }));
    expect(screen.getByTestId("adaptation-review")).not.toBeChecked();
    expect(screen.getByTestId("adaptation-create")).toBeDisabled();
    fireEvent.click(screen.getByTestId("adaptation-review"));
    fireEvent.click(screen.getByTestId("adaptation-create"));
    expect(screen.getByTestId("adaptation-draft")).toHaveTextContent("references/imported/analyze.py");
    fireEvent.change(screen.getByLabelText("编辑 SKILL.md"), { target: { value: "Reviewed instructions" } });
    fireEvent.click(screen.getByText("保留本页修改"));
    expect(screen.getByRole("status")).toHaveTextContent("尚未持久化");
  });
});
