import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";
import { PlatformOrganizationsScreen } from "@/components/admin/platform-organizations-screen";
const mocks=vi.hoisted(()=>({list:vi.fn(),detail:vi.fn(),save:vi.fn(),grant:vi.fn(),usage:vi.fn(),hasSession:false,scope:"account-a"}));
vi.mock("@/components/session/session-provider",()=>({useOptionalSession:()=>mocks.hasSession?{}:null}));
vi.mock("@/lib/authenticated-session-scope",()=>({useAuthenticatedSessionScope:()=>mocks.scope}));
vi.mock("@/lib/live-platform-organizations",()=>({listPlatformOrganizations:mocks.list,getPlatformOrganization:mocks.detail,setPlatformOrganizationPlan:mocks.save,getPlatformAiPolicy:async()=>({version:0,configuration:null,priceVersion:null,updatedAt:null,updatedBy:null,enforcement:"pending",changes:[]}),getPlatformAiCandidates:async()=>[]}));
vi.mock("@/lib/live-ai-usage",()=>({readAiUsage:async(...args:unknown[])=>{mocks.usage(...args);throw new Error("fixture current usage unavailable");},readAiUsageCalls:async()=>{throw new Error("fixture current calls unavailable");}}));
vi.mock("@/lib/live-enterprise-management",()=>({grantEnterpriseCredits:mocks.grant,upgradeEnterprise:vi.fn()}));
vi.mock("@/components/admin/admin-screen",()=>({AdminScreen:({children}:{children:React.ReactNode})=><div>{children}</div>}));
const org={orgId:"empty-saas",name:"Empty SaaS",kind:"organization",memberCount:0,
 plan:{plan:null,version:0,updatedAt:null,updatedBy:null,enforcement:"pending"}};
