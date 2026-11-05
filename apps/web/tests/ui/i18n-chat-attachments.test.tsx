import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ApiError } from "@/lib/api-client";
import { ATTACHMENT_LIMITS, type ChatAttachment } from "@/lib/live-chat";
import { ChatAttachmentBanner, ChatComposerAttachmentStrip, useChatAttachments } from "@/components/chat/chat-composer-attachments";
const { upload, cancel } = vi.hoisted(() => ({ upload: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/live-chat", async (original) => ({
  ...(await original<typeof import("@/lib/live-chat")>()), uploadAttachment: upload, cancelPendingAttachment: cancel,
}));
function Harness() {
  const {setLocale}=useI18n();
  const ctl=useChatAttachments({threadId:"thread-raw",bearer:"unit-fixture-bearer"});
  return <>
    <button onClick={()=>setLocale("zh-CN")}>switch language</button>
    <input type="file" aria-label="choose raw files" onChange={event=>ctl.pickFiles(event.currentTarget.files)}/>
    <ChatAttachmentBanner banner={ctl.banner}/><ChatComposerAttachmentStrip ctl={ctl}/>
    <output data-testid="server-ids">{JSON.stringify(ctl.uploadedIds)}</output>
  </>;
}
function mount() { render(<I18nProvider initialLocale="en"><Harness/></I18nProvider>); }
function pick(file:File) { fireEvent.change(screen.getByLabelText("choose raw files"),{target:{files:[file]}}); }
function pdf(name:string) { return new File([new Uint8Array(1024)],name,{type:"application/pdf"}); }
const remote:ChatAttachment={id:"server-row-raw",filename:"用户附件 🌍.pdf",mime:"application/pdf",bytes:1024,createdAt:"2026-11-04T00:00:00.000Z"};
beforeEach(()=>{upload.mockReset();cancel.mockReset();cancel.mockResolvedValue(undefined);});
it("localizes upload state in place without duplicating the upload or changing server attachment identity",async()=>{
  let resolveUpload:(row:ChatAttachment)=>void=()=>{throw new Error("upload was not initialized");};
  upload.mockImplementation(()=>new Promise<ChatAttachment>(resolve=>{resolveUpload=resolve;}));
  mount();const file=pdf(remote.filename);pick(file);
  const preview=await screen.findByRole("button",{name:/Preview attachment 用户附件 🌍\.pdf/});
  expect(preview.getAttribute("title")).toContain("Uploading 0%");
  const chip=preview.closest("li");
  fireEvent.click(screen.getByRole("button",{name:"switch language"}));
  expect(screen.getByRole("button",{name:/预览附件 用户附件 🌍\.pdf/})).toBe(preview);
  expect(preview.closest("li")).toBe(chip);
  expect(upload).toHaveBeenCalledTimes(1);
  expect(upload.mock.calls[0]?.[0]).toBe("thread-raw");
  expect(upload.mock.calls[0]?.[1]).toBe(file);
  expect(upload.mock.calls[0]?.[2]).toBe("unit-fixture-bearer");
  await act(async()=>resolveUpload(remote));
  await waitFor(()=>expect(screen.getByTestId("server-ids").textContent).toBe('["server-row-raw"]'));
  expect(upload).toHaveBeenCalledTimes(1);
});
it("retranslates a persisted owned storage failure without retrying or replacing the raw filename",async()=>{
  upload.mockRejectedValue(new ApiError(503,"STORAGE_UNAVAILABLE","private upstream diagnostics"));
  mount();pick(pdf(remote.filename));
  expect(await screen.findByText("Storage is temporarily unavailable. Try again.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"switch language"}));
  expect(screen.getByText("存储暂不可用，请重试")).toBeTruthy();
  expect(screen.getByText(remote.filename)).toBeTruthy();
  expect(upload).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("private upstream diagnostics")).toBeNull();
});
it("localizes a real oversized-file preflight notice and preserves the supplied name without uploading",()=>{
  mount();const name="原始大文件 {count}.pdf";
  pick(new File([new Uint8Array(ATTACHMENT_LIMITS.maxBytesPerFile+1)],name,{type:"application/pdf"}));
  const alert=screen.getByRole("alert");
  expect(alert.textContent).toContain("exceeds");expect(alert.textContent).toContain(name);
  fireEvent.click(screen.getByRole("button",{name:"switch language"}));
  expect(screen.getByRole("alert")).toBe(alert);expect(alert.textContent).toContain("超过单文件");
  expect(alert.textContent).toContain(name);expect(upload).not.toHaveBeenCalled();
});
it("retranslates a persisted removal conflict without repeating cancellation or changing the raw attachment",async()=>{
  upload.mockResolvedValue(remote);
  cancel.mockRejectedValue(new ApiError(409,"ATTACHMENT_ALREADY_SENT","private removal diagnostics"));
  mount();pick(pdf(remote.filename));
  await waitFor(()=>expect(screen.getByTestId("server-ids").textContent).toBe('["server-row-raw"]'));
  fireEvent.click(screen.getByRole("button",{name:"Remove attachment 用户附件 🌍.pdf"}));
  const failure=await screen.findByText("This attachment has already been sent and cannot be removed.");
  expect(cancel).toHaveBeenCalledWith("thread-raw","server-row-raw","unit-fixture-bearer");
  fireEvent.click(screen.getByRole("button",{name:"switch language"}));
  expect(failure.textContent).toBe("附件已随消息发送，无法移除。");
  expect(screen.getByText(remote.filename)).toBeTruthy();
  expect(cancel).toHaveBeenCalledTimes(1);expect(upload).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("private removal diagnostics")).toBeNull();
});
