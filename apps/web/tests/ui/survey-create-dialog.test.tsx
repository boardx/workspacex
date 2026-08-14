import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SurveyCreateDialog } from "@/components/survey/resource-library/survey-create-dialog";

afterEach(cleanup);

describe("SurveyCreateDialog", () => {
  it("空白问卷要求名称并提交规范化的多个标签", () => {
    const onCreate = vi.fn();
    render(<SurveyCreateDialog open mode="blank" onOpenChange={vi.fn()} onCreate={onCreate} />);

    expect(screen.getByRole("button", { name: "创建问卷" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("问卷名称"), { target: { value: "  季度协作调查  " } });
    const tagInput = screen.getByLabelText("标签（可选）");
    fireEvent.change(tagInput, { target: { value: "协作" } });
    fireEvent.keyDown(tagInput, { key: "Enter" });
    fireEvent.change(tagInput, { target: { value: "内部," } });
    fireEvent.keyDown(tagInput, { key: "," });
    fireEvent.change(tagInput, { target: { value: "协作" } });
    fireEvent.keyDown(tagInput, { key: "Enter" });

    expect(screen.getAllByTestId("survey-create-tag")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "创建问卷" }));

    expect(onCreate).toHaveBeenCalledWith({ name: "季度协作调查", tags: ["协作", "内部"] });
  });

  it("可以移除标签且关闭后重置草稿", () => {
    const onOpenChange = vi.fn();
    const view = render(<SurveyCreateDialog open mode="blank" onOpenChange={onOpenChange} onCreate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("问卷名称"), { target: { value: "临时问卷" } });
    fireEvent.change(screen.getByLabelText("标签（可选）"), { target: { value: "临时" } });
    fireEvent.keyDown(screen.getByLabelText("标签（可选）"), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "删除标签 临时" }));
    expect(screen.queryByTestId("survey-create-tag")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    view.rerender(<SurveyCreateDialog open={false} mode="blank" onOpenChange={onOpenChange} onCreate={vi.fn()} />);
    view.rerender(<SurveyCreateDialog open mode="blank" onOpenChange={onOpenChange} onCreate={vi.fn()} />);
    expect(screen.getByLabelText("问卷名称")).toHaveValue("");
  });

  it("模块创建保留元数据并且只能选择一个模块", () => {
    const onCreate = vi.fn();
    render(<SurveyCreateDialog open mode="module" onOpenChange={vi.fn()} onCreate={onCreate} />);
    fireEvent.change(screen.getByLabelText("问卷名称"), { target: { value: "能力诊断" } });
    fireEvent.change(screen.getByLabelText("标签（可选）"), { target: { value: "诊断" } });
    fireEvent.keyDown(screen.getByLabelText("标签（可选）"), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.getByRole("heading", { name: "选择问卷模块" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "使用所选模块创建" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /组织画像/ }));
    fireEvent.click(screen.getByRole("button", { name: /战略治理/ }));
    expect(screen.getByRole("button", { name: /组织画像/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /战略治理/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "返回上一步" }));
    expect(screen.getByLabelText("问卷名称")).toHaveValue("能力诊断");
    expect(screen.getByText("诊断")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "使用所选模块创建" }));

    expect(onCreate).toHaveBeenCalledWith({ name: "能力诊断", tags: ["诊断"], sourceModuleId: "strategy" });
  });
});
