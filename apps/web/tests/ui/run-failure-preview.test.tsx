import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RunFailurePreview } from "@/components/ai-capability-studio/run-failure-preview";

describe("run failure attribution preview", () => {
  it("compares historical/current revisions without inventing historical configuration", () => {
    render(<RunFailurePreview currentModelRevision={3} />);
    fireEvent.click(screen.getByText("查看本次模型配置"));
    expect(screen.getByTestId("failure-model-reference")).toHaveTextContent("运行使用 r1 / 当前 r3");
    expect(screen.getByTestId("failure-model-reference")).toHaveTextContent("旧运行失败不代表当前配置仍然失败");
    fireEvent.click(screen.getByText("查看本次 MCP 快照"));
    expect(screen.getByTestId("failure-mcp-reference")).toHaveTextContent("不根据该引用猜测服务器或工具");
  });
  it("hides navigation when references are absent and reference details when access is denied", () => {
    render(<RunFailurePreview currentModelRevision={1} />);
    fireEvent.click(screen.getByText("模拟缺少依赖引用"));
    expect(screen.queryByText("查看本次模型配置")).not.toBeInTheDocument();
    expect(screen.queryByText("查看本次 MCP 快照")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("模拟引用无权限"));
    expect(screen.getByRole("alert")).toHaveTextContent("不可访问或不存在");
    expect(screen.queryByText(/run-preview-01/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
