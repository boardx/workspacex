import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ChatAttachmentButton, ChatAttachmentList, ChatSidebarUploadButton, MessageAttachments, useChatAttachments } from "@/components/chat/chat-composer-attachments";
import { AttachmentExtractionNotice } from "@/components/chat/attachment-extraction-notice";
import type { ChatAttachment } from "@/lib/live-chat";
const { upload, cancel } = vi.hoisted(() => ({ upload: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/live-chat", async original => ({ ...(await original<typeof import("@/lib/live-chat")>()), uploadAttachment: upload, cancelPendingAttachment: cancel }));
const row: ChatAttachment = { id: "raw-row", filename: "用户文件 {count}.pdf", mime: "application/pdf", bytes: 1024, createdAt: "2026-11-04T00:00:00Z" };
let changeLanguage: () => void = () => { throw new Error("locale driver not ready"); };
function Harness() {
  const { setLocale } = useI18n();
  React.useEffect(() => { changeLanguage = () => setLocale("zh-CN"); }, [setLocale]);
  const ctl = useChatAttachments({ threadId: "raw-thread", bearer: "unit-fixture-bearer" });
  return <><ChatAttachmentButton ctl={ctl} showLabel /><ChatAttachmentList ctl={ctl} /></>;
}
beforeEach(() => { upload.mockReset(); cancel.mockReset(); cancel.mockResolvedValue(undefined); });
it("owned skill draft badge follows locale without rewriting the persisted filename", () => {
  const file = { ...row, filename: "用户原名 {x}.skill.json", mime: "application/json" };
  function MessageDriver() {
    const { setLocale } = useI18n();
    return <><button onClick={() => setLocale("zh-CN")}>Change message locale</button><MessageAttachments attachments={[file]} threadId="raw-thread" /></>;
  }
  render(<I18nProvider initialLocale="en"><MessageDriver /></I18nProvider>);
  const badge = screen.getByTestId(`chat-skill-draft-${file.id}`);
  expect(badge).toHaveTextContent("Skill draft");
  fireEvent.click(screen.getByRole("button", { name: "Change message locale" }));
  expect(screen.getByTestId(`chat-skill-draft-${file.id}`)).toBe(badge);
  expect(badge).toHaveTextContent("技能草稿");
  expect(screen.getByText(file.filename)).toHaveAttribute("title", file.filename);
  expect(upload).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
});
it("localizes the material dialog without remounting its pending upload or rewriting the filename", async () => {
  upload.mockImplementation(() => new Promise<ChatAttachment>(() => {}));
  render(<I18nProvider initialLocale="en"><Harness /></I18nProvider>);
  const add = screen.getByRole("button", { name: "Add attachment" });
  fireEvent.click(add);
  const dialog = await screen.findByRole("dialog", { name: "Add materials to this turn" });
  expect(screen.getByRole("button", { name: "Choose files from this device" })).toBeTruthy();
  const file = new File([new Uint8Array(1024)], row.filename, { type: row.mime });
  fireEvent.change(screen.getByTestId("chat-attachment-file-input"), { target: { files: [file] } });
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId("chat-attach-material-confirm").hasAttribute("disabled")).toBe(true);
  act(() => changeLanguage());
  expect(screen.getByRole("dialog", { name: "加材料进这一轮" })).toBe(dialog);
  expect(screen.getByTestId("chat-attachment-input")).toBe(add);
  expect(screen.getAllByText(row.filename).length).toBeGreaterThan(0);
  expect(upload).toHaveBeenCalledTimes(1);
  expect(upload.mock.calls[0]?.[1]).toBe(file);
  expect(cancel).not.toHaveBeenCalled();
});
it("keeps a wide-list removal confirmation and its target stable across locale changes", async () => {
  upload.mockResolvedValue(row);
  render(<I18nProvider initialLocale="en"><Harness /></I18nProvider>);
  fireEvent.change(screen.getByTestId("chat-attachment-file-input"), { target: { files: [new File([new Uint8Array(1024)], row.filename, { type: row.mime })] } });
  const remove = await screen.findByRole("button", { name: `Remove attachment ${row.filename}` });
  await waitFor(() => expect(screen.getByText("Uploaded")).toBeTruthy());
  fireEvent.click(remove);
  const confirmation = screen.getByRole("alertdialog", { name: "Confirm attachment removal" });
  expect(confirmation.textContent).toContain(row.filename);
  act(() => changeLanguage());
  expect(screen.getByRole("alertdialog", { name: "确认移除附件" })).toBe(confirmation);
  expect(screen.getByRole("button", { name: `移除附件 ${row.filename}` })).toBe(remove);
  expect(cancel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "移除" }));
  await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
  expect(cancel).toHaveBeenCalledWith("raw-thread", "raw-row", "unit-fixture-bearer");
});
it("localizes extraction status without changing the canonical status or reason", () => {
  const attachment = { extractionStatus: "pending" as const, extractionError: null };
  render(<I18nProvider initialLocale="en"><AttachmentExtractionNotice attachment={attachment} /></I18nProvider>);
  expect(screen.getByRole("status").textContent).toBe("Attachment uploaded. Its content is being processed.");
  expect(attachment.extractionStatus).toBe("pending");
  expect(attachment.extractionError).toBeNull();
});

it("localizes the materials sidebar upload entry without changing the upload command", async () => {
  upload.mockResolvedValue(row);
  function SidebarHarness() {
    const { setLocale } = useI18n();
    React.useEffect(() => { changeLanguage = () => setLocale("zh-CN"); }, [setLocale]);
    const ctl = useChatAttachments({ threadId: "raw-thread", bearer: "unit-fixture-bearer" });
    return <ChatSidebarUploadButton ctl={ctl} />;
  }
  render(<I18nProvider initialLocale="en"><SidebarHarness /></I18nProvider>);
  const trigger = screen.getByRole("button", { name: "Upload file (attach to the next message)" });
  act(() => changeLanguage());
  expect(screen.getByRole("button", { name: "上传文件（加入下一条消息的附件）" })).toBe(trigger);
  const file = new File([new Uint8Array(1024)], row.filename, { type: row.mime });
  fireEvent.change(screen.getByTestId("chat-materials-upload-input"), { target: { files: [file] } });
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
  expect(upload.mock.calls[0]?.[0]).toBe("raw-thread");
  expect(upload.mock.calls[0]?.[1]).toBe(file);
  expect(upload.mock.calls[0]?.[2]).toBe("unit-fixture-bearer");
});
