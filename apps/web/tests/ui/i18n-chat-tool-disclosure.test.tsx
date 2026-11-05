import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
const css = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(css, () => ({}));
import { CopilotKit } from "@copilotkit/react-core/v2";
import { V2AssistantMessage } from "@/components/chat/copilotkit-v2-assistant-message";
import { CopilotKitV2ToolRenderers } from "@/components/chat/copilotkit-v2-tool-renderers";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
function SwitchLanguage() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
const call = (id: string) => ({ id, type: "function" as const, function: { name: "read_file", arguments: JSON.stringify({ path: "原始文件{count}.md" }) } });
function Surface({ count = 1 }: { count?: number }) {
  const message = { id: "persisted-message", role: "assistant" as const, content: "模型正文 {count}", toolCalls: Array.from({ length: count }, (_, i) => call(`call-${i}`)) };
  return <I18nProvider initialLocale="en"><SwitchLanguage /><CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
    <CopilotKitV2ToolRenderers /><V2AssistantMessage message={message as React.ComponentProps<typeof V2AssistantMessage>["message"]} messages={[message] as React.ComponentProps<typeof V2AssistantMessage>["messages"]} isRunning={false} />
  </CopilotKit></I18nProvider>;
}
it("localizes the canonical legacy-tool disclosure and keeps its raw message/card and stable accessible region", () => {
  render(<Surface />);
  const toggle = screen.getByTestId("copilotkit-v2-tool-calls-group-toggle");
  const body = screen.getByTestId("copilotkit-v2-tool-calls-group-body");
  expect(toggle.textContent).toBe("Tool calls · 1 step");
  expect(toggle.getAttribute("aria-controls")).toBe(body.id); expect(body.getAttribute("aria-label")).toBe("Tool call details");
  expect(body.hasAttribute("hidden")).toBe(true);
  fireEvent.click(toggle); expect(toggle.textContent).toBe("Collapse tool calls");
  expect(body.textContent).toContain("原始文件{count}.md"); expect(screen.getByText("模型正文 {count}")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("copilotkit-v2-tool-calls-group-toggle")).toBe(toggle);
  expect(screen.getByTestId("copilotkit-v2-tool-calls-group-body")).toBe(body);
  expect(toggle.textContent).toBe("收起工具调用"); expect(body.hasAttribute("hidden")).toBe(false);
  expect(body.getAttribute("aria-label")).toBe("工具调用详情"); expect(body.textContent).toContain("原始文件{count}.md");
});
it("keeps collapsed state and canonical count while another raw tool call is projected", () => {
  const { rerender } = render(<Surface />);
  const toggle = screen.getByTestId("copilotkit-v2-tool-calls-group-toggle");
  rerender(<Surface count={2} />);
  expect(screen.getByTestId("copilotkit-v2-tool-calls-group-toggle")).toBe(toggle);
  expect(toggle.textContent).toBe("Tool calls · 2 steps"); expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByTestId("copilotkit-v2-tool-calls-group").getAttribute("data-tool-calls-count")).toBe("2");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(toggle.textContent).toBe("工具调用 · 2 步"); expect(toggle.getAttribute("aria-expanded")).toBe("false");
});
