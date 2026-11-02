import * as React from "react";
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {EnterpriseManagementPanel} from "@/components/admin/enterprise-management-panel";
const mocks=vi.hoisted(()=>({grant:vi.fn(),upgrade:vi.fn()}));
vi.mock("@/lib/live-enterprise-management",()=>({grantEnterpriseCredits:mocks.grant,upgradeEnterprise:mocks.upgrade}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
it("retains grant request identity and amount after uncertain network failure",async()=>{
 mocks.grant.mockRejectedValueOnce(Error("timeout")).mockResolvedValueOnce({credits:42,balance:42,auditRef:"audit"});
 render(<EnterpriseManagementPanel orgId="org" version={2} enterprise onApplied={()=>{}}/>);
 fireEvent.change(screen.getByLabelText("添加额度"),{target:{value:"42"}});fireEvent.change(screen.getByLabelText("添加原因"),{target:{value:"approved"}});fireEvent.click(screen.getByRole("button",{name:"添加额度"}));
 fireEvent.click(await screen.findByRole("button",{name:"重试原请求"}));
 await waitFor(()=>expect(mocks.grant).toHaveBeenCalledTimes(2));expect(mocks.grant.mock.calls[1]).toEqual(mocks.grant.mock.calls[0]);
 expect(await screen.findByText(/已添加 42/)).toBeInTheDocument();
});
it("processing keeps original operation and does not announce successful upgrade",async()=>{
 mocks.upgrade.mockResolvedValue({status:"processing",operationRef:"operation",receipt:null});const applied=vi.fn();
 render(<EnterpriseManagementPanel orgId="org" version={2} enterprise={false} onApplied={applied}/>);
 fireEvent.click(screen.getByRole("button",{name:"手动升级 Enterprise"}));expect(await screen.findByText(/套餐尚未变更/)).toBeInTheDocument();expect(applied).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"重试原升级"}));await waitFor(()=>expect(mocks.upgrade).toHaveBeenCalledTimes(2));expect(mocks.upgrade.mock.calls[1]).toEqual(mocks.upgrade.mock.calls[0]);
});
