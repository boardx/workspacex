import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { knowledgeGraph, type KgClaim } from "@repo/contracts/chat-knowledge-graph";
import { AboutMe } from "@/components/brain/about-me";
import { OriginLinks } from "@/components/brain/personal-memory";
import { ClaimTriStateBadge } from "@/components/chat/knowledge/claim-tri-state-badge";
import { I18nProvider } from "@/lib/i18n/provider";
import { LanguageSwitcher } from "@/components/shell/language-switcher";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
const scope={kind:"personal",id:"me"};
const claim=(id:string,kind:KgClaim["kind"],statement:string)=>({id,scope,kind,statement,status:"proposed",triState:"pending",confidence:0.9,createdBy:"model",reviewedBy:null,supersedesClaimId:null,derivedFromClaimId:`src-${id}`,aboutObjectIds:[],supportingCount:1,contradictingCount:0,createdAt:"2026-09-26T12:00:00Z"});
const personal=knowledgeGraph.getPersonalKnowledge.out.parse({scope,revision:1,objects:[],claims:[claim("goal","goal","原文目标 {goal}"),claim("todo","todo","原文待办 {todo}")],edges:[],replaced:[]});
const origins=personal.claims.map(c=>({personalClaimId:c.id,sourceClaimId:`src-${c.id}`,threadId:"thread-original",projectId:null,threadTitle:"原文对话 {title}",saidAt:"2026-09-26T12:00:00Z",autoCopied:true}));
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
let fetcher:ReturnType<typeof vi.fn>;
beforeEach(()=>{window.localStorage.clear();window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY,"token");fetcher=vi.fn(async()=>json({dismissed:true,items:[]}));vi.stubGlobal("fetch",fetcher);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function locale(value:string){fireEvent.change(screen.getByTestId("language-switcher"),{target:{value}});}
function show(onChanged=vi.fn(async()=>personal)){return render(<I18nProvider initialLocale="en"><LanguageSwitcher/><AboutMe personal={personal} origins={origins} onChanged={onChanged}/></I18nProvider>);}
function goal(){return within(screen.getByTestId("about-me-group-goals")).getAllByTestId("about-me-item")[0]!;}
it("translates panel/groups/origins while retaining original values and one preference read",async()=>{
 show(); await screen.findByTestId("about-me-briefing-off");
 expect(screen.getByTestId("about-me-briefing-off")).toHaveTextContent("turned off"); expect(screen.getByTestId("about-me-briefing-reopen")).toHaveTextContent("Turn back on"); expect(screen.getByTestId("about-me-goal-select")).toHaveTextContent("No linked goal");
 expect(screen.getByRole("heading",{name:"About me"})).toBeTruthy();expect(screen.getByTestId("about-me-group-goals")).toHaveTextContent("Goals");expect(goal()).toHaveTextContent("Saved by AI");expect(goal()).toHaveTextContent("原文目标 {goal}");
 const link=within(goal()).getByTestId("brain-origin-link");expect(link).toHaveTextContent("原文对话 {title}");expect(link).toHaveAttribute("href","/chat/thread-original?memory=src-goal");
 locale("zh-CN");expect(screen.getByRole("heading",{name:"关于我"})).toBeTruthy();locale("en");expect(fetcher).toHaveBeenCalledTimes(1);
});
it("keeps an editing draft, input node and focus when language changes",async()=>{
 show(); await screen.findByTestId("about-me-briefing-off");fireEvent.click(within(goal()).getByTestId("about-me-edit"));const input=screen.getByTestId("about-me-edit-input");fireEvent.change(input,{target:{value:"草稿 {draft}"}});input.focus();
 locale("zh-CN");locale("en");expect(screen.getByTestId("about-me-edit-input")).toBe(input);expect(input).toHaveValue("草稿 {draft}");expect(document.activeElement).toBe(input);expect(screen.getByTestId("about-me-edit-save")).toHaveTextContent("Save");expect(fetcher).toHaveBeenCalledTimes(1);
});
it("retranslates a saved failure without replaying the in-flight raw edit",async()=>{
 let finish!:(response:Response)=>void;fetcher.mockImplementation(async(input:RequestInfo|URL)=>String(input).endsWith("/revise")?new Promise<Response>(resolve=>{finish=resolve;}):json({dismissed:false,items:[]}));const changed=vi.fn(async()=>personal);show(changed);
 fireEvent.click(within(goal()).getByTestId("about-me-edit"));fireEvent.change(screen.getByTestId("about-me-edit-input"),{target:{value:"原文新说法 {text}"}});fireEvent.click(screen.getByTestId("about-me-edit-save"));
 await waitFor(()=>expect(finish).toBeTypeOf("function"));locale("zh-CN");locale("en");expect(screen.getByTestId("about-me-edit-save")).toBeDisabled();
 await act(async()=>finish(json({error:"forbidden",traceId:"t",reasonCode:"KG_NOT_OWNER"},403)));
 await waitFor(()=>expect(screen.getByTestId("err-about-me")).toHaveTextContent("your own conversations"));locale("zh-CN");expect(screen.getByTestId("err-about-me")).toHaveTextContent("只有你自己的对话");locale("en");
 const posts=fetcher.mock.calls.filter(([,init])=>(init as RequestInit|undefined)?.method==="POST");expect(posts).toHaveLength(1);expect(JSON.parse(String((posts[0]![1] as RequestInit).body))).toEqual({statement:"原文新说法 {text}"});expect(changed).toHaveBeenCalledTimes(1);expect(screen.getByTestId("about-me-edit-input")).toHaveValue("原文新说法 {text}");
});
it("keeps default Chinese shared consumers outside About me",()=>{
 render(<><ClaimTriStateBadge status="proposed"/><OriginLinks origins={origins.slice(0,1)}/></>);expect(screen.getByTestId("kg-tri-state-pending")).toHaveTextContent("AI 记下的");expect(screen.getByTestId("brain-origin-time")).toHaveTextContent("来自你");
});
