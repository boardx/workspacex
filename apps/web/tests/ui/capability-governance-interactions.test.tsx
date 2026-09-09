import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CapabilityGovernancePreview } from "@/components/ai-capability-studio/governance-preview";
import { admissionItems } from "@/components/ai-capability-studio/governance-preview-model";

describe("governance preview rendered controls", () => {
  it("invalidates the enable action when configuration changes after five passed tests", async () => {
    render(<CapabilityGovernancePreview />);
    expect(screen.getByTestId("model-enable")).toBeDisabled();
    for (const item of admissionItems) {
      fireEvent.keyDown(screen.getByTestId(`model-verdict-${item}`), { key: "Enter" });
      fireEvent.click(await screen.findByRole("menuitemradio", { name: /^通过$/ }));
      fireEvent.change(screen.getByTestId(`model-evidence-${item}`), { target: { value: `evidence for ${item}` } });
      fireEvent.click(screen.getByTestId(`model-test-${item}`));
    }
    fireEvent.click(screen.getByTestId("model-enable"));
    expect(screen.getByTestId("model-status")).toHaveTextContent("已启用");
    fireEvent.click(screen.getByTestId("model-configure"));
    fireEvent.change(screen.getByTestId("model-upstream"), { target: { value: "research-upstream-v2" } });
    fireEvent.click(screen.getByTestId("model-config-save"));
    expect(screen.getByTestId("model-status")).toHaveTextContent("待测试 · 配置 r2");
    expect(screen.getByTestId("model-enable")).toBeDisabled();
    expect(screen.getByText("测试历史 · 5 条")).toBeInTheDocument();
  });
  it("does not turn connectivity into admission and preserves obsolete evidence as non-submittable", async () => {
    render(<CapabilityGovernancePreview />);
    fireEvent.click(screen.getByTestId("model-probe-success"));
    expect(screen.getByTestId("model-enable")).toBeDisabled();
    expect(screen.getByTestId("model-test-连通性")).toBeDisabled();
    fireEvent.keyDown(screen.getByTestId("model-verdict-连通性"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /^通过$/ }));
    expect(screen.getByTestId("model-test-连通性")).toBeDisabled();
    fireEvent.change(screen.getByTestId("model-evidence-连通性"), { target: { value: "r1 probe observation" } });
    fireEvent.click(screen.getByTestId("model-configure"));
    fireEvent.click(screen.getByTestId("model-config-save"));
    expect(screen.getByTestId("model-probe-result")).toHaveTextContent("已过期，未应用");
    expect(screen.getByTestId("model-evidence-连通性")).toHaveValue("r1 probe observation");
    expect(screen.getByTestId("model-test-连通性")).toBeDisabled();
    fireEvent.click(within(screen.getByTestId("model-judgment-连通性")).getByRole("button", { name: "以当前配置重新填写" }));
    expect(screen.getByTestId("model-evidence-连通性")).toHaveValue("");
    expect(screen.getByTestId("model-test-连通性")).toBeDisabled();
  });
  it("keeps non-secret edits during a revision conflict and requires explicit reapplication", () => {
    render(<CapabilityGovernancePreview />);
    fireEvent.click(screen.getByTestId("model-configure"));
    fireEvent.change(screen.getByTestId("model-upstream"), { target: { value: "my-pending-model" } });
    fireEvent.change(screen.getByTestId("model-credential"), { target: { value: "demo-sensitive-input" } });
    fireEvent.click(screen.getByTestId("model-simulate-conflict"));
    expect(screen.getByTestId("model-config-save")).toBeDisabled();
    expect(screen.getByTestId("model-upstream")).toHaveValue("my-pending-model");
    expect(screen.getByTestId("model-credential")).toHaveValue("");
    expect(screen.getByTestId("model-test-连通性")).toBeDisabled();
    expect(screen.getByTestId("model-reapply")).toBeDisabled();
    expect(screen.getByTestId("model-conflict-comparison")).toHaveTextContent("research-upstream-updated");
    expect(screen.getByTestId("model-conflict-comparison")).toHaveTextContent("my-pending-model");
    fireEvent.click(screen.getByRole("checkbox", { name: "已比较最新配置与我的修改，确认继续使用我的值" }));
    fireEvent.click(screen.getByTestId("model-reapply"));
    expect(screen.getByTestId("model-current-mapping")).toHaveTextContent("research-upstream-updated");
    fireEvent.click(screen.getByTestId("model-config-save"));
    expect(screen.getByTestId("model-current-mapping")).toHaveTextContent("my-pending-model");
    expect(screen.getByTestId("model-status")).toHaveTextContent("配置 r3");
  });
  it("loading the latest model discards only explicitly abandoned edits and clears credentials on close", () => {
    render(<CapabilityGovernancePreview />);
    fireEvent.click(screen.getByTestId("model-configure"));
    fireEvent.change(screen.getByTestId("model-upstream"), { target: { value: "abandoned-local-model" } });
    fireEvent.click(screen.getByTestId("model-simulate-conflict"));
    fireEvent.click(screen.getByTestId("model-load-latest"));
    expect(screen.getByTestId("model-upstream")).toHaveValue("research-upstream-updated");
    fireEvent.change(screen.getByTestId("model-credential"), { target: { value: "demo-secret" } });
    fireEvent.click(screen.getByTestId("model-config-close"));
    fireEvent.click(screen.getByTestId("model-configure"));
    expect(screen.getByTestId("model-credential")).toHaveValue("");
  });
  it("requires clear confirmation and leaves newly discovered tools ungranted", () => {
    render(<CapabilityGovernancePreview />);
    fireEvent.click(screen.getByRole("radio", { name: "清除凭据，尝试匿名连接" }));
    expect(screen.getByTestId("mcp-connect-success")).toBeDisabled();
    expect(screen.getByTestId("mcp-connect-failure")).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("mcp-connect-success"));
    expect(screen.getByTestId("mcp-status")).toHaveTextContent("匿名连接 · 配置 r2");
    expect(screen.getByRole("radio", { name: "保留并使用现有凭据" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "替换凭据（演示）" })).toBeChecked();
    expect(screen.getByText("export_report · 未授权")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "明确授权此工具" }));
    expect(screen.getByText("export_report · 演示范围已授权")).toBeInTheDocument();
  });
  it("failed MCP replacement preserves endpoint and grants while clearing the submitted credential", () => {
    render(<CapabilityGovernancePreview />);
    fireEvent.click(screen.getByRole("radio", { name: "替换凭据（演示）" }));
    expect(screen.getByTestId("mcp-connect-success")).toBeDisabled();
    expect(screen.getByTestId("mcp-connect-failure")).toBeDisabled();
    fireEvent.change(screen.getByTestId("mcp-endpoint"), { target: { value: "https://new.example.test/mcp" } });
    fireEvent.change(screen.getByTestId("mcp-credential"), { target: { value: "demo-only-replacement" } });
    fireEvent.click(screen.getByTestId("mcp-connect-failure"));
    expect(screen.getByTestId("mcp-current-endpoint")).toHaveTextContent("https://example.test/mcp");
    expect(screen.getByTestId("mcp-status")).toHaveTextContent("已配置凭据 · 配置 r1");
    expect(screen.getByTestId("mcp-credential")).toHaveValue("");
    expect(screen.getByTestId("mcp-endpoint")).toHaveValue("https://new.example.test/mcp");
    expect(screen.getByText("search · 演示范围已授权")).toBeInTheDocument();
  });
});
