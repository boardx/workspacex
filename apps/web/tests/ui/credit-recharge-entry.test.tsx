import * as React from "react";
import {afterEach,expect,it} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {CreditConsumptionNotice} from "@/components/billing/credit-consumption-notice";
afterEach(cleanup);
it("terminal insufficient credit without payer metadata opens account review without assuming a payer",()=>{
 render(<><textarea aria-label="草稿" defaultValue="保留问题"/><CreditConsumptionNotice/></>);
 fireEvent(window,new CustomEvent("workspacex:credit-failure",{detail:{code:"CREDIT_REQUIRED"}}));
 expect(screen.getByRole("link",{name:"查看额度与充值"}).getAttribute("href")).toBe("/billing");
 expect(screen.getByRole("alert").textContent).toContain("可用额度不足");
 expect((screen.getByLabelText("草稿") as HTMLTextAreaElement).value).toBe("保留问题");
});
it("accounting failure remains separate and never offers recharge",()=>{
 render(<CreditConsumptionNotice/>);
 fireEvent(window,new CustomEvent("workspacex:credit-failure",{detail:{code:"CREDIT_ACCOUNTING_UNAVAILABLE"}}));
 expect(screen.getByRole("alert").textContent).toContain("计费服务暂时不可用");
 expect(screen.queryByRole("link")).toBeNull();
});
