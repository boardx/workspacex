import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ChatAttachmentSlidesPreview } from "@/components/chat/chat-attachment-slides-preview";
const { init, destroy } = vi.hoisted(() => ({ init: vi.fn(), destroy: vi.fn() }));
vi.mock("pptx-preview", () => ({ init }));
function SwitchLanguage() {
  const { locale, setLocale } = useI18n();
  return <button onClick={() => setLocale(locale === "en" ? "zh-CN" : "en")}>switch language</button>;
}
function mount() { render(<I18nProvider initialLocale="en"><SwitchLanguage /><ChatAttachmentSlidesPreview src="blob:raw-slides" filename="用户幻灯片 {count}.pptx" /></I18nProvider>); }
beforeEach(() => {
  vi.unstubAllGlobals(); init.mockReset(); destroy.mockReset();
  init.mockImplementation((container: HTMLElement) => ({
    preview: async () => {
      const wrapper = document.createElement("div"); wrapper.className = "pptx-preview-wrapper";
      for (let index = 0; index < 3; index += 1) {
        const slide = document.createElement("div"); slide.className = "pptx-preview-slide-wrapper"; wrapper.append(slide);
      }
      container.append(wrapper);
    }, destroy,
  }));
});
afterEach(() => vi.unstubAllGlobals());
it("localizes a pending controlled render without restarting the byte read", async () => {
  let resolveBytes: (buffer: ArrayBuffer) => void = () => { throw new Error("byte read not started"); };
  const read = vi.fn(() => new Promise<ArrayBuffer>(resolve => { resolveBytes = resolve; }));
  const fetchBytes = vi.fn(async () => ({ arrayBuffer: read })); vi.stubGlobal("fetch", fetchBytes);
  mount();
  const pending = screen.getByTestId("chat-attachment-preview-slides-loading");
  expect(pending.textContent).toBe("Parsing slides…");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("chat-attachment-preview-slides-loading")).toBe(pending);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  await act(async () => resolveBytes(new ArrayBuffer(0)));
  expect(screen.getByTestId("chat-attachment-preview-slides-count").textContent?.trim()).toBe("共 3 页");
  expect(fetchBytes).toHaveBeenCalledTimes(1); expect(init).toHaveBeenCalledTimes(1); expect(destroy).not.toHaveBeenCalled();
});
it("localizes slide counts without replacing the controlled renderer or raw filename", async () => {
  const fetchBytes = vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(0) })); vi.stubGlobal("fetch", fetchBytes);
  mount();
  const count = await screen.findByTestId("chat-attachment-preview-slides-count");
  expect(count.textContent?.trim()).toBe("3 slides");
  const content = screen.getByLabelText("用户幻灯片 {count}.pptx");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("chat-attachment-preview-slides-count")).toBe(count);
  expect(screen.getByLabelText("用户幻灯片 {count}.pptx")).toBe(content);
  expect(init).toHaveBeenCalledTimes(1); expect(fetchBytes).toHaveBeenCalledTimes(1); expect(destroy).not.toHaveBeenCalled();
});
it("localizes a controlled renderer failure without leaking its diagnostics", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(0) })));
  init.mockImplementation(() => ({ preview: async () => { throw new Error("private renderer diagnostics"); }, destroy }));
  mount();
  const failure = await screen.findByTestId("chat-attachment-preview-slides-failed");
  expect(failure.textContent?.trim()).toBe("Could not render the preview. Download the file to view it.");
  expect(screen.queryByText("private renderer diagnostics")).toBeNull();
});
