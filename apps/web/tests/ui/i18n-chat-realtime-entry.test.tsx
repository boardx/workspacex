import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChatRealtimeVoiceEntry } from "@/components/chat/chat-realtime-voice-entry";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
function SwitchLanguage() {
  const { setLocale } = useI18n();
  return <button onClick={() => setLocale("zh-CN")}>switch language</button>;
}
it("localizes the closed call entry while keeping the custom agent identity and connection untouched", () => {
  const resolve = vi.fn(async () => "thread-raw");
  const ended = vi.fn();
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><ChatRealtimeVoiceEntry disabled={false} agent={{ id: "agent-raw", name: "用户数字人 🌍", duty: "原始职责" }} resolveThreadId={resolve} onEnded={ended} /></I18nProvider>);
  const entry = screen.getByRole("button", { name: "Live conversation with 用户数字人 🌍" });
  expect(entry.textContent).toContain("Live conversation");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByRole("button", { name: "与用户数字人 🌍实时对话" })).toBe(entry);
  expect(resolve).not.toHaveBeenCalled();
  expect(ended).not.toHaveBeenCalled();
});
it("uses an authored localized general assistant label without creating a thread", () => {
  const resolve = vi.fn(async () => "thread-raw");
  render(<I18nProvider initialLocale="en"><ChatRealtimeVoiceEntry disabled={false} agent={null} resolveThreadId={resolve} onEnded={vi.fn()} /></I18nProvider>);
  expect(screen.getByRole("button", { name: "Live conversation with General assistant" })).toBeTruthy();
  expect(resolve).not.toHaveBeenCalled();
});
