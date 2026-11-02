import * as React from "react";
import {afterEach,expect,it} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {PricingPurchaseDialog} from "@/components/billing/pricing-purchase-dialog";
import {PricingEnterprisePreview} from "@/components/billing/pricing-enterprise-preview";
import {PricingEnterpriseAccountPreview} from "@/components/billing/pricing-enterprise-account-preview";
afterEach(cleanup);
it("shows the seven-member initial quote total rather than a five-seat base price",()=>{
 render(<PricingPurchaseDialog kind="plans" region="cn" cycle="year" team initialMembers={7} onCycleChange={()=>{}} onClose={()=>{}} onPurchased={()=>{}}/>);
 expect(screen.getByTestId("pricing-initial-capacity")).toHaveTextContent("7");
 expect(screen.getByTestId("pricing-total")).toHaveTextContent("12,970");
 expect(screen.getByTestId("pricing-initial-capacity")).toHaveTextContent("130,000");
});
it("retains Team and the original operation reference until an upgrade succeeds",()=>{
 render(<PricingEnterprisePreview upgradeOutcome="processing"/>);
 fireEvent.click(screen.getByTestId("pricing-upgrade-studio"));fireEvent.click(screen.getByTestId("pricing-admin-confirm"));
 expect(screen.getByTestId("pricing-admin-plan-studio")).toHaveTextContent("Team");
 const reference=screen.getByTestId("pricing-upgrade-operation-studio").getAttribute("data-operation-ref");
 fireEvent.click(screen.getByTestId("pricing-upgrade-retry-studio"));
 expect(screen.getByTestId("pricing-upgrade-operation-studio")).toHaveAttribute("data-operation-ref",reference);
 expect(screen.queryByTestId("pricing-grant-studio")).toBeNull();
});
it("offers platform review while keeping the actual Team status",()=>{
 render(<PricingEnterprisePreview upgradeOutcome="needs_review"/>);
 fireEvent.click(screen.getByTestId("pricing-upgrade-studio"));fireEvent.click(screen.getByTestId("pricing-admin-confirm"));
 expect(screen.getByTestId("pricing-upgrade-operation-studio")).toHaveTextContent("联系平台");
 expect(screen.getByTestId("pricing-admin-plan-studio")).toHaveTextContent("Team");
});
it.each([false,true])("shows Enterprise manual management with retained Team plan=%s",retained=>{
 render(<PricingEnterpriseAccountPreview retained={retained} region="cn"/>);
 expect(screen.getByTestId("pricing-enterprise-account")).toHaveTextContent("Enterprise");
 expect(screen.getByTestId("pricing-enterprise-account")).toHaveTextContent("平台管理员");
 expect(screen.queryByTestId("pricing-add-seats")).toBeNull();
 expect(screen.queryByTestId("pricing-buy-credits")).toBeNull();
 if(retained)expect(screen.getByTestId("pricing-enterprise-prepaid")).toHaveTextContent("2027/11/01");
 else expect(screen.getByTestId("pricing-enterprise-account")).toHaveTextContent("没有待发放");
});
