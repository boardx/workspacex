import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { QuickDigitalInterview } from "@/components/itv/quick-digital-interview";
import LiveInterviewPage from "@/app/itv/live/page";
import { InterviewSkillAssistant, PersistentInterviewSkillAssistant } from "@/components/itv/interview-skill-assistant";
import { InterviewSkillContent } from "@/components/itv/interview-skill-content";
import type { DigitalInterviewWorkflowView, QuickDigitalInterview as QuickView } from "@/lib/interview-api";
import type { MockDigitalInterviewDraft } from "@/lib/mock/digital-interview-drafts";
const api=vi.hoisted(()=>({loadQuick:vi.fn(),sendQuick:vi.fn(),convert:vi.fn(),start:vi.fn(),list:vi.fn(),login:vi.fn(),push:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:api.push})}));
vi.mock("@/lib/interview-api",async original=>({...await original<typeof import("@/lib/interview-api")>(),loadQuickDigitalInterview:api.loadQuick,sendQuickDigitalInterviewMessage:api.sendQuick,convertQuickDigitalInterview:api.convert,startQuickDigitalInterview:api.start}));
vi.mock("@/lib/live-interviews",async original=>({...await original<typeof import("@/lib/live-interviews")>(),listInterviews:api.list,login:api.login}));
function Language(){const {setLocale}=useI18n();return <><button onClick={()=>setLocale("en")}>EN test</button><button onClick={()=>setLocale("zh-CN")}>ZH test</button></>;}
function show(children:React.ReactNode){return render(<I18nProvider initialLocale="en"><Language/>{children}</I18nProvider>);}
function swap(){fireEvent.click(screen.getByText("ZH test"));fireEvent.click(screen.getByText("EN test"));}
const initial={interviewId:"quick-raw",expert:{expertId:"raw-expert",displayName:"原专家 {count}",role:"原角色",domains:["原领域"],materialBoundary:"原边界",exploratory:true},messages:[],version:2} as unknown as QuickView;
const mockDraft={name:"原访谈",topic:"原主题",skillMessages:[],pendingSuggestion:null,undoSnapshot:null} as unknown as MockDigitalInterviewDraft;
const view={revisionId:"raw-revision",skillMessages:[{messageId:"raw-message",role:"user",text:"私有问题 {count}"}],skillProposals:[],selectedExpertIds:[],expertCandidates:[]} as unknown as DigitalInterviewWorkflowView;
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();api.loadQuick.mockResolvedValue(initial);api.list.mockResolvedValue({items:[],counts:{human:0,virtual:0}});});
it("preserves a pending quick message and exact source version through locale changes",async()=>{
 let finish!:(value:QuickView)=>void;api.sendQuick.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));show(<QuickDigitalInterview interviewId="quick-raw"/>);
 const input=await screen.findByRole("textbox",{name:"Interview question"});fireEvent.change(input,{target:{value:"用户原始问题 {count}"}});fireEvent.click(screen.getByRole("button",{name:"Send"}));swap();
 expect(input).toHaveValue("用户原始问题 {count}");expect(api.sendQuick).toHaveBeenCalledTimes(1);expect(api.sendQuick).toHaveBeenCalledWith("quick-raw","用户原始问题 {count}",2);expect(api.loadQuick).toHaveBeenCalledTimes(1);
 await act(async()=>finish({...initial,version:3}));
});
it("localizes quick loading errors without reissuing the identity read",async()=>{
 api.loadQuick.mockRejectedValueOnce(Error("DEPENDENCY_UNAVAILABLE"));show(<QuickDigitalInterview interviewId="quick-raw"/>);
 expect(await screen.findByText(/The quick interview could not be loaded/)).toBeVisible();swap();expect(api.loadQuick).toHaveBeenCalledTimes(1);
});
it("keeps live-list login input and its one pending login across locale changes",async()=>{
 let fail!:(cause:Error)=>void;api.login.mockImplementation(()=>new Promise((_resolve,reject)=>{fail=reject;}));show(<LiveInterviewPage/>);
 const email=screen.getByPlaceholderText("Email");fireEvent.change(email,{target:{value:"raw@example.test"}});fireEvent.change(screen.getByPlaceholderText("Password"),{target:{value:"raw-password"}});fireEvent.click(screen.getByRole("button",{name:"Sign in"}));swap();expect(email).toHaveValue("raw@example.test");expect(api.login).toHaveBeenCalledTimes(1);
 await act(async()=>fail(Error("DEPENDENCY_UNAVAILABLE")));
});
it("localizes live scope and empty results while preserving canonical query values",async()=>{
 localStorage.setItem("wsx.sessionToken","raw-token");show(<LiveInterviewPage/>);fireEvent.click(await screen.findByRole("button",{name:"Refresh interviews"}));
 expect(await screen.findByText("No interviews in this scope yet.")).toBeVisible();swap();expect(api.list).toHaveBeenCalledTimes(1);expect(api.list).toHaveBeenCalledWith({scope:{kind:"none",projectId:null,researchProjectId:null}});
});
it("prefills a localized editable shortcut without auto-send and retains edits on locale changes",()=>{
 const send=vi.fn();show(<InterviewSkillAssistant draft={mockDraft} onSend={send} onApply={vi.fn()} onUndo={vi.fn()}/>);
 fireEvent.click(screen.getByRole("button",{name:"Recommend experts"}));const input=screen.getByTestId("itv-skill-input");expect(input).toHaveValue("Recommend experts");expect(send).not.toHaveBeenCalled();
 fireEvent.change(input,{target:{value:"用户改写的提问"}});swap();expect(input).toHaveValue("用户改写的提问");expect(send).not.toHaveBeenCalled();
});
it("keeps a persistent assistant send pending without replaying it or translating private messages",async()=>{
 let finish!:(value:boolean)=>void;const send=vi.fn(()=>new Promise<boolean>(resolve=>{finish=resolve;}));show(<PersistentInterviewSkillAssistant view={view} currentStep="topic" onSend={send} onApply={async()=>true} onReject={async()=>true}/>);
 expect(screen.getByRole("heading",{name:"Interview Skill assistant"})).toBeVisible();fireEvent.change(screen.getByTestId("itv-skill-input"),{target:{value:"用户原始提问"}});fireEvent.click(screen.getByTestId("itv-skill-send"));swap();expect(send).toHaveBeenCalledTimes(1);expect(send).toHaveBeenCalledWith("用户原始提问");expect(screen.getByText("私有问题 {count}")).toBeVisible();await act(async()=>finish(true));
});
it("localizes proposal scaffolding without rewriting machine patch IDs",()=>{
 const patch={expertIds:["unavailable-expert"]};show(<InterviewSkillContent patch={patch} view={view} compareExpertIds={[]}/>);expect(screen.getByText("Expert profile unavailable")).toBeVisible();swap();expect(patch.expertIds).toEqual(["unavailable-expert"]);
});
