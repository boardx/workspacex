import {describe,expect,it} from "vitest";
import {operations,CreditRequiredBody} from "../src/billing-consumption";
import {CreditWallet,CreditTransaction,CreditPackage} from "../src/billing-credits";
describe("credit consumption wire contract",()=>{
 it("only accepts an explicit boolean toggle",()=>{
  expect(operations.updatePlatformSettings.in.parse({creditPreflightEnabled:false})).toEqual({creditPreflightEnabled:false});
  for(const value of [{creditPreflightEnabled:"false"},{creditPreflightEnabled:0},{creditPreflightEnabled:true,ownerId:"other"}])expect(()=>operations.updatePlatformSettings.in.parse(value)).toThrow();
 });
 it("supports exact fractional and unpaid balances without allowing extra precision",()=>{
  const base={ownerType:"user",ownerId:"user",balance:-0.01,totalPurchased:100,totalGranted:0,updatedAt:new Date().toISOString()};
  expect(CreditWallet.parse(base).balance).toBe(-0.01);
  expect(()=>CreditWallet.parse({...base,balance:0.001})).toThrow();
  const txn={txnId:"id",type:"consume",direction:-1,credits:0.02,balanceAfter:-0.01,sourceType:"model_request",sourceId:"request",operatorId:null,reason:null,createdAt:new Date().toISOString()};
  expect(CreditTransaction.parse(txn).credits).toBe(0.02);
  expect(()=>CreditTransaction.parse({...txn,credits:0.001})).toThrow();
  expect(CreditPackage.shape.baseCredits.safeParse(0.01).success).toBe(false);
 });
 it("only sends local billing destinations for credit-required guidance",()=>{
  expect(CreditRequiredBody.parse({code:"credit_required",ownerType:"user",ownerId:"u",rechargePath:"/billing"}).rechargePath).toBe("/billing");
  expect(()=>CreditRequiredBody.parse({code:"credit_required",ownerType:"user",ownerId:"u",rechargePath:"https://evil.example"})).toThrow();
 });
});
