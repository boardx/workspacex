import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const css = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(css, () => ({}));
const hooks = vi.hoisted(() => ({ configure: vi.fn() }));
vi.mock("@copilotkit/react-core/v2", async original => ({
  ...(await original<typeof import("@copilotkit/react-core/v2")>()),
  useConfigureSuggestions: hooks.configure,
  useSuggestions: () => ({ suggestions: [{ title: "模型建议标题{count}", message: "模型建议正文🌍", isLoading: false }], isLoading: false }),
}));
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { FollowUpSuggestions } from "@/components/chat/copilotkit-v2-assistant-message";
function SwitchLanguage() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
it("localizes only dismissal chrome while preserving generated content and model configuration", () => {
  const select = vi.fn(); const dismiss = vi.fn(); const local = vi.fn();
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><FollowUpSuggestions agentId="raw-agent" disabled={false} onSelect={select} localSuggestions={[{ id: "raw-local-chip", label: "用户标签{count}", onSelect: local, onDismiss: dismiss }]} /></I18nProvider>);
  const button = screen.getByRole("button", { name: "Dismiss this suggestion" }); const model = screen.getByTestId("copilotkit-v2-suggestion-0");
  expect(model.textContent).toBe("模型建议标题{count}"); expect(screen.getByTestId("raw-local-chip").textContent).toBe("用户标签{count}");
  const configuration = hooks.configure.mock.calls.at(-1)?.[0];
  expect(configuration.instructions).toBe("结合当前对话内容，给用户 2-4 条真实相关的追问建议，贴合刚才讨论的具体主题，不要写成泛泛而谈的通用模板。");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByRole("button", { name: "关闭这条建议" })).toBe(button); expect(screen.getByTestId("copilotkit-v2-suggestion-0")).toBe(model);
  expect(hooks.configure.mock.calls.at(-1)?.[0]).toEqual(configuration); expect(hooks.configure.mock.calls.at(-1)?.[1]).toEqual(["raw-agent"]);
  expect(select).not.toHaveBeenCalled(); expect(local).not.toHaveBeenCalled(); expect(dismiss).not.toHaveBeenCalled();
  fireEvent.click(button); expect(dismiss).toHaveBeenCalledTimes(1); expect(local).not.toHaveBeenCalled();
  fireEvent.click(model); expect(select).toHaveBeenCalledTimes(1); expect(select).toHaveBeenCalledWith("模型建议正文🌍");
});
