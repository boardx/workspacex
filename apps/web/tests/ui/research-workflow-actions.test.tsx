import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkflowActionButton } from "@/components/research-studio/research-workflow-actions";

describe("shared research/interview workflow commands", () => {
  it("blocks repeated activation during loading without changing its accessible action name", () => {
    const onClick = vi.fn();
    const { rerender } = render(<WorkflowActionButton loading onClick={onClick}>确认并继续</WorkflowActionButton>);
    const action = screen.getByRole("button", { name: "确认并继续" });
    expect(action).toBeDisabled(); expect(action).toHaveAttribute("aria-busy", "true");
    fireEvent.click(action); expect(onClick).not.toHaveBeenCalled();
    rerender(<WorkflowActionButton onClick={onClick}>确认并继续</WorkflowActionButton>);
    fireEvent.click(action); expect(onClick).toHaveBeenCalledOnce();
  });
  it("retains the domain's disabled condition after loading finishes", () => {
    const { rerender } = render(<WorkflowActionButton loading disabled>生成报告</WorkflowActionButton>);
    rerender(<WorkflowActionButton disabled>生成报告</WorkflowActionButton>);
    expect(screen.getByRole("button", { name: "生成报告" })).toBeDisabled();
  });
  it("preserves an explicit submit action and forwards the real button ref", () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<WorkflowActionButton type="submit" ref={ref}>保存</WorkflowActionButton>);
    expect(ref.current).toBe(screen.getByRole("button", { name: "保存" }));
    expect(ref.current).toHaveAttribute("type", "submit");
  });
  it("preserves asChild links while loading prevents navigation and both click callbacks", () => {
    const parentClick = vi.fn(), childClick = vi.fn((event: React.MouseEvent) => event.preventDefault());
    const { rerender } = render(<WorkflowActionButton asChild loading onClick={parentClick}><a href="/research" onClick={childClick}>返回列表</a></WorkflowActionButton>);
    const link = screen.getByRole("link", { name: "返回列表" });
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(fireEvent.click(link)).toBe(false);
    expect(parentClick).not.toHaveBeenCalled(); expect(childClick).not.toHaveBeenCalled();
    rerender(<WorkflowActionButton asChild onClick={parentClick}><a href="/research" onClick={childClick}>返回列表</a></WorkflowActionButton>);
    fireEvent.click(link); expect(parentClick).toHaveBeenCalledOnce(); expect(childClick).toHaveBeenCalledOnce();
  });
});
