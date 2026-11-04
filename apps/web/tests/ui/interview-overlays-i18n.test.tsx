import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ExpertAvatarEditor } from "@/components/itv/expert-avatar";
import { ExpertProfileInputs, ExpertProfileDetails } from "@/components/itv/interview-expert-profile-fields";
import { emptyExpertProfile } from "@/lib/interview-expert-profile";
import { InterviewReportSources } from "@/components/itv/interview-report-sources";
import type { InterviewMarkdownDocument } from "@/lib/interview-markdown-api";
import { InterviewReportGeneration } from "@/components/itv/interview-report-generation";
import type { InterviewGenerationSession } from "@/lib/interview-generation-session";
const api=vi.hoisted(()=>({save:vi.fn(),load:vi.fn()}));
vi.mock("@/lib/interview-expert-avatar",async original=>({...await original<typeof import("@/lib/interview-expert-avatar")>(),saveExpertAvatar:api.save,loadExpertAvatar:api.load,readExpertAvatar:()=>"robot"}));
function Language(){const {setLocale}=useI18n();return <><button onClick={()=>setLocale("en")}>EN test</button><button onClick={()=>setLocale("zh-CN")}>ZH test</button></>;}
function show(children:React.ReactNode){return render(<I18nProvider initialLocale="en"><Language/>{children}</I18nProvider>);}
function swap(){fireEvent.click(screen.getByText("ZH test"));fireEvent.click(screen.getByText("EN test"));}
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();localStorage.setItem("wsx.sessionToken","test-token");api.load.mockResolvedValue(undefined);});
it("keeps the selected avatar and exact pending save across locale changes",async()=>{
 let finish!:()=>void;api.save.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
 show(<ExpertAvatarEditor expertId="raw-expert" displayName="原专家 {count}"/>);
 fireEvent.click(screen.getByRole("button",{name:"Change avatar for 原专家 {count}"}));fireEvent.click(screen.getByRole("button",{name:"Person avatar 2"}));fireEvent.click(screen.getByRole("button",{name:"Save avatar"}));
 swap();expect(screen.getByRole("button",{name:"Person avatar 2"})).toHaveAttribute("aria-pressed","true");expect(api.save).toHaveBeenCalledTimes(1);expect(api.save.mock.calls[0]![0]).toBe("raw-expert");
 await act(async()=>finish());
});
it("localizes optional profile field labels while preserving raw values and callbacks",()=>{
 const draft={...emptyExpertProfile(),occupation:"原职业",goals:"原目标\n第二行"};const change=vi.fn();
 show(<ExpertProfileInputs draft={draft} onChange={change}/>);expect(screen.getByRole("textbox",{name:"Occupation"})).toHaveValue("原职业");swap();
 expect(screen.getByRole("textbox",{name:"Goals"})).toHaveValue("原目标\n第二行");expect(change).not.toHaveBeenCalled();
});
it("localizes profile-detail field names and missing-value UI without rewriting private content",()=>{
 show(<ExpertProfileDetails fields={{name:"私有专家",role:"原角色",domains:"原领域",focus:"原关注",style:"原风格",bio:"原简介",limits:"原边界"}}/>);
 expect(screen.getByText("Professional domains")).toBeVisible();expect(screen.getAllByText("Not provided").length).toBeGreaterThan(0);swap();expect(screen.getByText("原简介")).toBeVisible();
});
it("localizes streaming report progress while preserving partial model output",()=>{
 const raw="# 报告原文\n\n尚未完成的模型正文 {count}";
 const session={stage:"validation",attempt:2,markdown:raw,previousCandidateMarkdown:"旧候选",status:"running"} as InterviewGenerationSession;
 show(<InterviewReportGeneration session={session}/>);expect(screen.getByRole("list",{name:"Report generation progress"})).toBeVisible();swap();
 expect(screen.getByTestId("itv-report-stream-markdown")).toHaveTextContent("尚未完成的模型正文 {count}");expect(session.markdown).toBe(raw);
});

it("localizes source-validation scaffolding while retaining exact quotations and identity checks",()=>{
 const quote="服务端保存的原话 {count}";const hash="a".repeat(64);
 const answer={documentId:"saved-source",step:"runs",version:1,contentHash:hash,markdown:quote,evidenceMode:"simulated",references:[],answerSpans:[{taskKey:"revision/raw",expertId:"raw",start:0,end:quote.length,contentHash:hash}]} as InterviewMarkdownDocument;
 const report={documentId:"saved-report",step:"report",version:2,contentHash:"b".repeat(64),markdown:"# 报告原文",evidenceMode:"simulated",references:[{anchor:"answer-1",documentId:answer.documentId,version:1,locator:{sourceHash:hash,start:0,end:quote.length,quote,expertId:"raw",taskKey:"revision/raw",evidenceMode:"simulated"}}]} as InterviewMarkdownDocument;
 const view=show(<InterviewReportSources report={report} sources={[answer]} experts={[]}/>);
 expect(screen.getByRole("region",{name:"Report source quotations"})).toBeVisible();expect(screen.getByText(quote)).toBeVisible();swap();expect(screen.getByText(quote)).toBeVisible();
 view.rerender(<I18nProvider initialLocale="en"><Language/><InterviewReportSources report={report} sources={[{...answer,contentHash:"c".repeat(64)}]} experts={[]}/></I18nProvider>);
 expect(screen.getByRole("alert")).toHaveTextContent("The available source does not match");expect(report.markdown).toBe("# 报告原文");expect(report.references[0]!.locator!.quote).toBe(quote);
});
