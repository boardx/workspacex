import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { InterviewExpertsStep } from "@/components/itv/interview-experts-step";
import { InterviewOutlineStep } from "@/components/itv/interview-outline-step";
import { InterviewRunsStep } from "@/components/itv/interview-runs-step";
import { InterviewExpertLibrary } from "@/components/itv/interview-expert-library";
import { DigitalExpertDetail } from "@/components/itv/digital-expert-detail";
import type { InterviewMarkdownDocument } from "@/lib/interview-markdown-api";
const api = vi.hoisted(() => ({ directory: vi.fn(), custom: vi.fn() }));
vi.mock("@/lib/interview-api", async original => ({ ...await original<typeof import("@/lib/interview-api")>(), loadDigitalExperts: api.directory }));
vi.mock("@/lib/interview-expert-library-api", () => ({ loadCustomInterviewExperts: api.custom, createCustomInterviewExpert: vi.fn() }));
const rawExpert = "## [原始专家 {count}](#expert-raw)\n\n专业角色：原始角色\n\n领域：原始领域\n";
const rawQuestions = "## [原始专家 {count}](#expert-raw)\n\n1. 最近一次发生了什么？\n2. 你如何处理？\n";
function doc(step: InterviewMarkdownDocument["step"], markdown: string): InterviewMarkdownDocument { return { documentId: "raw-"+step, step, markdown, version: 2, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [] } as InterviewMarkdownDocument; }
function Language() { const { setLocale }=useI18n(); return <><button onClick={()=>setLocale("en")}>EN test</button><button onClick={()=>setLocale("zh-CN")}>ZH test</button></>; }
function show(children:React.ReactNode) { return render(<I18nProvider initialLocale="en"><Language/>{children}</I18nProvider>); }
function swap() { fireEvent.click(screen.getByText("ZH test")); fireEvent.click(screen.getByText("EN test")); }
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();api.custom.mockResolvedValue({items:[]});api.directory.mockResolvedValue({items:[]});});
it("keeps expert search and selected canonical content while directory controls retranslate", async()=>{
 const change=vi.fn();show(<InterviewExpertsStep document={doc("experts",rawExpert)} directory={[]} directoryStatus="error" pending={false} onChange={change} onConfirm={vi.fn()}/>);
 const search=screen.getByRole("textbox",{name:"Search experts"});fireEvent.change(search,{target:{value:"用户原查询"}});swap();
 expect(screen.getByRole("textbox",{name:"Search experts"})).toBe(search);expect(search).toHaveValue("用户原查询");expect(screen.getByTestId("itv-expert-directory-error")).toHaveTextContent("The expert library could not be loaded");expect(change).not.toHaveBeenCalled();
});
it("preserves the virtual expert description draft and opens localized field labels",()=>{
 show(<InterviewExpertsStep document={doc("experts",rawExpert)} directory={[]} pending={false} onChange={vi.fn()} onConfirm={vi.fn()}/>);
 fireEvent.click(screen.getByRole("button",{name:"Add virtual expert"}));const description=screen.getByRole("textbox",{name:"What kind of expert do you need?"});fireEvent.change(description,{target:{value:"私有角色与边界"}});swap();
 expect(description).toHaveValue("私有角色与边界");expect(screen.getByRole("textbox",{name:"Expert name"})).toHaveValue("");expect(screen.getByRole("button",{name:"Save and add expert"})).toBeDisabled();
});
it("keeps question text and focus identity through locale changes without saving",()=>{
 const change=vi.fn();show(<InterviewOutlineStep document={doc("outline",rawQuestions)} expertsDocument={doc("experts",rawExpert)} pending={false} onChange={change} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()}/>);
 const input=screen.getByRole("textbox",{name:"Edit question 1"});expect(input).toHaveValue("最近一次发生了什么？");swap();expect(screen.getByRole("textbox",{name:"Edit question 1"})).toBe(input);expect(input).toHaveValue("最近一次发生了什么？");expect(change).not.toHaveBeenCalled();
});
it("localizes a newly inserted editable question without rewriting existing content",()=>{
 const change=vi.fn();show(<InterviewOutlineStep document={doc("outline",rawQuestions)} pending={false} onChange={change} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()}/>);
 fireEvent.click(screen.getByRole("button",{name:"Add question"}));expect(change).toHaveBeenCalledTimes(1);expect(change.mock.calls[0]![0]).toContain("3. New question?");expect(change.mock.calls[0]![0]).toContain("1. 最近一次发生了什么？");
});
it("localizes running interview controls without changing durable progress or replaying generation",()=>{
 const generate=vi.fn();show(<InterviewRunsStep runs={[{expertId:"raw",displayName:"原始专家 {count}",status:"running",completedQuestions:1,totalQuestions:2}]} pending onGenerateReport={generate}/>);
 expect(screen.getByRole("heading",{name:"Interview execution"})).toBeVisible();swap();expect(screen.getByText("原始专家 {count}")).toBeVisible();expect(generate).not.toHaveBeenCalled();
});
it("localizes the private expert create dialog and retains raw edited fields",async()=>{
 show(<InterviewExpertLibrary includeBuiltins={false}/>);fireEvent.click(await screen.findByRole("button",{name:"Add expert"}));const input=screen.getByRole("textbox",{name:"Name"});fireEvent.change(input,{target:{value:"私有专家 {count}"}});swap();expect(screen.getByRole("textbox",{name:"Name"})).toBe(input);expect(input).toHaveValue("私有专家 {count}");expect(screen.getByRole("button",{name:"Save expert"})).toBeVisible();
});
it("retranslates the expert detail unavailable state without another directory read",async()=>{
 show(<DigitalExpertDetail expertId="not-existing-locale-expert"/>);expect(await screen.findByText("This expert is unavailable or you do not have access.")).toBeVisible();swap();expect(screen.getByRole("link",{name:"Back to expert library"})).toHaveAttribute("href","/itv?tab=experts");expect(api.directory).toHaveBeenCalledTimes(1);
});
it("localizes fixed category choices while preserving their canonical filter values",()=>{
 const change=vi.fn();show(<InterviewExpertsStep document={doc("experts",rawExpert)} directory={[]} pending={false} onChange={change} onConfirm={vi.fn()}/>);
 const select=screen.getByRole("combobox",{name:"Expert domain"});expect(screen.getByRole("option",{name:"Technical experts"})).toHaveValue("技术专家");fireEvent.change(select,{target:{value:"技术专家"}});swap();expect(select).toHaveValue("技术专家");expect(change).not.toHaveBeenCalled();
});