afterEach(()=>{cleanup();vi.resetAllMocks();mocks.hasSession=false;mocks.scope="account-a";});
describe("organization management API-bound screen",()=>{
 it("shows zero-member unconfigured organizations and saves versioned plan with mandatory audit reason",async()=>{
  mocks.list.mockResolvedValue({organizations:[org],nextCursor:null});
  mocks.detail.mockResolvedValue({organization:org,changes:[]});mocks.save.mockResolvedValue({plan:"enterprise",version:1,enforcement:"pending"});
  render(<PlatformOrganizationsScreen state="default"/>);
  expect(await screen.findByText("Empty SaaS")).toBeInTheDocument();
  expect(screen.getByText("未配置")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"详情与套餐"}));
  const save=await screen.findByRole("button",{name:"保存套餐"});expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText("套餐"),{target:{value:"enterprise"}});
  fireEvent.change(screen.getByLabelText("变更理由（写入审计记录）"),{target:{value:"Approved enterprise agreement"}});
  fireEvent.click(save);
  await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith("empty-saas",{plan:"enterprise",expectedVersion:0,reason:"Approved enterprise agreement"}));
  expect(await screen.findByText(/套餐额度以实际计费记录为准/)).toBeInTheDocument();
 });
 it("keeps the confirmed grant receipt visible during and after same-organization refresh",async()=>{
  const active={...org,plan:{plan:"enterprise",version:1,updatedAt:"2026-11-01T00:00:00Z",updatedBy:"operator",enforcement:"active",billingGeneration:"generation"},billingSummary:{licenseStatus:"enterprise",generation:"generation",wallet:{balance:0}}};
  mocks.list.mockResolvedValueOnce({organizations:[active],nextCursor:null}).mockImplementation(()=>new Promise(resolve=>setTimeout(()=>resolve({organizations:[active],nextCursor:null}),30)));mocks.detail.mockResolvedValueOnce({organization:active,changes:[]}).mockImplementation(()=>new Promise(resolve=>setTimeout(()=>resolve({organization:active,changes:[]}),50)));
  mocks.grant.mockResolvedValue({credits:42,balance:42,auditRef:"audit-confirmed"});render(<PlatformOrganizationsScreen state="default"/>);
  const originalTrigger=await screen.findByRole("button",{name:"详情与套餐"});fireEvent.click(originalTrigger);fireEvent.change(await screen.findByLabelText("添加额度"),{target:{value:"42"}});fireEvent.change(screen.getByLabelText("添加原因"),{target:{value:"approved"}});fireEvent.click(screen.getByRole("button",{name:"添加额度"}));fireEvent.click(screen.getByRole("button",{name:"确认添加"}));
  await waitFor(()=>expect(mocks.detail).toHaveBeenCalledTimes(2));await new Promise(resolve=>setTimeout(resolve,80));expect(screen.getByText(/审计编号：audit-confirmed/)).toBeInTheDocument();
  expect(originalTrigger.isConnected).toBe(false);
  fireEvent.click(screen.getByRole("button",{name:"关闭"}));
  await waitFor(()=>expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByLabelText("搜索组织名称")).toHaveFocus();
 });
 it("search changes the server query and pagination sends the cursor",async()=>{
  mocks.list.mockResolvedValue({organizations:[org],nextCursor:"empty-saas"});render(<PlatformOrganizationsScreen state="default"/>);
  await screen.findByText("Empty SaaS");
  fireEvent.change(screen.getByLabelText("搜索组织名称"),{target:{value:"Empty"}});fireEvent.click(screen.getByRole("button",{name:"搜索"}));
  await waitFor(()=>expect(mocks.list).toHaveBeenLastCalledWith("Empty",undefined));
  await screen.findByText("Empty SaaS");fireEvent.click(screen.getByRole("button",{name:"下一页"}));
  await waitFor(()=>expect(mocks.list).toHaveBeenLastCalledWith("Empty","empty-saas"));
 });
 it("a dependency outage is unavailable, not an empty catalog",async()=>{
  mocks.list.mockRejectedValue(new Error("down"));render(<PlatformOrganizationsScreen state="default"/>);
  expect(await screen.findByRole("alert")).toHaveTextContent("操作未完成");
  expect(screen.queryByText("没有匹配的正式组织。")).not.toBeInTheDocument();
 });
});

it("opens organization details in an accessible drawer and closes without retaining stale details",async()=>{
 mocks.list.mockResolvedValue({organizations:[org],nextCursor:null});
 mocks.detail.mockResolvedValue({organization:org,changes:[]});
 render(<PlatformOrganizationsScreen state="default"/>);
 await screen.findByText("Empty SaaS");
 const trigger=screen.getByRole("button",{name:"详情与套餐"});
 fireEvent.click(trigger);
 const drawer=await screen.findByRole("dialog",{name:/组织详情/});
 expect(drawer).toHaveTextContent("Empty SaaS");
 fireEvent.keyDown(drawer,{key:"Escape"});
 await waitFor(()=>expect(screen.queryByRole("dialog",{name:/组织详情/})).not.toBeInTheDocument());
 expect(trigger).toHaveFocus();
});


