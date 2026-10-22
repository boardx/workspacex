import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CreditConsumptionNotice } from "@/components/billing/credit-consumption-notice";
import { ConsumptionSettingsPanel } from "@/components/admin/consumption-settings-panel";
import { notifyCreditFailure } from "@/lib/credit-guidance";
import { apiRequest } from "@/lib/api-client";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("HTTP credit rejection preserves draft and offers scoped recharge without retry", async () => {
 const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({code:"credit_required",ownerType:"team",ownerId:"org-a",rechargePath:"/billing?ownerType=team&ownerId=org-a&purchase=1"}), {status:402})); vi.stubGlobal("fetch",fetcher);
 render(<><textarea aria-label="草稿" defaultValue="保留附件与问题" /><CreditConsumptionNotice /></>);
 await expect(apiRequest("/model-call")).rejects.toBeTruthy();
 expect((screen.getByLabelText("草稿") as HTMLTextAreaElement).value).toBe("保留附件与问题");
 expect((await screen.findByRole("link",{name:"为组织充值"})).getAttribute("href")).toBe("/billing?ownerType=team&ownerId=org-a&purchase=1");
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it("accounting outage never offers misleading recharge and unknown ownership guides admin", () => {
 render(<CreditConsumptionNotice />);
 fireEvent(window,new CustomEvent("workspacex:credit-failure",{detail:{code:"credit_accounting_unavailable"}}));
 expect(screen.getByRole("alert").textContent).toContain("计费服务暂时不可用"); expect(screen.queryByRole("link")).toBeNull();
 fireEvent(window,new CustomEvent("workspacex:credit-failure",{detail:{code:"CREDIT_REQUIRED"}}));
 expect(screen.getByRole("alert").textContent).toContain("管理员"); expect(screen.queryByRole("link")).toBeNull();
});
it("untrusted recharge destinations cannot navigate away", () => {
 render(<CreditConsumptionNotice />);
 fireEvent(window,new CustomEvent("workspacex:credit-failure",{detail:{code:"credit_required",ownerType:"user",ownerId:"u",rechargePath:"https://evil.example/"}}));
 expect(screen.queryByRole("link")).toBeNull();
 expect(notifyCreditFailure({code:"unrelated"})).toBe(false);
});
it("platform control reads authoritative setting and saves explicit choice", async () => {
 const fetcher=vi.fn().mockImplementation((_url: string,opts:RequestInit)=>Promise.resolve(new Response(JSON.stringify({creditPreflightEnabled:opts.method==="PATCH"?true:false}),{status:200})));vi.stubGlobal("fetch",fetcher);
 render(<ConsumptionSettingsPanel />);
 const toggle=await screen.findByRole("switch",{name:"使用模型前验证可用额度"}); expect(toggle.getAttribute("aria-checked")).toBe("false");
 fireEvent.click(toggle); await waitFor(()=>expect(toggle.getAttribute("aria-checked")).toBe("true"));
 expect(fetcher.mock.calls[1]![1]).toMatchObject({method:"PATCH",body:JSON.stringify({creditPreflightEnabled:true})});
});
it("forbidden settings are hidden and failed save retains last confirmed setting", async () => {
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("{}",{status:403})));const view=render(<ConsumptionSettingsPanel />);
 await waitFor(()=>expect(screen.queryByRole("switch")).toBeNull()); view.unmount();
 let calls=0;vi.stubGlobal("fetch",vi.fn().mockImplementation(()=>Promise.resolve(new Response(JSON.stringify({creditPreflightEnabled:false}),{status:++calls===1?200:503}))));render(<ConsumptionSettingsPanel />);
 const toggle=await screen.findByRole("switch");fireEvent.click(toggle);await screen.findByText("设置未保存，仍沿用上次确认的状态。");expect(toggle.getAttribute("aria-checked")).toBe("false");
});

import { CashierLedgerHistory } from "@/components/billing/cashier-ledger-history";
import { TeamBillingOverview } from "@/components/billing/team-billing-overview";
import { openAgentRunStream } from "@/lib/agent-run-stream";
it("SSE credit terminal shows guidance without replaying", async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response('data: {"type":"final","status":"failed","error":"CREDIT_REQUIRED"}\n\n',{status:200}));vi.stubGlobal("fetch",fetcher);render(<CreditConsumptionNotice/>);
 const events:unknown[]=[];await openAgentRunStream("run-a",event=>events.push(event));await screen.findByRole("alert");expect(screen.getByRole("alert").textContent).toContain("计费账户");expect(events).toHaveLength(1);expect(fetcher).toHaveBeenCalledTimes(1);
});
it("fractional consume ledger shows negative movement and debt",()=>{
 render(<CashierLedgerHistory owner={{ownerType:"user",ownerId:"u"}} sessionToken="s" onDenied={()=>{}} initial={{items:[{txnId:"txn1",type:"consume",sourceType:"model_request",sourceId:"request1",operatorId:null,reason:null,direction:-1,credits:0.01,balanceAfter:-0.01,createdAt:"2026-10-22T00:00:00Z"}],nextCursor:null}}/>);
 expect(screen.getByText("模型消费")).toBeTruthy();expect(screen.getByText("−0.01")).toBeTruthy();expect(screen.getByText("-0.01")).toBeTruthy();
});
it("organization recharge never substitutes personal wallet after denial",async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response("{}",{status:403}));vi.stubGlobal("fetch",fetcher);render(<TeamBillingOverview ownerId="org-a" sessionToken="s" openOnReady/>);
 expect((await screen.findByRole("alert")).textContent).toContain("组织管理员");expect(screen.queryByRole("button",{name:"为组织充值"})).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);expect(new URL(fetcher.mock.calls[0]![0]).searchParams.get("ownerType")).toBe("team");
});
it("organization wallet fractional debt is visible",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({wallet:{ownerType:"team",ownerId:"org-a",balance:-0.07,totalPurchased:0,totalGranted:0,updatedAt:"2026-10-22T00:00:00Z"}}))));render(<TeamBillingOverview ownerId="org-a" sessionToken="s"/>);
 expect(await screen.findByText("-0.07")).toBeTruthy();expect(screen.getByText("待结算欠额 0.07 额度")).toBeTruthy();
});
import { openAgentKernelRunEvents } from "@/lib/agent-kernel-stream";
it("typed websocket credit failure closes intentionally without reconnect or replay",async()=>{
 class Socket extends EventTarget { close=vi.fn(()=>this.dispatchEvent(new Event("close"))); }
 const socket=new Socket();const close=vi.fn();const receive=vi.fn();render(<CreditConsumptionNotice/>);
 openAgentKernelRunEvents("r",null,"s",{onEvent:receive,onClose:close},{createSocket:()=>socket as unknown as WebSocket});
 fireEvent(socket,new MessageEvent("message",{data:JSON.stringify({code:"credit_required",ownerType:"user",ownerId:"u",rechargePath:"/billing?purchase=1"})}));
 expect(await screen.findByRole("link",{name:"前往充值"})).toBeTruthy();expect(close).toHaveBeenCalledWith({intentional:true});expect(socket.close).toHaveBeenCalledTimes(1);expect(receive).not.toHaveBeenCalled();
});
