import {describe,expect,it} from "vitest";
import {EnterpriseCreditGrantRequest,EnterpriseCreditGrantResult,EnterpriseUpgradeRequest,TeamQuoteRequest,TeamCheckoutRequest,TeamPaidTerm,TEAM_INCLUDED_SEATS,TEAM_MONTHLY_CREDITS,TEAM_SEAT_MONTHLY_CREDITS,ENTERPRISE_MANUAL_CREDIT_MAX} from "../src/billing-team";
const key="team-request-key-00001";
const grant={credits:10000,reason:"本月额外额度",idempotencyKey:key};
const term={purchaseAnchor:"2026-11-01T10:00:00Z",paidPeriodStart:"2026-11-01T10:00:00Z",paidPeriodEnd:"2027-11-01T10:00:00Z",billingCycle:"year",purchasedSeats:5,monthlyCredits:100000};
describe("proposed Team/Enterprise contract material (not runtime permission)",()=>{
 it("exports the confirmed included capacity and monthly quota once",()=>{
  expect([TEAM_INCLUDED_SEATS,TEAM_MONTHLY_CREDITS,TEAM_SEAT_MONTHLY_CREDITS,ENTERPRISE_MANUAL_CREDIT_MAX]).toEqual([5,100000,15000,1000000]);
 });
 it.each([1,1000000])("accepts the adopted integer manual grant boundary %s",credits=>{
  expect(EnterpriseCreditGrantRequest.parse({...grant,credits,reason:"  本月额外额度  "})).toEqual({...grant,credits});
 });
 it.each([0,-1,0.5,1000001,Infinity,NaN])("rejects invalid manual credits %s",credits=>{
  expect(EnterpriseCreditGrantRequest.safeParse({...grant,credits}).success).toBe(false);
 });
 it.each(["", "   ","x".repeat(501)])("requires the bounded human grant reason",reason=>{
  expect(EnterpriseCreditGrantRequest.safeParse({...grant,reason}).success).toBe(false);
 });
 it.each(["actorId","orgId","generation","expiresAt","balance","plan","contractId"])("rejects caller-owned financial/authority field %s",field=>{
  expect(EnterpriseCreditGrantRequest.safeParse({...grant,[field]:"forged"}).success).toBe(false);
 });
 it("uses the existing optimistic Plan input without adding an upgrade reason field",()=>{
  const upgrade={expectedPlanVersion:3,idempotencyKey:key};
  expect(EnterpriseUpgradeRequest.parse(upgrade)).toEqual(upgrade);
  for(const patch of [{expectedPlanVersion:-1},{expectedPlanVersion:1.5},{idempotencyKey:"short"},{reason:"forged"},{plan:"enterprise"},{actorId:"other"}])
   expect(EnterpriseUpgradeRequest.safeParse({...upgrade,...patch}).success).toBe(false);
 });
 it("separates total purchased seats from a strictly positive add-on quantity",()=>{
  const base={sku:"team-cn-year-v1",catalogVersion:"pricing-v1",provider:"wechat",expectedPlanVersion:0};
  expect(TeamQuoteRequest.safeParse({...base,purpose:"initial",seats:5}).success).toBe(true);
  expect(TeamQuoteRequest.safeParse({...base,purpose:"renewal",seats:8}).success).toBe(true);
  expect(TeamQuoteRequest.safeParse({...base,purpose:"add_seats",additionalSeats:2}).success).toBe(true);
  for(const value of [{...base,purpose:"initial",seats:4},{...base,purpose:"add_seats",additionalSeats:0},{...base,purpose:"add_seats",additionalSeats:-1},{...base,purpose:"add_seats",additionalSeats:1.5},{...base,purpose:"add_seats",seats:7}])
   expect(TeamQuoteRequest.safeParse(value).success).toBe(false);
 });
 it.each([
  {purpose:"initial",seats:5,expectedPlanVersion:0},
  {purpose:"renewal",seats:8,expectedPlanVersion:3},
  {purpose:"add_seats",additionalSeats:2,expectedPlanVersion:3},
  {purpose:"credit_topup"},
 ])("rejects injected authority or financial fields for $purpose",selection=>{
  const value={sku:"server-sku",catalogVersion:"pricing-v1",provider:"wechat",...selection};
  expect(TeamQuoteRequest.safeParse(value).success).toBe(true);
  for(const field of ["amountMinor","credits","currency","ownerType","ownerId","orgId","actorId","generation","plan"])
   expect(TeamQuoteRequest.safeParse({...value,[field]:"forged"}).success).toBe(false);
 });
 it("keeps permanent top-up independent of seat or term-changing fields",()=>{
  const value={purpose:"credit_topup",sku:"credit-cn-10000-v1",catalogVersion:"pricing-v1",provider:"wechat"};
  expect(TeamQuoteRequest.parse(value)).toEqual(value);
  for(const patch of [{seats:5},{additionalSeats:1},{expectedPlanVersion:0},{amountMinor:1},{credits:1000000},{ownerId:"another-org"},{currency:"USD"}])
   expect(TeamQuoteRequest.safeParse({...value,...patch}).success).toBe(false);
 });
 it("checkout only accepts the original quote and idempotency identity",()=>{
  const value={quoteRef:"quote-original",idempotencyKey:key};
  expect(TeamCheckoutRequest.parse(value)).toEqual(value);
  for(const patch of [{quoteRef:""},{idempotencyKey:"short"},{amountMinor:1},{orgId:"other"},{provider:"stripe"},{success:true}])
   expect(TeamCheckoutRequest.safeParse({...value,...patch}).success).toBe(false);
 });
 it("does not convert annual payment into an annual upfront quota or lower the paid capacity",()=>{
  expect(TeamPaidTerm.parse(term)).toEqual(term);
  expect(TeamPaidTerm.safeParse({...term,purchasedSeats:7,monthlyCredits:130000}).success).toBe(true);
  for(const patch of [{purchasedSeats:4},{purchasedSeats:5.5},{monthlyCredits:1200000},{monthlyCredits:99999},{paidPeriodEnd:term.paidPeriodStart},{billingCycle:"month"},{purchaseAnchor:"bad-time"}])
   expect(TeamPaidTerm.safeParse({...term,...patch}).success).toBe(false);
 });
 it("allows a continuous renewal to retain the original purchase anchor",()=>{
  expect(TeamPaidTerm.safeParse({...term,paidPeriodStart:"2027-11-01T10:00:00Z",paidPeriodEnd:"2028-11-01T10:00:00Z"}).success).toBe(true);
  expect(TeamPaidTerm.safeParse({...term,purchaseAnchor:"2027-11-02T10:00:00Z"}).success).toBe(false);
 });
 it("keeps the actual grant receipt and signed balance separate from entitlement changes",()=>{
  const result={orgId:"organization-a",grantRef:"grant-a",ledgerRef:"ledger-a",auditRef:"audit-a",credits:1,balance:-29.25,createdAt:"2026-11-01T10:00:00Z"};
  expect(EnterpriseCreditGrantResult.parse(result)).toEqual(result);
  for(const patch of [{ledgerRef:""},{credits:0.5},{balance:Infinity},{isEnterprise:true},{expiresAt:null}])
   expect(EnterpriseCreditGrantResult.safeParse({...result,...patch}).success).toBe(false);
 });
});
