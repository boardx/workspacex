import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QuickDigitalInterview } from "@/components/itv/quick-digital-interview";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/session/session-provider", () => ({ useSession: () => ({ session: { currentOrgId: "org" } }) }));
const json = (b: unknown, s=200) => new Response(JSON.stringify(b), { status:s, headers:{"content-type":"application/json"} });
const initial = { interviewId:"q1", expert:{ expertId:"e1", initials:"DE", displayName:"德国采购总监", role:"采购决策", domains:["采购"], materialBoundary:"未绑定 Context Pack 材料版本", exploratory:true }, messages:[], version:1 };
describe("F03 快捷访谈独立页", () => {
  beforeEach(() => { push.mockReset(); localStorage.setItem(SESSION_TOKEN_STORAGE_KEY,"tok"); vi.stubGlobal("fetch", vi.fn(async (input:RequestInfo|URL, init?:RequestInit) => {
    const u=new URL(input.toString()); if (u.pathname.endsWith("/messages")) return json({...initial, messages:[{messageId:"m1",role:"user",text:"谁否决？",exploratory:true,sourcePointers:[],createdAt:"2026-08-12T00:00:00.000Z"},{messageId:"m2",role:"assistant",text:"采购总监否决",exploratory:true,sourcePointers:[],createdAt:"2026-08-12T00:00:01.000Z"}],version:2},201);
    if (u.pathname.endsWith("/convert")) return json({interviewId:"batch1",name:"快捷访谈转批量",tags:["快捷访谈"],topic:"谁否决？",status:"draft",sourceQuickInterviewId:"q1",selectedExpertIds:[],reportId:null,version:1},201);
    if (init?.method === "GET") return json(initial); throw new Error(u.pathname);
  })); });
  afterEach(()=>vi.unstubAllGlobals());
  it("是完整页面，返回专家列表并可发送问题", async()=>{ render(<QuickDigitalInterview interviewId="q1"/>); expect(await screen.findByTestId("itv-quick-page")).toBeInTheDocument(); expect(screen.getByTestId("itv-quick-back")).toHaveAttribute("href","/itv?tab=experts"); fireEvent.change(screen.getByLabelText("访谈问题"),{target:{value:"谁否决？"}}); fireEvent.click(screen.getByRole("button",{name:"发送"})); expect(await screen.findByText("采购总监否决")).toBeInTheDocument(); expect(screen.getByText("探索性回答")).toBeInTheDocument(); });
  it("转为批量草稿后进入 setup", async()=>{ render(<QuickDigitalInterview interviewId="q1"/>); await screen.findByTestId("itv-quick-page"); fireEvent.click(screen.getByTestId("itv-convert-batch")); await waitFor(()=>expect(push).toHaveBeenCalledWith("/itv/batch1/setup")); });
});
