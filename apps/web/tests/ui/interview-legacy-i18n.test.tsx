import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { PersistentDigitalInterviewWorkflow } from "@/components/itv/digital-interview-workflow";
import { ExpertPickerDialog } from "@/components/itv/expert-picker-dialog";
import { DigitalInterviewReadiness } from "@/components/itv/digital-interview-readiness";
import { DigitalInterviewEvidenceReview } from "@/components/itv/digital-interview-evidence-review";
import { DigitalInterviewQualityPanel } from "@/components/itv/digital-interview-quality-panel";
import type { DigitalInterviewWorkflowView as View } from "@/lib/interview-api";
const api=vi.hoisted(()=>({push:vi.fn(),confirm:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:api.push})}));
vi.mock("@/lib/interview-api",async original=>({...await original<typeof import("@/lib/interview-api")>(),confirmDigitalInterviewBrief:api.confirm}));
function Language(){const {setLocale}=useI18n();return <><button onClick={()=>setLocale("en")}>EN test</button><button onClick={()=>setLocale("zh-CN")}>ZH test</button></>;}
function show(children:React.ReactNode){return render(<I18nProvider initialLocale="en"><Language/>{children}</I18nProvider>);}
function swap(){fireEvent.click(screen.getByText("ZH test"));fireEvent.click(screen.getByText("EN test"));}
const identity={interviewId:"legacy-locale",name:"原始访谈 {count}",tags:["原标签"],topic:"原始主题",status:"topic_pending",sourceQuickInterviewId:null,selectedExpertIds:[],reportId:null,report:null,reportGeneration:null,version:2,scope:{kind:"none",projectId:null,researchProjectId:null},currentStep:"topic",revisionId:"revision-raw",topicVersionId:null,expertSnapshotVersionId:null,questionVersionId:null,expertCandidates:[],questions:[],questionCandidates:[],skillThreadId:"thread-raw",skillMessages:[],skillProposals:[],expertRuns:[],artifacts:[],researchBrief:{decision:"原始决策",learningGoals:[{goalId:"goal-raw",statement:"原学习目标"}],targetRoles:["原角色"],outOfScope:[],successCriteria:["原标准"]},moderatorPolicy:null,reportReview:null,quality:{previewStatus:"unavailable",briefIssues:[],expertCoverage:[],questionFindings:[],readiness:null,readinessDecision:null,evidenceCoverage:[]},studyEvidenceMode:"simulated",reportEvidenceEligibility:{eligibility:"blocked_missing_participant_evidence",message:"服务端证据边界原文",action:"服务端后续要求原文"}} as View;
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();});
it("localizes the actual setup fallback and unsaved guard without discarding its edited brief",()=>{
 show(<PersistentDigitalInterviewWorkflow initialView={identity}/>);expect(screen.getByRole("heading",{name:"Define research brief"})).toBeVisible();
 fireEvent.change(screen.getByTestId("itv-topic-input"),{target:{value:"用户编辑主题 {count}"}});swap();expect(screen.getByTestId("itv-topic-input")).toHaveValue("用户编辑主题 {count}");
 fireEvent.click(screen.getByTestId("itv-workbench-step-experts"));expect(screen.getByRole("heading",{name:"Unconfirmed changes"})).toBeVisible();fireEvent.click(screen.getByRole("button",{name:"Keep editing"}));expect(screen.getByTestId("itv-topic-input")).toHaveValue("用户编辑主题 {count}");expect(api.confirm).not.toHaveBeenCalled();
});
it("keeps an expert picker selection and query through locale changes and confirms raw IDs",()=>{
 const confirm=vi.fn();const expert={expertId:"expert-raw",displayName:"原专家 {count}",role:"原角色",category:"原分类",bio:"原简介"};
 show(<ExpertPickerDialog open selectedExpertIds={[]} experts={[expert]} onOpenChange={vi.fn()} onConfirm={confirm}/>);
 expect(screen.getByRole("heading",{name:"Add interview experts"})).toBeVisible();fireEvent.click(screen.getByRole("checkbox",{name:"Select expert 原专家 {count}"}));
 fireEvent.change(screen.getByRole("textbox",{name:"Search interview experts"}),{target:{value:"原专家"}});swap();expect(screen.getByRole("checkbox",{name:"Select expert 原专家 {count}"})).toBeChecked();
 expect(screen.getByRole("textbox",{name:"Search interview experts"})).toHaveValue("原专家");fireEvent.click(screen.getByRole("button",{name:"Add selected experts"}));expect(confirm).toHaveBeenCalledTimes(1);expect(confirm).toHaveBeenCalledWith(["expert-raw"]);
});
it("retains a readiness rationale and unchanged decision enum while labels retranslate",()=>{
 const quality={...identity.quality,readiness:{status:"warning",issues:[],estimatedMinutes:{min:5,max:10},ruleVersion:"test-readiness-v1",evaluatedAt:"2026-11-03T00:00:00.000Z"}} as View["quality"];const decide=vi.fn();
 show(<DigitalInterviewReadiness quality={quality} onDecide={decide}/>);const input=screen.getByRole("textbox",{name:"Reason for accepting warnings (10–300 characters)"});fireEvent.change(input,{target:{value:"用户保留的研究理由原文"}});swap();expect(input).toHaveValue("用户保留的研究理由原文");fireEvent.click(screen.getByRole("button",{name:"Confirm readiness and start interview"}));expect(decide).toHaveBeenCalledWith("warning_accepted","用户保留的研究理由原文");
});
it("localizes review controls while preserving notes and the existing approval block",()=>{
 const review=vi.fn();show(<DigitalInterviewEvidenceReview view={{...identity,researchBrief:null}} onReview={review}/>);const input=screen.getByRole("textbox",{name:"Review notes"});fireEvent.change(input,{target:{value:"原始复核备注"}});swap();expect(input).toHaveValue("原始复核备注");expect(screen.getByRole("button",{name:"Approve report"})).toBeDisabled();fireEvent.click(screen.getByRole("button",{name:"Request changes"}));expect(review).toHaveBeenCalledWith("changes_requested","原始复核备注");
});
it("retranslates unavailable quality UI without automatically running its retry",()=>{
 const retry=vi.fn();show(<DigitalInterviewQualityPanel quality={null} unavailable onRetry={retry}/>);expect(screen.getByText("Quality checks are unavailable; status is unknown")).toBeVisible();swap();expect(retry).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Retry checks"}));expect(retry).toHaveBeenCalledTimes(1);
});
it("localizes controlled quality reasons by code while preserving unknown diagnostic content",()=>{
 const quality={...identity.quality,briefIssues:[{code:"BRIEF_SCOPE_MISSING",severity:"warning",message:"请明确本次研究不回答的问题。",objectId:null},{code:"CUSTOM_PRIVATE_REASON",severity:"warning",message:"私有诊断原文 {count}",objectId:null}]} as View["quality"];
 show(<DigitalInterviewQualityPanel quality={quality}/>);expect(screen.getByText(/Clarify which questions this research does not address\./)).toBeVisible();expect(screen.getByText(/私有诊断原文/)).toBeVisible();
 fireEvent.click(screen.getByText("ZH test"));expect(screen.getByText(/请明确本次研究不回答的问题/)).toBeVisible();fireEvent.click(screen.getByText("EN test"));expect(screen.getByText(/Clarify which questions this research does not address\./)).toBeVisible();
});
