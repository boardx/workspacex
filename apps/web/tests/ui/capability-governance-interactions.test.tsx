import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CapabilityGovernancePreview } from "@/components/ai-capability-studio/governance-preview";
import { admissionItems } from "@/components/ai-capability-studio/governance-preview-model";

describe("governance preview rendered controls", () => {
  it("invalidates the enable action when configuration changes after five passed tests", () => {
    render(<CapabilityGovernancePreview />);
    expect(screen.getByTestId("model-enable")).toBeDisabled();
    for (const item of admissionItems) fireEvent.click(screen.getByTestId(`model-test-${item}`));
    fireEvent.click(screen.getByTestId("model-enable"));
    expect(screen.getByTestId("model-status")).toHaveTextContent("已启用");
    fireEvent.click(screen.getByTestId("model-configure"));
    expect(screen.getByTestId("model-status")).toHaveTextContent("待测试 · 配置 r2");
    expect(screen.getByTestId("model-enable")).toBeDisabled();
    expect(screen.getByText("测试历史 · 5 条")).toBeInTheDocument();
  });
  it("requires clear confirmation and leaves newly discovered tools ungranted", async () => {
    render(<CapabilityGovernancePreview />);
    fireEvent.keyDown(screen.getByTestId("mcp-credential-mode"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "清除凭据，尝试匿名连接" }));
    expect(screen.getByTestId("mcp-connect-success")).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("mcp-connect-success"));
    expect(screen.getByTestId("mcp-status")).toHaveTextContent("匿名连接 · 配置 r2");
    expect(screen.getByText("export_report · 未授权")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "明确授权此工具" }));
    expect(screen.getByText("export_report · 演示范围已授权")).toBeInTheDocument();
  });
});
