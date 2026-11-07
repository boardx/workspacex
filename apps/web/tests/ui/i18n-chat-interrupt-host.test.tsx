import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const registered = vi.hoisted(() => ({} as Record<string, { render: (props: { args: unknown; status: string }) => React.ReactNode }>));
vi.mock("@copilotkit/react-core/v2", () => ({ useHumanInTheLoop: (tool: { name: string; render: (props: { args: unknown; status: string }) => React.ReactNode }) => { registered[tool.name] = tool; } }));
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { CopilotKitV2AgentInterrupts } from "@/components/chat/copilotkit-v2-agent-interrupts";
function SwitchLanguage() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
it("localizes partial streamed intent without inventing a pending approval", () => {
  render(<CopilotKitV2AgentInterrupts />);
  render(<I18nProvider initialLocale="en"><SwitchLanguage />{registered.confirm_task_intent!.render({ status: "executing", args: {} })}</I18nProvider>);
  const notice = screen.getByRole("status"); expect(notice.textContent).toBe("Receiving confirmation details…"); expect(screen.queryByTestId("agent-interrupt-confirm-intent-continue")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "switch language" })); expect(screen.getByRole("status")).toBe(notice); expect(notice.textContent).toBe("正在接收确认内容…");
});
it("keeps a completed framework confirmation as a disabled record across locale changes", () => {
  render(<CopilotKitV2AgentInterrupts />);
  render(<I18nProvider initialLocale="en"><SwitchLanguage />{registered.confirm_task_intent!.render({ status: "complete", args: { requestId: "raw-request", understanding: "用户确认原文{count}", assumptions: [] } })}</I18nProvider>);
  const record = screen.getByRole("group", { name: "Completed confirmation record" }); const button = screen.getByTestId("agent-interrupt-confirm-intent-continue"); expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "switch language" })); expect(screen.getByRole("group", { name: "已结束的确认记录" })).toBe(record); expect(screen.getByTestId("agent-interrupt-confirm-intent-continue")).toBe(button); expect(button).toBeDisabled(); expect(screen.getByText("用户确认原文{count}")).toBeTruthy();
});
