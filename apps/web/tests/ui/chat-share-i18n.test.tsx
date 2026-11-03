import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChatShareButton } from "@/components/chat/chat-share-button";
import { PublicChatShareScreen } from "@/components/chat/public-chat-share-screen";
import { I18nProvider } from "@/lib/i18n/provider";
import { LanguageSwitcher } from "@/components/shell/language-switcher";
import { ChatCodeFence } from "@/components/chat/chat-code-fence";
import { ApiError } from "@/lib/api-client";
const api = vi.hoisted(() => ({ previewChatShare: vi.fn(), listChatShares: vi.fn(), createChatShare: vi.fn(), revokeChatShare: vi.fn() }));
vi.mock("@/lib/live-chat-share", async original => ({ ...await original<typeof import("@/lib/live-chat-share")>(), ...api }));
const snapshot = {title:"原文标题 {title}",messages:[{authorKind:"human" as const,text:"原文消息 {text}",createdAt:"2026-10-13T00:00:00Z",attachments:[{filename:"原文附件 {file}.pdf",mime:"application/pdf",bytes:10}]}]};
const preview = {snapshot,revision:"r".repeat(64)};
const share = {id:"raw-share",createdAt:"2026-10-13T00:00:00Z",revokedAt:null};
const locale=(value:string)=>fireEvent.change(screen.getByTestId("language-switcher"),{target:{value}});
beforeEach(()=>{vi.clearAllMocks(); api.previewChatShare.mockResolvedValue(preview);api.listChatShares.mockResolvedValue([]);api.createChatShare.mockResolvedValue({share,token:"t".repeat(43)});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("translates anonymous wrappers without refetching or changing raw snapshot content",async()=>{
 const fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>new Response(JSON.stringify({snapshot,createdAt:share.createdAt}),{status:200}));vi.stubGlobal("fetch",fetcher);
 render(<I18nProvider initialLocale="en"><PublicChatShareScreen token={"t".repeat(43)}/></I18nProvider>);
 await screen.findByRole("heading",{name:snapshot.title});expect(screen.getByText("Questioner")).toBeVisible();expect(screen.getByText("原文消息 {text}")).toBeVisible();expect(screen.getByText(/Attachment file is not public/)).toHaveTextContent("原文附件 {file}.pdf");
 locale("zh-CN");expect(screen.getByText("提问者")).toBeVisible();locale("en");expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0]?.[1]).toMatchObject({credentials:"omit",referrerPolicy:"no-referrer"});
});
it("retranslates a stored anonymous 404 and retries only on explicit click",async()=>{
 const fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>new Response("{}",{status:404}));vi.stubGlobal("fetch",fetcher);
 render(<I18nProvider initialLocale="en"><PublicChatShareScreen token={"t".repeat(43)}/></I18nProvider>);
 expect(await screen.findByRole("alert")).toHaveTextContent("expired or does not exist");locale("zh-CN");expect(screen.getByRole("alert")).toHaveTextContent("分享链接已失效或不存在");locale("en");expect(fetcher).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole("button",{name:"Retry"}));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
});
function owner(){render(<I18nProvider initialLocale="en"><LanguageSwitcher/><ChatShareButton threadId="raw-thread" bearer="raw-bearer"/></I18nProvider>);fireEvent.click(screen.getByTestId("chat-share-open"));}
it("retains preview and generated URL across locale while publishing exactly once",async()=>{
 let finish!:(value:unknown)=>void;api.createChatShare.mockReturnValue(new Promise(resolve=>{finish=resolve;}));owner();await screen.findByText(snapshot.title);expect(screen.getByRole("heading",{name:"Share conversation"})).toBeVisible();
 fireEvent.click(screen.getByTestId("chat-share-create"));locale("zh-CN");locale("en");expect(screen.getByTestId("chat-share-create")).toBeDisabled();expect(api.createChatShare).toHaveBeenCalledTimes(1);
 await act(async()=>finish({share,token:"t".repeat(43)}));const input=await screen.findByTestId("chat-share-url");const value=(input as HTMLInputElement).value;locale("zh-CN");locale("en");expect(screen.getByTestId("chat-share-url")).toBe(input);expect(input).toHaveValue(value);expect(api.previewChatShare).toHaveBeenCalledTimes(1);expect(api.listChatShares).toHaveBeenCalledTimes(1);expect(api.revokeChatShare).not.toHaveBeenCalled();expect(api.createChatShare).toHaveBeenCalledWith("raw-thread","raw-bearer",preview.revision,expect.any(AbortSignal));
});
it("retranslates an owner failure without replaying publication",async()=>{
 api.createChatShare.mockRejectedValue(new ApiError(404,null,{error:"missing"}));owner();await screen.findByText(snapshot.title);fireEvent.click(screen.getByTestId("chat-share-create"));expect(await screen.findByRole("alert")).toHaveTextContent("conversation creator");locale("zh-CN");expect(screen.getByRole("alert")).toHaveTextContent("只有对话创建者");locale("en");expect(api.createChatShare).toHaveBeenCalledTimes(1);
});

it.each(["server", "invalid", "network"])("masks %s anonymous failures and keeps retry explicit",async(kind)=>{
 const fetcher=vi.fn(async()=>{if(kind==="network")throw new Error("private diagnostics sentinel");return new Response(kind==="invalid"?"{}":"private diagnostics sentinel",{status:kind==="server"?500:200});});vi.stubGlobal("fetch",fetcher);
 render(<I18nProvider initialLocale="en"><PublicChatShareScreen token={"t".repeat(43)}/></I18nProvider>);
 const alert=await screen.findByRole("alert");expect(alert).not.toHaveTextContent("private diagnostics sentinel");expect(alert).toHaveTextContent(kind==="server"?"Cannot read this shared conversation":"Could not load the conversation");locale("zh-CN");locale("en");expect(fetcher).toHaveBeenCalledTimes(1);
});

it("translates shared code controls without resetting disclosure or replaying clipboard",async()=>{
 const raw=Array.from({length:12},(_,i)=>`const 原文${i} = "{raw}";`).join("\n");let finish!:()=>void;const copy=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:copy}});
 render(<I18nProvider initialLocale="en"><LanguageSwitcher/><ChatCodeFence><code className="language-typescript">{raw}</code></ChatCodeFence></I18nProvider>);
 expect(screen.getByTestId("chat-code-fence")).toHaveTextContent("12 lines");expect(screen.getByTestId("chat-code-fence-toggle")).toHaveTextContent("Show code");fireEvent.click(screen.getByTestId("chat-code-fence-toggle"));fireEvent.click(screen.getByTestId("chat-code-fence-copy"));locale("zh-CN");expect(screen.getByTestId("chat-code-fence")).toHaveAttribute("data-open","true");expect(screen.getByTestId("chat-code-fence-toggle")).toHaveTextContent("隐藏代码");locale("en");await act(async()=>finish());expect(screen.getByTestId("chat-code-fence-copy")).toHaveTextContent("Copied");expect(copy).toHaveBeenCalledTimes(1);expect(copy).toHaveBeenCalledWith(raw);locale("zh-CN");expect(screen.getByTestId("chat-code-fence-copy")).toHaveTextContent("已复制");
});
