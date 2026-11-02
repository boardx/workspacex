import {ApiError} from "@/lib/api-client";
import * as React from "react";
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {EnterpriseManagementPanel} from "@/components/admin/enterprise-management-panel";
const mocks=vi.hoisted(()=>({grant:vi.fn(),upgrade:vi.fn(),session:null as Record<string,unknown>|null}));
vi.mock("@/components/session/session-provider",()=>({useOptionalSession:()=>mocks.session}));
vi.mock("@/lib/live-enterprise-management",()=>({grantEnterpriseCredits:mocks.grant,upgradeEnterprise:mocks.upgrade}));
afterEach(()=>{cleanup();sessionStorage.clear();mocks.session=null;vi.unstubAllGlobals();vi.resetAllMocks();});
it("retains grant request identity and amount after uncertain network failure",async()=>{
 mocks.grant.mockRejectedValueOnce(Error("timeout")).mockResolvedValueOnce({credits:42,balance:42,auditRef:"audit"});
 render(<EnterpriseManagementPanel orgId="org" version={2} enterprise onApplied={()=>{}}/>);
 fireEvent.change(screen.getByLabelText("添加额度"),{target:{value:"42"}});fireEvent.change(screen.getByLabelText("添加原因"),{target:{value:"approved"}});fireEvent.click(screen.getByRole("button",{name:"添加额度"}));fireEvent.click(screen.getByRole("button",{name:"确认添加"}));
 fireEvent.click(await screen.findByRole("button",{name:"重试原请求"}));
 await waitFor(()=>expect(mocks.grant).toHaveBeenCalledTimes(2));expect(mocks.grant.mock.calls[1]).toEqual(mocks.grant.mock.calls[0]);
 expect(await screen.findByText(/已添加 42/)).toBeInTheDocument();
});
it("processing keeps original operation and does not announce successful upgrade",async()=>{
 mocks.upgrade.mockResolvedValue({status:"processing",operationRef:"operation",receipt:null});const applied=vi.fn();
 render(<EnterpriseManagementPanel orgId="org" version={2} enterprise={false} onApplied={applied}/>);
 fireEvent.click(screen.getByRole("button",{name:"手动升级 Enterprise"}));fireEvent.click(screen.getByRole("button",{name:"确认升级"}));expect(await screen.findByText(/套餐尚未变更/)).toBeInTheDocument();expect(applied).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"重试原升级"}));await waitFor(()=>expect(mocks.upgrade).toHaveBeenCalledTimes(2));expect(mocks.upgrade.mock.calls[1]).toEqual(mocks.upgrade.mock.calls[0]);
});

it("definitive overflow leaves amount editable instead of trapping an impossible retry",async()=>{
 mocks.grant.mockRejectedValue(new ApiError(409,null,{error:"conflict",code:"credit_balance_unrepresentable",traceId:"trace"}));
 render(<EnterpriseManagementPanel orgId="org" version={2} enterprise onApplied={()=>{}}/>);
 fireEvent.change(screen.getByLabelText("添加额度"),{target:{value:"42"}});fireEvent.change(screen.getByLabelText("添加原因"),{target:{value:"approved"}});fireEvent.click(screen.getByRole("button",{name:"添加额度"}));fireEvent.click(screen.getByRole("button",{name:"确认添加"}));
 expect(await screen.findByText(/额度余额或累计发放已达上限/)).toBeInTheDocument();expect(screen.getByLabelText("添加额度")).not.toBeDisabled();
});
it("confirms the organization, quantity and reason before issuing a new financial request",async()=>{
 mocks.grant.mockResolvedValue({credits:10,balance:10,auditRef:"audit"});render(<EnterpriseManagementPanel orgId="org" version={2} enterprise onApplied={()=>{}}/>);
 fireEvent.change(screen.getByLabelText("添加额度"),{target:{value:"10"}});fireEvent.change(screen.getByLabelText("添加原因"),{target:{value:"approved reason"}});fireEvent.click(screen.getByRole("button",{name:"添加额度"}));
 expect(mocks.grant).not.toHaveBeenCalled();expect(screen.getByRole("dialog")).toHaveTextContent("approved reason");fireEvent.click(screen.getByRole("button",{name:"确认添加"}));await waitFor(()=>expect(mocks.grant).toHaveBeenCalledTimes(1));
});

