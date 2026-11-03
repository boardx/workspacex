import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChatAttachmentView, TextAttachmentPreview } from "@/components/chat/chat-attachment-view";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";

const { media } = vi.hoisted(() => ({ media: { src: null as string | null, failed: false } }));
vi.mock("@/lib/use-authed-image-src", () => ({ useAuthedImageSrc: () => media }));
function SwitchLanguage() {
  const { setLocale } = useI18n();
  return <button onClick={() => setLocale("zh-CN")}>switch language</button>;
}
function localized(content: React.ReactNode) {
  return <I18nProvider initialLocale="en"><SwitchLanguage />{content}</I18nProvider>;
}
beforeEach(() => { media.src = null; media.failed = false; vi.unstubAllGlobals(); });
it("localizes the pending byte view without changing the raw attachment identity", () => {
  render(localized(<ChatAttachmentView threadId="raw-thread" attachmentId="raw-row" filename="用户文件 🌍.pdf" mime="application/pdf" />));
  const pending = screen.getByTestId("chat-attachment-preview-loading");
  expect(pending.textContent).toBe("Loading…");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("chat-attachment-preview-loading")).toBe(pending);
  expect(pending.textContent).toBe("正在加载…");
});
it("retranslates a failed preview without exposing upstream errors", () => {
  media.failed = true;
  render(localized(<ChatAttachmentView threadId="raw-thread" attachmentId="raw-row" filename="原名 {count}" mime="application/pdf" />));
  const failed = screen.getByTestId("chat-attachment-preview-failed");
  expect(failed.textContent).toBe("Could not load the preview. Try again or download the file.");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("chat-attachment-preview-failed")).toBe(failed);
  expect(failed.textContent).toBe("加载失败，请重试或直接下载。");
});
it("localizes unsupported-format fallback without changing the loaded blob", () => {
  media.src = "blob:raw-file";
  const state = vi.fn();
  render(localized(<ChatAttachmentView threadId="raw-thread" attachmentId="raw-row" filename="原始文档.docx" mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document" onState={state} />));
  expect(screen.getByTestId("chat-attachment-preview-unsupported").textContent?.trim()).toBe("Preview is unavailable for this file type. Download it to view.");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("chat-attachment-preview-unsupported").textContent?.trim()).toBe("该文件类型不支持预览，请下载查看。");
  expect(state).toHaveBeenCalledTimes(1);
  expect(state).toHaveBeenCalledWith({ src: "blob:raw-file", failed: false });
});
it("keeps a pending text read and raw braced content intact across locale changes", async () => {
  let resolveRead: (value: string) => void = () => { throw new Error("read not started"); };
  const read = vi.fn(() => new Promise<string>(resolve => { resolveRead = resolve; }));
  const fetchBytes = vi.fn(async () => ({ text: read }));
  vi.stubGlobal("fetch", fetchBytes);
  render(localized(<TextAttachmentPreview src="blob:raw-text" />));
  const pending = screen.getByTestId("chat-attachment-preview-text-loading");
  expect(pending.textContent).toBe("Reading content…");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("chat-attachment-preview-text-loading")).toBe(pending);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  await act(async () => { resolveRead("用户原文 {count} / English 🌍"); });
  expect(screen.getByTestId("chat-attachment-preview-text").textContent).toBe("用户原文 {count} / English 🌍");
  expect(fetchBytes).toHaveBeenCalledTimes(1);
});
