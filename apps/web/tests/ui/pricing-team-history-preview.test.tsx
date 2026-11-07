import * as React from "react";
import {afterEach,expect,it} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {TeamSubscriptionHistory} from "@repo/contracts/billing-team";
import {PricingPreview} from "@/components/billing/pricing-preview";
import {previewTeamSubscriptionHistory} from "@/components/billing/pricing-preview-data";
afterEach(cleanup);
it("renders one confirmed annual payment from the strict history response",()=>{
 const history=previewTeamSubscriptionHistory("cn","year",false);
 expect(TeamSubscriptionHistory.parse(history)).toEqual(history);expect(history.items).toHaveLength(1);
 render(<PricingPreview/>);fireEvent.click(screen.getByTestId("pricing-view-team"));fireEvent.click(screen.getByTestId("pricing-toggle-cycle"));fireEvent.click(screen.getByTestId("pricing-subscription-history"));
 expect(screen.getAllByTestId("pricing-team-history-item")).toHaveLength(1);
 expect(screen.getByTestId("pricing-history-dialog")).toHaveTextContent("Team 年度订阅");
 expect(screen.getByTestId("pricing-history-dialog")).toHaveTextContent("¥9,990");
});
it("preserves the actual expired payment term without presenting it as current entitlement",()=>{
 render(<PricingPreview/>);fireEvent.click(screen.getByTestId("pricing-view-team"));fireEvent.click(screen.getByTestId("pricing-toggle-expired"));fireEvent.click(screen.getByTestId("pricing-subscription-history"));
 expect(screen.getAllByTestId("pricing-team-history-item")).toHaveLength(1);
 expect(screen.getByTestId("pricing-history-dialog")).toHaveTextContent("2026/09/30 — 2026/10/31");
 expect(screen.getByTestId("pricing-history-dialog")).toHaveTextContent("订阅已到期");
 expect(screen.getByTestId("pricing-history-dialog")).not.toHaveTextContent("本期有效");
});