it("reload restores only the authenticated session's original grant and waits for explicit retry",async()=>{
 const {webcrypto}=await import("node:crypto");const {TextEncoder}=await import("node:util");vi.stubGlobal("crypto",webcrypto);vi.stubGlobal("TextEncoder",TextEncoder);
 mocks.session={status:"authenticated",session:{userId:"operator",sessionToken:"token-one",expiresAt:"2099-01-01T00:00:00Z"}};
 mocks.grant.mockRejectedValueOnce(Error("uncertain network"));
 const first=render(<EnterpriseManagementPanel orgId="org" version={2} enterprise onApplied={()=>{}}/>);
 fireEvent.change(await screen.findByLabelText("添加额度"),{target:{value:"42"}});fireEvent.change(screen.getByLabelText("添加原因"),{target:{value:"original reason"}});fireEvent.click(screen.getByRole("button",{name:"添加额度"}));fireEvent.click(screen.getByRole("button",{name:"确认添加"}));
 await screen.findByText(/操作未确认完成/);const original=mocks.grant.mock.calls[0];first.unmount();
 mocks.grant.mockResolvedValue({credits:42,balance:42,auditRef:"receipt"});render(<EnterpriseManagementPanel orgId="org" version={2} enterprise onApplied={()=>{}}/>);
 await screen.findByText(/已恢复尚未确认的原请求/);expect(mocks.grant).toHaveBeenCalledTimes(1);expect(screen.getByLabelText("添加额度")).toHaveValue(42);expect(screen.getByLabelText("添加原因")).toHaveValue("original reason");
 fireEvent.click(screen.getByRole("button",{name:"重试原请求"}));await waitFor(()=>expect(mocks.grant).toHaveBeenCalledTimes(2));expect(mocks.grant.mock.calls[1]).toEqual(original);expect(await screen.findByText(/审计编号：receipt/)).toBeInTheDocument();expect(sessionStorage.length).toBe(0);
});
it("keeps pending parameters out of another actor, session and target organization",async()=>{
 const {webcrypto}=await import("node:crypto");const {TextEncoder}=await import("node:util");vi.stubGlobal("crypto",webcrypto);vi.stubGlobal("TextEncoder",TextEncoder);
 mocks.session={status:"authenticated",session:{userId:"operator",sessionToken:"token-one",expiresAt:"2099-01-01T00:00:00Z"}};mocks.grant.mockRejectedValue(Error("uncertain"));
 const view=render(<EnterpriseManagementPanel orgId="org" version={2} enterprise onApplied={()=>{}}/>);
 fireEvent.change(await screen.findByLabelText("添加额度"),{target:{value:"42"}});fireEvent.change(screen.getByLabelText("添加原因"),{target:{value:"private original reason"}});fireEvent.click(screen.getByRole("button",{name:"添加额度"}));fireEvent.click(screen.getByRole("button",{name:"确认添加"}));await screen.findByText(/操作未确认完成/);
 expect(Array.from({length:sessionStorage.length},(_,i)=>sessionStorage.key(i)).join()).not.toContain("token-one");
 mocks.session={status:"authenticated",session:{userId:"other-operator",sessionToken:"token-two",expiresAt:"2099-01-01T00:00:00Z"}};view.rerender(<EnterpriseManagementPanel orgId="org" version={2} enterprise onApplied={()=>{}}/>);
 expect(await screen.findByLabelText("添加原因")).toHaveValue("");expect(screen.queryByText(/private original reason/)).not.toBeInTheDocument();
 view.rerender(<EnterpriseManagementPanel orgId="other-org" version={2} enterprise onApplied={()=>{}}/>);expect(await screen.findByLabelText("添加原因")).toHaveValue("");expect(mocks.grant).toHaveBeenCalledTimes(1);
});
it("a definitive version conflict releases the failed attempt and uses the refreshed version only after a new confirmation",async()=>{
 const applied=vi.fn();mocks.upgrade.mockRejectedValueOnce(new ApiError(409,null,{code:"PLAN_VERSION_CONFLICT"}));const view=render(<EnterpriseManagementPanel orgId="org" version={2} enterprise={false} onApplied={applied}/>);
 fireEvent.click(screen.getByRole("button",{name:"手动升级 Enterprise"}));fireEvent.click(screen.getByRole("button",{name:"确认升级"}));await screen.findByText(/未创建本次升级/);expect(applied).toHaveBeenCalledTimes(1);
 view.rerender(<EnterpriseManagementPanel orgId="org" version={3} enterprise={false} onApplied={applied}/>);mocks.upgrade.mockResolvedValue({status:"processing",operationRef:"operation",receipt:null});
 fireEvent.click(screen.getByRole("button",{name:"手动升级 Enterprise"}));fireEvent.click(screen.getByRole("button",{name:"确认升级"}));await waitFor(()=>expect(mocks.upgrade).toHaveBeenCalledTimes(2));expect(mocks.upgrade.mock.calls[1]?.[1].expectedPlanVersion).toBe(3);expect(mocks.upgrade.mock.calls[1]?.[1].idempotencyKey).not.toBe(mocks.upgrade.mock.calls[0]?.[1].idempotencyKey);
});
