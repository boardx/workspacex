import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/use-produced-file-download", () => ({ useProducedFileDownload: download }));
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ProducedFileInlineCard } from "@/components/chat/produced-file-inline-card";
import type { ActiveFile } from "@/lib/agui-file-events";
let switchLanguage: () => void = () => {};
// A cross-tab locale update can arrive while the modal correctly hides the app shell.
// Drive the real provider; never disable the focus trap or click an aria-hidden control.
function LocaleControl() {
  const { setLocale } = useI18n();
  React.useEffect(() => { switchLanguage = () => setLocale("zh-CN"); return () => { switchLanguage = () => {}; }; }, [setLocale]);
  return null;
}
const file: ActiveFile = { uri: "vfs://attachment/raw-row", name: "原图 {count}.png", mime: "image/png", source: "agent_run_output", bytes: 1024, messageId: "raw-message", content: "", nextSequence: 0 };
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("keeps the produced image overlay and exact authorized bytes while translating its actions", () => {
  download.mockReturnValue({ src: "blob:authorized-image", failed: false, iconKind: "image" });
  render(<I18nProvider initialLocale="en"><LocaleControl /><ProducedFileInlineCard file={file} threadId="raw-thread" /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: `Enlarge preview ${file.name}` }));
  const overlay = screen.getByTestId("chat-produced-file-preview");
  const image = screen.getByTestId("chat-produced-file-preview-image");
  const link = within(overlay).getByRole("link", { name: "Download" });
  expect(image).toHaveAttribute("src", "blob:authorized-image"); expect(image).toHaveAttribute("alt", file.name);
  expect(link).toHaveAttribute("href", "blob:authorized-image"); expect(link).toHaveAttribute("download", file.name);
  act(() => switchLanguage());
  expect(screen.getByTestId("chat-produced-file-preview")).toBe(overlay); expect(screen.getByTestId("chat-produced-file-preview-image")).toBe(image);
  expect(within(overlay).getByRole("link", { name: "下载" })).toBe(link);
  fireEvent.click(screen.getByTestId("chat-produced-file-preview-dismiss")); expect(screen.queryByTestId("chat-produced-file-preview-portal")).toBeNull();
  expect(download.mock.calls.every(([value, thread]) => value === file && thread === "raw-thread")).toBe(true);
});
it("renders PDF preview chrome around the same original file and preserves its frame through locale", () => {
  const pdf = { ...file, name: "原稿 {title}.pdf", mime: "application/pdf" };
  download.mockReturnValue({ src: "blob:authorized-pdf", failed: false, iconKind: "pdf" });
  render(<I18nProvider initialLocale="en"><LocaleControl /><ProducedFileInlineCard file={pdf} threadId="raw-thread" /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  const frame = screen.getByTitle(`${pdf.name} PDF preview`); expect(frame).toHaveAttribute("src", "blob:authorized-pdf");
  act(() => switchLanguage());
  expect(screen.getByTitle(`${pdf.name} PDF 预览`)).toBe(frame);
  expect(screen.getByTestId("chat-produced-file-pdf-preview-download")).toHaveAttribute("download", pdf.name);
  fireEvent.click(screen.getByTestId("chat-produced-file-pdf-preview-dismiss")); expect(screen.queryByTestId("chat-produced-file-pdf-preview-frame")).toBeNull();
});
