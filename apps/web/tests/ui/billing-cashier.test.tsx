import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BillingOverview } from "@/components/billing/billing-overview";
const wallet={ownerType:"user",ownerId:"user-a",balance:100,totalPurchased:100,totalGranted:0,updatedAt:"2026-10-16T00:00:00Z"};
const pack={packageId:"p1",ownerType:"user",region:"cn",currency:"CNY",amountFen:9900,displayAmount:"¥99.00",baseCredits:100,bonusCredits:20,bonusRate:0.2,totalCredits:120};
function setup(items:unknown[]=[pack]){
 vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
  const path=new URL(url).pathname;
  const body=path.endsWith("/config")?{enabledProviders:["wechat"]}:path.endsWith("/wallet")?{wallet}:path.endsWith("/packages")?{items}:path.endsWith("/transactions")?{items:[],nextCursor:null}:{status:"none",planRef:null,currentPeriodEnd:null,cancelAtPeriodEnd:false};
  return new Response(JSON.stringify(body));
 }));
 render(<BillingOverview userId="user-a" sessionToken="cashier-test-session"/>);
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("F06 live cashier entry",()=>{
 it("opens real package selection from configured account",async()=>{
  setup();fireEvent.click(await screen.findByRole("button",{name:"购买额度"}));
  expect(await screen.findByTestId("billing-cashier-dialog")).toBeTruthy();
  expect(await screen.findByText("¥99.00")).toBeTruthy();
  expect(screen.queryByTestId("billing-qr-code-area")).toBeNull();
 });
 it("does not invent packages for an empty catalog",async()=>{
  setup([]);fireEvent.click(await screen.findByRole("button",{name:"购买额度"}));
  expect(await screen.findByTestId("billing-packages-empty")).toBeTruthy();
  expect(screen.queryByTestId("billing-generate-qr")).toBeNull();
 });
});
