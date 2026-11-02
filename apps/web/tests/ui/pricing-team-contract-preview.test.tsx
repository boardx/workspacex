import * as React from "react";
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {PricingAccountPreview} from "@/components/billing/pricing-account-preview";
import {PricingPurchaseDialog} from "@/components/billing/pricing-purchase-dialog";
afterEach(cleanup);
it("shows purchased capacity and its full monthly pool independently of four current members",()=>{
 render(<PricingAccountPreview team free={false} expired={false} region="cn" cycle="year" onPurchase={vi.fn()} onHistory={vi.fn()}/>);
 expect(screen.getByTestId("pricing-subscription")).toHaveTextContent("已用 4 / 已购 5 席");
 expect(screen.getByTestId("pricing-subscription")).toHaveTextContent("100,000 credit");
 expect(screen.getByTestId("pricing-subscription")).toHaveTextContent("年付仍按购买日逐月发放");
});
it("uses the same monthly seat grant in the adopted add-on quote preview",()=>{
 render(<PricingPurchaseDialog kind="seats" region="cn" cycle="year" team onCycleChange={vi.fn()} onClose={vi.fn()} onPurchased={vi.fn()}/>);
 fireEvent.click(screen.getByTestId("pricing-seat-plus"));
 expect(screen.getByTestId("pricing-seat-count")).toHaveTextContent("2");
 expect(screen.getByTestId("pricing-purchase-dialog")).toHaveTextContent("30,000 credit/月");
 expect(screen.getByTestId("pricing-total")).toHaveTextContent("¥1,490");
 expect(screen.getByTestId("pricing-purchase-dialog")).toHaveTextContent("首期新增额度按剩余月度周期折算");
});