it.each(["resolve","reject"])("ignores an old organization's late %s after reopening another drawer",async outcome=>{
 const other={...org,orgId:"second-org",name:"Second Organization"};
 let finish!: (value:unknown)=>void;
 let fail!: (reason:Error)=>void;
 const pending=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
 mocks.list.mockResolvedValue({organizations:[org,other],nextCursor:null});
 mocks.detail.mockImplementation((id:string)=>id===org.orgId?pending:Promise.resolve({organization:other,changes:[]}));
 render(<PlatformOrganizationsScreen state="default"/>);
 await screen.findByText(org.name);
 fireEvent.click(within(screen.getByRole("row",{name:/Empty SaaS/})).getByRole("button",{name:"详情与套餐"}));
 await screen.findByRole("dialog",{name:"组织详情"});
 fireEvent.click(screen.getByRole("button",{name:"关闭"}));
 await waitFor(()=>expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
 fireEvent.click(within(screen.getByRole("row",{name:/Second Organization/})).getByRole("button",{name:"详情与套餐"}));
 const drawer=await screen.findByRole("dialog",{name:"组织详情"});
 await waitFor(()=>expect(drawer).toHaveTextContent(other.name));
 await within(drawer).findByText("用量加载失败，请稍后重试。");
 expect(mocks.usage).toHaveBeenCalledWith(other.orgId,true,expect.any(Object));
 await act(async()=>{if(outcome==="resolve")finish({organization:org,changes:[]});else fail(new Error("old request failed"));await Promise.resolve();});
 expect(drawer).toHaveTextContent(other.name);
 expect(drawer).not.toHaveTextContent(org.name);
 expect(screen.queryByText("操作未完成，请稍后重试。")).not.toBeInTheDocument();
 expect(drawer).not.toHaveTextContent("详情未能加载，请重新选择组织。");
 expect(within(drawer).getByRole("alert")).toHaveTextContent("用量加载失败，请稍后重试。");
});


it("clears an open pending drawer when the authenticated account scope changes",async()=>{
 mocks.hasSession=true;
 const other={...org,orgId:"new-account-org",name:"New Account Organization"};
 let finish!:(value:unknown)=>void;
 mocks.detail.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 mocks.list.mockResolvedValueOnce({organizations:[org],nextCursor:null}).mockResolvedValueOnce({organizations:[other],nextCursor:null});
 const view=render(<PlatformOrganizationsScreen state="default"/>);
 await screen.findByText(org.name);
 fireEvent.click(screen.getByRole("button",{name:"详情与套餐"}));
 await screen.findByRole("dialog",{name:"组织详情"});
 mocks.scope="account-b";
 view.rerender(<PlatformOrganizationsScreen state="default"/>);
 await screen.findByText(other.name);
 expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
 await act(async()=>{finish({organization:org,changes:[]});await Promise.resolve();});
 expect(screen.queryByText(org.name)).not.toBeInTheDocument();
 expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});


it.each([[403,"NOT_PLATFORM_SUPERUSER","仅平台运营人员可以管理组织。"],[503,"PLATFORM_CATALOG_UNAVAILABLE","组织目录暂不可用，请联系平台运维。"]] as const)("renders detail HTTP %s failure inside the drawer",async(status,code,message)=>{
 mocks.list.mockResolvedValue({organizations:[org],nextCursor:null});
 mocks.detail.mockRejectedValue(new ApiError(status,code,null));
 render(<PlatformOrganizationsScreen state="default"/>);
 fireEvent.click(await screen.findByRole("button",{name:"详情与套餐"}));
 const drawer=await screen.findByRole("dialog",{name:"组织详情"});
 expect(await within(drawer).findByRole("alert")).toHaveTextContent(message);
});

it("renders a save version conflict inside the drawer and preserves the edit",async()=>{
 mocks.list.mockResolvedValue({organizations:[org],nextCursor:null});
 mocks.detail.mockResolvedValue({organization:org,changes:[]});
 mocks.save.mockRejectedValue(new ApiError(409,"PLAN_VERSION_CONFLICT",null));
 render(<PlatformOrganizationsScreen state="default"/>);
 fireEvent.click(await screen.findByRole("button",{name:"详情与套餐"}));
 const drawer=await screen.findByRole("dialog",{name:"组织详情"});
 fireEvent.change(await within(drawer).findByLabelText("变更理由（写入审计记录）"),{target:{value:"keep this edit"}});
 fireEvent.click(within(drawer).getByRole("button",{name:"保存套餐"}));
 expect(await within(drawer).findByText("套餐已被其他运营人员修改，请重新打开详情后再提交。")).toBeInTheDocument();
 expect(within(drawer).getByLabelText("变更理由（写入审计记录）")).toHaveValue("keep this edit");
});
