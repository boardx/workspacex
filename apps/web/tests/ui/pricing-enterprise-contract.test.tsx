import * as React from "react";
import {afterEach,expect,it} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {PricingEnterprisePreview} from "@/components/billing/pricing-enterprise-preview";
afterEach(cleanup);
function open(credits:string,reason:string){
 render(<PricingEnterprisePreview/>);
 expect(screen.queryByTestId("pricing-grant-studio")).toBeNull();
 fireEvent.click(screen.getByTestId("pricing-grant-research"));
 fireEvent.change(screen.getByTestId("pricing-grant-amount"),{target:{value:credits}});
 fireEvent.change(screen.getByTestId("pricing-grant-reason"),{target:{value:reason}});
 fireEvent.click(screen.getByTestId("pricing-admin-confirm"));
}
it("rejects the overlong reason through the shared contract without modifying the preview balance",async()=>{
 open("1","x".repeat(501));
 expect(await screen.findByTestId("err-pricing-grant")).toBeVisible();
 expect(screen.getByTestId("pricing-admin-row-research")).toHaveTextContent("238,500");
 expect(screen.queryByTestId("pricing-admin-saved")).toBeNull();
});
it.each(["0","-1","0.5","1000001"])("rejects invalid manual credit %s without modifying the preview",async credits=>{
 open(credits,"test reason");expect(await screen.findByTestId("err-pricing-grant")).toBeVisible();
 expect(screen.getByTestId("pricing-admin-row-research")).toHaveTextContent("238,500");
});
it("applies only the parsed grant receipt to the Enterprise preview row",async()=>{
 open("1","  approved preview reason  ");expect(await screen.findByTestId("pricing-admin-saved")).toHaveTextContent("添加 1 credit");
 expect(screen.getByTestId("pricing-admin-row-research")).toHaveTextContent("238,501");
 expect(screen.getByTestId("pricing-admin-row-studio")).toHaveTextContent("64,000");
});
