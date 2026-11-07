import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MicDevicePicker } from "@/components/chat/chat-composer-pickers";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
function Language() { const { setLocale } = useI18n(); return <><button onClick={() => setLocale("en")}>EN test</button><button onClick={() => setLocale("zh-CN")}>ZH test</button></>; }
function show(children: React.ReactNode) { render(<I18nProvider initialLocale="en"><Language />{children}</I18nProvider>); }
function swap() { fireEvent.click(screen.getByText("ZH test")); fireEvent.click(screen.getByText("EN test")); }
beforeEach(() => localStorage.clear());
it("localizes microphone chrome while preserving raw device labels, IDs and open selection", () => {
  const select = vi.fn(); show(<MicDevicePicker devices={[{ deviceId: "anonymous-raw", label: "" }, { deviceId: "usb-raw", label: "用户设备 {count}" }]} selectedDeviceId="anonymous-raw" disabled={false} onSelect={select} testIdPrefix="rec" side="down" iconOnly />);
  fireEvent.click(screen.getByRole("button", { name: "Choose microphone" }));
  expect(screen.getByRole("option", { name: "System default microphone" })).toBeVisible();
  expect(screen.getByRole("option", { name: "Microphone 1 (name available after permission)" })).toHaveAttribute("aria-selected", "true"); swap();
  expect(screen.getByRole("listbox", { name: "Choose microphone" })).toBeVisible(); expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("option", { name: "用户设备 {count}" })); expect(select).toHaveBeenCalledWith("usb-raw"); expect(select).toHaveBeenCalledTimes(1);
});
it("localizes the empty-device explanation and retains explicit null for the system default", () => {
  const select = vi.fn(); show(<MicDevicePicker devices={[]} selectedDeviceId={null} disabled={false} onSelect={select} testIdPrefix="rec" />);
  fireEvent.click(screen.getByRole("button", { name: "Choose microphone" }));
  expect(screen.getByText("No other input devices detected. Device names appear after microphone access is allowed.")).toBeVisible(); swap(); expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("option", { name: "System default microphone" })); expect(select).toHaveBeenCalledWith(null);
});
