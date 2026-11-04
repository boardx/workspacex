import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { DigitalInterviewSetup } from "@/components/itv/digital-interview-setup";
import { InterviewMarkdownPlanningStep } from "@/components/itv/interview-markdown-planning-step";
import { InterviewMarkdownResultsStep } from "@/components/itv/interview-markdown-results-step";
import { InterviewSessionProvider, useInterviewSource } from "@/components/itv/interview-session-provider";
import { ApiError } from "@/lib/api-client";
import type { InterviewMarkdownEnvelope } from "@/lib/interview-markdown-api";
const api=vi.hoisted(()=>({identity:vi.fn(),load:vi.fn(),initialize:vi.fn(),save:vi.fn(),confirm:vi.fn(),generate:vi.fn(),directory:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn()})}));
vi.mock("@/lib/interview-api",async original=>({...await original<typeof import("@/lib/interview-api")>(),loadDigitalInterview:api.identity,loadDigitalExperts:api.directory}));
vi.mock("@/lib/interview-markdown-api",async original=>({...await original<typeof import("@/lib/interview-markdown-api")>(),loadInterviewMarkdown:api.load,initializeInterviewMarkdown:api.initialize,saveInterviewMarkdown:api.save,confirmInterviewMarkdown:api.confirm,generateInterviewMarkdown:api.generate}));
const raw="# 原始需求 {count}\n\n## 目标\n用户原文不得翻译。";
function source(step:"intake"|"report"="intake"):InterviewMarkdownEnvelope{return {interviewId:"locale-itv",revisionId:"revision-raw",version:2,documents:[{documentId:"document-"+step,step,version:1,contentHash:"a".repeat(64),evidenceMode:"simulated",references:[],markdown:raw}],states:[{documentId:"document-"+step,status:step==="report"?"completed":"draft",failure:null}],execution:null,review:null};}
function Language(){const {setLocale}=useI18n();return <><button onClick={()=>setLocale("en")}>EN test</button><button onClick={()=>setLocale("zh-CN")}>ZH test</button></>;}
function show(children:React.ReactNode){return render(<I18nProvider initialLocale="en"><Language/>{children}</I18nProvider>);}
function swap(){fireEvent.click(screen.getByText("ZH test"));fireEvent.click(screen.getByText("EN test"));}
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();api.initialize.mockResolvedValue(source());api.load.mockResolvedValue(source());api.directory.mockResolvedValue({items:[]});});
it("localizes setup loading and failure without replaying its pending identity read",async()=>{
 let fail!:(error:Error)=>void;api.identity.mockImplementation(()=>new Promise((_resolve,reject)=>{fail=reject;}));show(<DigitalInterviewSetup interviewId="locale-itv"/>);
 expect(screen.getByText("Recovering interview draft…")).toBeVisible();swap();expect(api.identity).toHaveBeenCalledTimes(1);
 await act(async()=>fail(Error("DEPENDENCY_UNAVAILABLE")));expect(screen.getByText(/The interview could not be loaded/)).toBeVisible();swap();expect(api.identity).toHaveBeenCalledTimes(1);
});
it("retranslates planning failures without retrying initialization until requested",async()=>{
 api.initialize.mockRejectedValueOnce(Error("PRIVATE_PROVIDER_DETAIL"));show(<InterviewMarkdownPlanningStep interviewId="locale-itv" step="analysis" onVersionChange={vi.fn()} onDirtyChange={vi.fn()} onContinue={vi.fn()}/>);
 expect(await screen.findByRole("alert")).toHaveTextContent("Saved content and your current draft are preserved");swap();expect(api.initialize).toHaveBeenCalledTimes(1);expect(screen.queryByText("PRIVATE_PROVIDER_DETAIL")).not.toBeInTheDocument();
});
it("retains a pending canonical save and exact Markdown payload through language changes",async()=>{
 let finish!:(value:InterviewMarkdownEnvelope)=>void;api.save.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const dirty=vi.fn();
 show(<InterviewMarkdownPlanningStep interviewId="locale-itv" step="intake" onVersionChange={vi.fn()} onDirtyChange={dirty} onContinue={vi.fn()}/>);
 const input=await screen.findByRole("textbox",{name:"Research requirements Markdown"});await waitFor(()=>expect(input).toBeEnabled());fireEvent.change(input,{target:{value:raw+"\n\n私有补充"}});fireEvent.click(screen.getByRole("button",{name:"Next: confirm analysis"}));
 await waitFor(()=>expect(api.save).toHaveBeenCalledTimes(1));const request=api.save.mock.calls[0]!;expect(request[2].markdown).toBe(raw+"\n\n私有补充");swap();expect(api.save).toHaveBeenCalledTimes(1);expect(api.save.mock.calls[0]).toBe(request);expect(input).toHaveValue(raw+"\n\n私有补充");
 // Reject completion through the normal recovery boundary; do not invent a successful report.
 api.confirm.mockRejectedValueOnce(new ApiError(409,"CONFLICT",{}));await act(async()=>finish(source()));
 expect(await screen.findByRole("alert")).toHaveTextContent("The document version changed");
});
it("shows a saved report without replaying reads or model commands when locale changes",async()=>{
 api.initialize.mockResolvedValue(source("report"));api.load.mockResolvedValue(source("report"));
 show(<InterviewMarkdownResultsStep interviewId="locale-itv" step="report" runs={[]} onVersionChange={vi.fn()} onReport={vi.fn()}/>);
 expect(await screen.findByTestId("itv-source-report-markdown")).toHaveTextContent("用户原文不得翻译。");const reads=api.load.mock.calls.length;const initializations=api.initialize.mock.calls.length;swap();
 expect(api.load).toHaveBeenCalledTimes(reads);expect(api.initialize).toHaveBeenCalledTimes(initializations);expect(api.generate).not.toHaveBeenCalled();expect(screen.getByRole("navigation",{name:"Report contents"})).toBeVisible();
});
function Sync(){const {syncError,refresh}=useInterviewSource("locale-itv");return <><button onClick={()=>void refresh().catch(()=>{})}>Refresh test</button>{syncError&&<p role="status">{syncError}</p>}</>;}
it("keeps a cached sync failure semantic so it can retranslate without another request",async()=>{
 api.load.mockRejectedValue(Error("PRIVATE_SYNC_DETAIL"));show(<InterviewSessionProvider><Sync/></InterviewSessionProvider>);fireEvent.click(screen.getByText("Refresh test"));
 expect(await screen.findByRole("status")).toHaveTextContent("Latest interview data could not be synced");swap();expect(screen.getByRole("status")).toHaveTextContent("Latest interview data could not be synced");expect(api.load).toHaveBeenCalledTimes(1);
});
