import * as React from "react";
import { expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ChatAttachmentPreviewModal } from "@/components/chat/chat-attachment-preview-modal";
import type { ChatAttachment } from "@/lib/live-chat";
vi.mock("@/lib/use-authed-image-src",()=>({useAuthedImageSrc:()=>({src:"blob:raw-preview",failed:false})}));
const attachment:ChatAttachment={id:"attachment-raw",filename:"用户原名 🌍.pdf",mime:"application/pdf",bytes:1024,createdAt:"2026-11-04T00:00:00.000Z"};
it("localizes preview actions while preserving the raw title, download name, blob identity and open dialog",async()=>{
  const close=vi.fn();let switchLocale:()=>void=()=>{throw new Error("locale driver not mounted");};
  function LocaleDriver(){const {setLocale}=useI18n();React.useEffect(()=>{switchLocale=()=>setLocale("zh-CN");},[setLocale]);return null;}
  render(<I18nProvider initialLocale="en"><LocaleDriver/><ChatAttachmentPreviewModal threadId="thread-raw" attachment={attachment} onClose={close}/></I18nProvider>);
  const dismiss=await screen.findByTestId("chat-attachment-preview-dismiss");
  expect(dismiss.textContent?.trim()).toBe("Close");
  const download=await screen.findByRole("link",{name:"Download"});
  expect(download.getAttribute("download")).toBe(attachment.filename);expect(download.getAttribute("href")).toBe("blob:raw-preview");
  expect(screen.getByText(attachment.filename)).toBeTruthy();
  // The provider changes globally while the overlay is open; it is not a close/reopen action.
  act(()=>switchLocale());
  expect(screen.getByTestId("chat-attachment-preview-dismiss")).toBe(dismiss);expect(screen.getByRole("link",{name:"下载"})).toBe(download);
  expect(download.getAttribute("href")).toBe("blob:raw-preview");expect(download.getAttribute("download")).toBe(attachment.filename);expect(close).not.toHaveBeenCalled();
  fireEvent.click(dismiss);expect(close).toHaveBeenCalledTimes(1);
});
