import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlatformOrganizationsScreen } from "@/components/admin/platform-organizations-screen";
const mocks=vi.hoisted(()=>({list:vi.fn(),detail:vi.fn(),save:vi.fn()}));
vi.mock("@/lib/live-platform-organizations",()=>({listPlatformOrganizations:mocks.list,getPlatformOrganization:mocks.detail,setPlatformOrganizationPlan:mocks.save,getPlatformAiPolicy:async()=>({version:0,configuration:null,priceVersion:null,updatedAt:null,updatedBy:null,enforcement:"pending",changes:[]}),getPlatformAiCandidates:async()=>[]}));
vi.mock("@/components/admin/admin-screen",()=>({AdminScreen:({children}:{children:React.ReactNode})=><div>{children}</div>}));
const org={orgId:"empty-saas",name:"Empty SaaS",kind:"organization",memberCount:0,
 plan:{plan:null,version:0,updatedAt:null,updatedBy:null,enforcement:"pending"}};
afterEach(()=>{cleanup();vi.resetAllMocks();});
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
  expect(await screen.findByText(/用量限制尚未启用/)).toBeInTheDocument();
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
