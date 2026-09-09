import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelImpactPreview } from "@/components/ai-capability-studio/model-impact-preview";

describe("model impact preview", () => {
  it("blocks unknown, failed, and stale reference snapshots", () => {
    const onDisable = vi.fn();
    const { rerender } = render(<ModelImpactPreview revision={1} enabled onDisable={onDisable} />);
    expect(screen.getByTestId("model-disable-review")).toBeDisabled();
    expect(screen.getByTestId("model-references-unknown")).toHaveTextContent("数量未知");
    fireEvent.click(screen.getByText("读取演示引用清单"));
    expect(screen.getByTestId("model-disable-review")).not.toBeDisabled();
    rerender(<ModelImpactPreview revision={2} enabled onDisable={onDisable} />);
    expect(screen.getByTestId("model-disable-review")).toBeDisabled();
    expect(screen.getByTestId("model-references")).toHaveTextContent("快照已过期");
    fireEvent.click(screen.getByText("模拟引用读取失败"));
    expect(screen.getByTestId("model-references-unknown")).toHaveTextContent("引用读取失败");
    expect(onDisable).not.toHaveBeenCalled();
  });
  it.each(["interrupt", "drain"] as const)("requires explicit %s confirmation and removes disabled model from new choices", mode => {
    const onDisable = vi.fn();
    const { rerender } = render(<ModelImpactPreview revision={1} enabled onDisable={onDisable} />);
    fireEvent.click(screen.getByText("读取演示引用清单"));
    fireEvent.click(screen.getByTestId("model-disable-review"));
    expect(screen.getByTestId("model-disable-dialog-confirm")).toBeDisabled();
    fireEvent.click(screen.getByTestId(`model-disable-dialog-mode-${mode}`));
    fireEvent.change(screen.getByLabelText("理由（必填，写入审计）"), { target: { value: "演示版本下线" } });
    fireEvent.click(screen.getByTestId("model-disable-dialog-confirm"));
    expect(onDisable).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("model-disable-outcome")).toHaveTextContent(mode === "interrupt" ? "被中断" : "继续当前一轮");
    rerender(<ModelImpactPreview revision={1} enabled={false} onDisable={onDisable} />);
    expect(screen.getByTestId("model-new-task-selector")).toBeDisabled();
    expect(screen.getByTestId("model-composite-members")).toHaveTextContent("不可用，阻塞组合模型启用");
    rerender(<ModelImpactPreview revision={1} enabled onDisable={onDisable} />);
    expect(screen.getByTestId("model-disable-review")).toBeDisabled();
    expect(screen.queryByTestId("model-disable-outcome")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("读取演示引用清单"));
    expect(screen.getByTestId("model-disable-review")).not.toBeDisabled();
  });
});
