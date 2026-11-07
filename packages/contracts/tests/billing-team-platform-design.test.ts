import {expect,it} from "vitest";
import * as C from "../src/platform-organizations";
import {EnterpriseUpgradeRequest,EnterpriseCreditGrantRequest} from "../src/billing-team";
const generation="pricing-v1",asOf="2026-11-16T10:00:00Z";
const term={purchaseAnchor:"2026-11-01T10:00:00Z",paidPeriodStart:"2026-11-01T10:00:00Z",paidPeriodEnd:"2027-11-01T10:00:00Z",billingCycle:"year",purchasedSeats:5,monthlyCredits:100000};
const summary={orgId:"org-a",generation,planVersion:1,asOf,licenseStatus:"active",memberCount:4,teamPayment:{term,provider:"wechat",renewalMode:"manual",cancelAtPeriodEnd:false,subscriptionStatus:null},creditGrant:{status:"granted",grant:{credits:100000,remainingCredits:64000,periodStart:term.paidPeriodStart,periodEnd:"2026-12-01T10:00:00Z"}},wallet:{ownerType:"team",ownerId:"org-a",balance:64000,permanentBalance:0,subscriptionCredits:64000,subscriptionExpiresAt:"2026-12-01T10:00:00Z",totalPurchased:0,totalGranted:100000,updatedAt:asOf},checkoutPending:false,paymentReviewRequired:false};
const row={orgId:"org-a",name:"Organization A",kind:"organization",memberCount:4,plan:{plan:"ordinary",version:1,updatedAt:asOf,updatedBy:"platform-operator",enforcement:"active",billingGeneration:generation},billingSummary:summary};
it("keeps legacy metadata reads unchanged while accepting a coherent current billing summary",()=>{
 const legacy={orgId:row.orgId,name:row.name,kind:row.kind,memberCount:4,plan:{plan:null,version:0,updatedAt:null,updatedBy:null,enforcement:"pending"}};
 expect(C.OrganizationRow.parse(legacy)).toEqual(legacy);expect(C.OrganizationRow.parse(row)).toEqual(row);
});
it.each([
 {orgId:"org-b"},{memberCount:5},{planVersion:2},{generation:"old-generation"},{licenseStatus:"enterprise"},
])("rejects a billing summary inconsistent with the catalog row %j",patch=>{
 expect(C.OrganizationRow.safeParse({...row,billingSummary:{...summary,...patch}}).success).toBe(false);
});
it("shows an old Enterprise designation without restoring old billing rights",()=>{
 const none={...summary,licenseStatus:"none",teamPayment:null,creditGrant:{status:"none",grant:null},wallet:{...summary.wallet,balance:0,subscriptionCredits:0,subscriptionExpiresAt:null,totalGranted:0}};
 const legacy={...row,plan:{...row.plan,plan:"enterprise",billingGeneration:"old-generation"},billingSummary:none};
 expect(C.OrganizationRow.parse(legacy)).toEqual(legacy);
 expect(C.OrganizationRow.safeParse({...legacy,plan:{...legacy.plan,billingGeneration:generation}}).success).toBe(false);
});
it("requires actual active enforcement for a supplied current summary and retains one Plan source",()=>{
 expect(C.OrganizationRow.safeParse({...row,plan:{...row.plan,enforcement:"pending"}}).success).toBe(false);
 expect(EnterpriseUpgradeRequest.shape.expectedPlanVersion).toBe(C.operations.setPlan.in.shape.expectedVersion);
 expect(EnterpriseCreditGrantRequest.shape.reason).toBe(C.operations.setPlan.in.shape.reason);
 expect(C.operations.setPlan.in.safeParse({plan:"enterprise",expectedVersion:1,reason:"operator",billingGeneration:generation}).success).toBe(false);
});
