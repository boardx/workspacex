import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ComposerVoiceControl } from "@/components/chat/chat-composer-voice-control";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
function SwitchLanguage() { const {setLocale} = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
const props = () => ({
  status: "idle" as const, phase: "idle" as const, elapsedSeconds: 0, level: 0, disabled: false,
  onRequireSession: () => true, onStart: vi.fn(), onStop: vi.fn(), onResume: vi.fn(),
  devices: [{ deviceId: "device-raw", label: "用户设备 麦克风" }], selectedDeviceId: "device-raw",
  onSelectDevice: vi.fn(), autoPause: true, onAutoPauseChange: vi.fn(),
});
it("localizes the voice trigger without invoking recording on locale change", () => {
  const p = props();
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><ComposerVoiceControl {...p}/></I18nProvider>);
  const button = screen.getByRole("button", {name:"Start voice input"});
  fireEvent.click(screen.getByRole("button", {name:"switch language"}));
  expect(screen.getByRole("button", {name:"开始语音输入"})).toBe(button);
  expect(p.onStart).not.toHaveBeenCalled();
});
it("localizes device settings but keeps raw device identity and label", () => {
  const p = props();
  render(<I18nProvider initialLocale="en"><ComposerVoiceControl {...p}/></I18nProvider>);
  fireEvent.click(screen.getByTestId("chat-task-workbench-composer-mic-devices"));
  expect(screen.getByText("Input device")).toBeTruthy();
  fireEvent.click(screen.getByText("用户设备 麦克风"));
  expect(p.onSelectDevice).toHaveBeenCalledWith("device-raw");
  expect(p.onStart).not.toHaveBeenCalled();
});
