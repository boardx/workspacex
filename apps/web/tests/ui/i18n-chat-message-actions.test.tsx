import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { CopilotKitV2CopyButton, CopilotKitV2RememberMessageButton } from "@/components/chat/copilotkit-v2-message-actions";
const { remember } = vi.hoisted(() => ({ remember: vi.fn() }));
vi.mock("@/lib/knowledge-graph-events", () => ({ requestRememberStatement: remember }));
function SwitchLanguage() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
it("keeps the framework copy action and raw message identity across locale changes", async () => {
  const raw = "用户原文 {count}\n```json\n{\"status\":\"pending\"}\n```";
  const copy = vi.fn(async (_text: string) => true);
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><CopilotKitV2CopyButton messageId="raw-message" onClick={() => copy(raw)} /></I18nProvider>);
  const action = screen.getByRole("button", { name: "Copy message" });
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByRole("button", { name: "复制消息" })).toBe(action); expect(copy).not.toHaveBeenCalled();
  expect(action.getAttribute("data-message-id")).toBe("raw-message");
  fireEvent.click(action); await waitFor(() => expect(copy).toHaveBeenCalledWith(raw)); expect(copy).toHaveBeenCalledTimes(1);
});
it("localizes remember without changing the raw statement or bypassing the existing request action", () => {
  remember.mockReset();
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><CopilotKitV2RememberMessageButton text=" 用户原话 {count} 🌍 " /></I18nProvider>);
  const action = screen.getByRole("button", { name: "Remember this statement" });
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByRole("button", { name: "记住这句" })).toBe(action); expect(remember).not.toHaveBeenCalled();
  fireEvent.click(action); expect(remember).toHaveBeenCalledWith("用户原话 {count} 🌍"); expect(remember).toHaveBeenCalledTimes(1);
});
